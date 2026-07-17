// Field worker protocol: chunk remesh (with an optional display-side slice
// clip) + stamp ghost preview on a scratch store. Unlike the generation worker,
// this worker runs ENGINE code (@furnace/core/field) — it does not load the
// project's /engine.js bundle and has no extension surface. The handler is a
// PURE factory over an injected `post` so the protocol is unit-testable without
// a real Worker (bun test spawns none): the worker entry wires
// post = self.postMessage; tests wire a collector.

import type {
  ChunkMaterials,
  FieldAprons,
  KitInstance,
  MaterialTable,
  MergePolicy,
  MeshBucket,
} from "@furnace/core/field";
import {
  AIR,
  applyOp,
  CHUNK_DIM,
  chunkKey,
  createFieldStore,
  extractFieldAprons,
  FIELD_APRON_DIM,
  generatorById,
  MAT_ROCK,
  meshChunkField,
  parseChunkKey,
  skinChunkKit,
} from "@furnace/core/field";

export type FieldWorkerRequest =
  | {
      kind: "mesh";
      jobId: number;
      key: string;
      /** 20³ Int8 density apron, transferred. */
      density: ArrayBuffer;
      /** 20³ Uint8 material apron (global class ids), transferred. */
      materials: ArrayBuffer;
      /** Resolved material table (structured-cloned — tiny, ≤8 classes). Drives the
       *  mesher's per-class bucket split and the skinner's kit dispatch. */
      table: MaterialTable;
      cellSize: number;
      /** Display-side slice clip (spec §3.6): samples at/above this world Y read
       *  as air (density AIR, material MAT_ROCK) before mesh + skin. */
      sliceY?: number;
    }
  | {
      kind: "stamp-preview";
      jobId: number;
      generator: string;
      params: Record<string, unknown>;
      seed: number;
      region: { min: [number, number, number]; max: [number, number, number] };
      policy: MergePolicy;
      table: MaterialTable;
      cellSize: number;
      /** Snapshot of the region's chunks (missing = uniform solid, matching the
       *  store default). Caller completeness contract: include EVERY allocated
       *  chunk intersecting the region PLUS its 26-halo — omitting a carved
       *  chunk silently diverges preview from commit under keep-existing-air;
       *  omitting a halo chunk yields one-sided ghost seams. Density buffers
       *  transferred; materials structured-cloned. */
      chunks: {
        key: string;
        density: ArrayBuffer;
        materials: ChunkMaterials | null;
      }[];
    };

/** One per-class mesh bucket over the wire: the {@link MeshBucket}'s ChunkMesh
 *  TypedArrays flattened to their backing ArrayBuffers (each transferred). */
export type WireBucket = {
  classId: number;
  backing: boolean;
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  uvs: ArrayBuffer;
  indices: ArrayBuffer;
};

/** For a failed `stamp-preview` job, `mesh-error.key` carries the request's
 *  GENERATOR ID (a stamp has no chunk key) — the documented sentinel. */
export type FieldWorkerResponse =
  | {
      kind: "meshed";
      jobId: number;
      key: string;
      buckets: WireBucket[];
      kit: KitInstance[];
    }
  | {
      kind: "stamp-previewed";
      jobId: number;
      chunks: { key: string; buckets: WireBucket[] }[];
      opCount: number;
      evalMs: number;
    }
  | { kind: "mesh-error"; jobId: number; key: string; message: string };

type Post = (msg: FieldWorkerResponse, transfer: Transferable[]) => void;

// compactBucket returns fresh Float32Array.from / new Uint32Array per bucket,
// so each `.buffer` is a standalone backing buffer — safe to transfer (nothing
// else references it).
const toWireBuckets = (buckets: MeshBucket[]): WireBucket[] =>
  buckets.map((b) => ({
    classId: b.classId,
    backing: b.backing,
    positions: b.mesh.positions.buffer as ArrayBuffer,
    normals: b.mesh.normals.buffer as ArrayBuffer,
    uvs: b.mesh.uvs.buffer as ArrayBuffer,
    indices: b.mesh.indices.buffer as ArrayBuffer,
  }));

const bucketTransfer = (buckets: WireBucket[]): Transferable[] =>
  buckets.flatMap((b) => [b.positions, b.normals, b.uvs, b.indices]);

/** Returns COPIED aprons with every sample at/above world Y `sliceY` clamped
 *  to air (density {@link AIR}, material {@link MAT_ROCK}). Copies, never
 *  in-place: the pure handler also runs in-realm (tests wire it directly), so
 *  the caller may still own the incoming buffers — the 2×20³ B copy is
 *  negligible next to meshing. Sample world Y over the apron window is
 *  `chunkBaseY + (localY − 2)·cellSize` (the −2..17 window). */
