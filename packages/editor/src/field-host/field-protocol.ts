// Field worker protocol: chunk remesh (with an optional display-side slice
// clip), stamp ghost preview on a scratch store, and the void cast (the same
// scratch pattern with an INVERTED density). Unlike the analyzer worker, this
// worker runs ENGINE code (@furnace/core/field) only — it does not load the
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
  PlacementRecord,
} from "@furnace/core/field";
import {
  AIR,
  applyOp,
  applyPatchOp,
  BUILTIN_TABLE,
  CHUNK_DIM,
  CHUNK_SAMPLES,
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
      /** Display-side slice clip: samples at/above this world Y read as air
       *  (density AIR, material MAT_ROCK) before mesh + skin. */
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
    }
  /** The void cast (D-F3-15): mesh the field's NEGATIVE space, so a cave
   *  network reads as a solid from outside. No material channel and no table
   *  on purpose — the cast is SHAPE only: the scratch store carries no
   *  materials, so every apron sample reads {@link MAT_ROCK} (class 0, organic
   *  in every valid table) and the mesher returns exactly ONE non-backing
   *  bucket per chunk, which the host draws with its single void material. */
  | {
      kind: "void-cast";
      jobId: number;
      /** Snapshot of EVERY allocated chunk, density buffers transferred. No
       *  separate halo term and no completeness caveat: "every allocated chunk"
       *  IS the halo. What the snapshot omits is unallocated, and the scratch
       *  store reads exactly that as uniform solid — the same thing the real
       *  field holds there. */
      chunks: { key: string; density: ArrayBuffer }[];
      cellSize: number;
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

/** `mesh-error.key` carries the failed job's chunk key. The two requests that
 *  have no single chunk key carry a documented sentinel instead: a
 *  `stamp-preview` carries its GENERATOR ID, a `void-cast` the literal
 *  {@link VOID_CAST_ERROR_KEY}. */
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
      /** Explicit placed instances the generator emitted (D-F3-8) — the ONLY
       *  output of a pure reader like scatter (its `opCount` is 0). The host
       *  draws them as wireframe proxy boxes in the ghost layer and counts them
       *  into the session's `placementCount`. */
      placements: PlacementRecord[];
    }
  | {
      kind: "void-casted";
      jobId: number;
      /** One entry per chunk whose INVERTED density meshed to something —
       *  chunks that cast nothing (uniform rock, or uniform air with no
       *  allocated neighbour to cap against) are omitted, not sent empty. */
      chunks: { key: string; buckets: WireBucket[] }[];
    }
  | { kind: "mesh-error"; jobId: number; key: string; message: string };

/** The `mesh-error.key` sentinel for a failed `void-cast` job (which spans
 *  every chunk, so no single key describes it). */
export const VOID_CAST_ERROR_KEY = "void-cast";

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

/** Returns a COPIED density channel with the mesher's air/rock partition
 *  INVERTED — air becomes rock and rock becomes air, so meshing the result
 *  casts the void. Copies, never in-place, for the {@link sliceAprons} reason
 *  (the pure handler also runs in-realm).
 *
 *  Negation carries the partition (the mesher reads `d >= 0` as air) with ONE
 *  exception: a sample of exactly 0 is air, and `-0` is still 0, so plain
 *  negation would leave it air on BOTH sides and drop the crossings around it —
 *  a pinhole through an otherwise closed cast. Those map to −1, the smallest
 *  cast-solid value, which inverts the partition exactly.
 *
 *  Inside the store's own `[SOLID, AIR]` range negation is symmetric (±127) and
 *  needs no clamp. The clamp is for what the range does NOT cover: int8 reaches
 *  −128, which nothing in core WRITES (`clampInt8` floors at SOLID) but a
 *  decoded chunk file can still carry, and `-(−128)` wraps back to −128 — a
 *  sample that is solid in the field AND solid in its cast, casting phantom
 *  geometry through rock. {@link AIR} is where it belongs. */
function invertDensity(density: Int8Array): Int8Array {
  const out = new Int8Array(density.length);
  for (let i = 0; i < density.length; i++) {
    const d = density[i] as number;
    out[i] = d === 0 ? -1 : Math.min(AIR, -d);
  }
  return out;
}