function sliceAprons(
  aprons: FieldAprons,
  key: string,
  cellSize: number,
  sliceY: number,
): FieldAprons {
  const density = aprons.density.slice();
  const materials = aprons.materials.slice();
  const baseY = parseChunkKey(key)[1] * CHUNK_DIM * cellSize;
  const N = FIELD_APRON_DIM;
  for (let ly = 0; ly < N; ly++) {
    if (baseY + (ly - 2) * cellSize < sliceY) continue;
    for (let lz = 0; lz < N; lz++)
      for (let lx = 0; lx < N; lx++) {
        const i = lx + N * (ly + N * lz);
        density[i] = AIR;
        materials[i] = MAT_ROCK;
      }
  }
  return { density, materials };
}

function handleMesh(
  msg: Extract<FieldWorkerRequest, { kind: "mesh" }>,
  post: Post,
): void {
  let aprons: FieldAprons = {
    density: new Int8Array(msg.density),
    materials: new Uint8Array(msg.materials),
  };
  if (msg.sliceY !== undefined)
    aprons = sliceAprons(aprons, msg.key, msg.cellSize, msg.sliceY);
  const meshes = meshChunkField(aprons, msg.table, msg.cellSize);
  const kit = skinChunkKit(aprons, msg.table, msg.cellSize, msg.key);
  const buckets = toWireBuckets(meshes.buckets);
  post(
    { kind: "meshed", jobId: msg.jobId, key: msg.key, buckets, kit },
    bucketTransfer(buckets),
  );
}

function handleStampPreview(
  msg: Extract<FieldWorkerRequest, { kind: "stamp-preview" }>,
  post: Post,
): void {
  const def = generatorById(msg.generator); // setup-loud on unknown ids
  const store = createFieldStore(msg.cellSize);
  // Snapshot install: views over the request's buffers, which the caller
  // relinquishes — the scratch store mutates them in place. Production
  // transfers detach the sender's copy; in-realm callers (tests wire the
  // handler directly) must not reuse the buffers they passed.
  for (const c of msg.chunks) {
    store.chunks.set(c.key, new Int8Array(c.density));
    if (c.materials !== null) store.materials.set(c.key, c.materials);
  }
  const t0 = performance.now();
  const evaluated = def.evaluate(
    msg.params,
    msg.seed,
    msg.region,
    msg.table,
    msg.policy,
  );
  const evalMs = performance.now() - t0;
  const dirty = new Set<string>();
  let nextId = 1;
  for (const op of evaluated) {
    const r = applyOp(store, { ...op, id: nextId++ }, msg.table);
    for (const k of r.dirty) dirty.add(k);
  }
  // Watertight ghost seams follow the host's rule: a border write dirties the
  // allocated 26-neighbours whose aprons read the changed samples.
  const remesh = new Set<string>(dirty);
  for (const k of dirty) {
    const [cx, cy, cz] = parseChunkKey(k);
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const nk = chunkKey(cx + dx, cy + dy, cz + dz);
          if (store.chunks.has(nk)) remesh.add(nk);
        }
  }
  // No kit in the ghost (v0): the surface mesh alone shows the stamp's shape;
  // kit skin appears on commit.
  const chunks: { key: string; buckets: WireBucket[] }[] = [];
  const transfer: Transferable[] = [];
  for (const key of remesh) {
    const aprons = extractFieldAprons(store, key);
    const buckets = toWireBuckets(
      meshChunkField(aprons, msg.table, msg.cellSize).buckets,
    );
    transfer.push(...bucketTransfer(buckets));
    chunks.push({ key, buckets });
  }
  post(
    {
      kind: "stamp-previewed",
      jobId: msg.jobId,
      chunks,
      opCount: evaluated.length,
      evalMs,
    },
    transfer,
  );
}

/** Pure handler factory (worker entry wires post = self.postMessage). Never
 *  throws — every failure posts a typed mesh-error message (a worker-side
 *  throw would surface as a generic ErrorEvent with no jobId). */
export function createFieldWorkerHandler(post: Post) {
  return (msg: FieldWorkerRequest): void => {
    try {
      if (msg.kind === "mesh") handleMesh(msg, post);
      else if (msg.kind === "stamp-preview") handleStampPreview(msg, post);
    } catch (err) {
      // A malformed apron (mesher/skinner length guard), an unknown class
      // (classOf throw), or a generator lookup/param/evaluate failure surfaces
      // here as a typed, jobId-carrying error. Stamp errors have no chunk key:
      // the generator id is the key sentinel (see FieldWorkerResponse).
      const message = err instanceof Error ? err.message : String(err);
      const key = msg.kind === "mesh" ? msg.key : msg.generator;
      post({ kind: "mesh-error", jobId: msg.jobId, key, message }, []);
    }
  };
}