function handleVoidCast(
  msg: Extract<FieldWorkerRequest, { kind: "void-cast" }>,
  post: Post,
): void {
  const store = createFieldStore(msg.cellSize);
  // Snapshot install, the handleStampPreview contract: views over the request's
  // buffers, which the caller relinquished (production transfers them). Length
  // is checked here rather than left to the mesher's apron guard, which cannot
  // see it: a short chunk still EXTRACTS to a well-formed 20³ apron (the store
  // reads past it as unallocated rock), so the cast would come back
  // plausible-looking and quietly wrong instead of failing.
  for (const c of msg.chunks) {
    const density = new Int8Array(c.density);
    if (density.length !== CHUNK_SAMPLES)
      throw new Error(
        `void-cast: chunk ${c.key} must be ${CHUNK_SAMPLES} samples (16³), got ${density.length}`,
      );
    store.chunks.set(c.key, density);
  }
  const chunks: { key: string; buckets: WireBucket[] }[] = [];
  const transfer: Transferable[] = [];
  for (const key of store.chunks.keys()) {
    const aprons = extractFieldAprons(store, key);
    // Invert AFTER extraction, never the store before it: the apron's outer
    // ring reads UNALLOCATED space as SOLID, which is what the real field holds
    // there, so inverting the extracted window is the honest transform. Invert
    // the store's own chunks instead and that ring stays solid-by-default —
    // i.e. reads as cast-solid — and the cast runs open past every allocated
    // boundary instead of capping against the rock outside it.
    const buckets = toWireBuckets(
      meshChunkField(
        { density: invertDensity(aprons.density), materials: aprons.materials },
        BUILTIN_TABLE,
        msg.cellSize,
      ).buckets,
    );
    if (buckets.length === 0) continue;
    transfer.push(...bucketTransfer(buckets));
    chunks.push({ key, buckets });
  }
  post({ kind: "void-casted", jobId: msg.jobId, chunks }, transfer);
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
  // A `contextFree: false` generator (scatter) READS the field to place its
  // instances, so the preview hands it the SCRATCH store the snapshot was just
  // installed into — the same store the ghost is meshed from, which is what
  // makes preview and commit agree. Context-free defs get `undefined` and ignore
  // it (core's own evaluateGenerator makes the same call).
  const evaluated = def.evaluate(
    msg.params,
    msg.seed,
    msg.region,
    msg.table,
    msg.policy,
    def.contextFree ? undefined : { store },
  );
  const evalMs = performance.now() - t0;
  const dirty = new Set<string>();
  let nextId = 1;
  for (const op of evaluated.ops) {
    const id = nextId++;
    // Placements write no cells and are returned unmeshed in the response.
    const r =
      op.kind === "patch"
        ? applyPatchOp(store, { ...op, id })
        : applyOp(store, { ...op, id }, msg.table);
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
      opCount: evaluated.ops.length,
      evalMs,
      placements: evaluated.placements,
    },
    transfer,
  );
}

// The failing request's `mesh-error.key`. Exhaustive by construction: a new
// request kind with no case leaves a `string | undefined` return the declared
// type rejects.
function errorKey(msg: FieldWorkerRequest): string {
  switch (msg.kind) {
    case "mesh":
      return msg.key;
    case "stamp-preview":
      return msg.generator;
    case "void-cast":
      return VOID_CAST_ERROR_KEY;
  }
}

/** Pure handler factory (worker entry wires post = self.postMessage). Never
 *  throws — every failure posts a typed mesh-error message (a worker-side
 *  throw would surface as a generic ErrorEvent with no jobId). */
export function createFieldWorkerHandler(post: Post) {
  return (msg: FieldWorkerRequest): void => {
    try {
      if (msg.kind === "mesh") handleMesh(msg, post);
      else if (msg.kind === "stamp-preview") handleStampPreview(msg, post);
      else handleVoidCast(msg, post);
    } catch (err) {
      // A malformed apron (mesher/skinner length guard), an unknown class
      // (classOf throw), or a generator lookup/param/evaluate failure surfaces
      // here as a typed, jobId-carrying error, under the request's key or its
      // documented sentinel (see FieldWorkerResponse).
      const message = err instanceof Error ? err.message : String(err);
      post(
        { kind: "mesh-error", jobId: msg.jobId, key: errorKey(msg), message },
        [],
      );
    }
  };
}
