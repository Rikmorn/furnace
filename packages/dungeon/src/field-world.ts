// packages/dungeon/src/field-world.ts
// Load a baked v2 FIELD world (One Field · F1 + F2a): the GAME-side loader for a `@furnace/core/field`
// bake. Where a v1 region world re-expands placed geometry from a manifest of regions/connectors,
// a field world is a chunked density store — so this rebuilds that store from the per-chunk
// density files (the authoring truth), derives one shell voxel collider per chunk for traversal,
// renders the pre-baked `.fmesh` per class with a per-class material (F2a), and draws one instanced
// kit mesh per kit chunk (F2a). `world-loader.ts` gates on `isFieldManifest` and dispatches here
// BEFORE its v1 `assertCompatible` (a field manifest has none of the v1 fields).
//
// Teardown discipline mirrors the v1 loader (realize.ts): static bodies are NOT freed here — they
// die with `physics.destroyWorld`; the returned `destroy()` frees only this world's meshes +
// geometries + instanced kit meshes (NOT the world, NOT the matCache).
import * as field from "@furnace/core/field";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type { Material } from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as physics from "@furnace/core/physics";
import { decodeMeshBlob } from "@furnace/core/scene";
import { mat4 } from "@furnace/core/transform";
import type { MaterialCache } from "./realize.ts";
import type { MaterialDescriptor } from "./region.ts";
import type { LoadedWorld } from "./world-loader.ts";

/** Narrow gate: is this parsed JSON a v2 field manifest? Discriminates a field world from a v1
 *  region world at the `world-loader` fetch boundary (both are `manifest.json`). The `version: 2`
 *  + `kind: "field"` pair is the discriminant baked by {@link field.bakeFieldWorld}. */
export function isFieldManifest(m: unknown): m is field.FieldManifest {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as { version?: unknown }).version === 2 &&
    (m as { kind?: unknown }).kind === "field"
  );
}

/** The lit stone material an F1 (table-less) field-world render mesh shares, and the shared
 *  specular every F2 per-class material rides (dungeon `MaterialDescriptor` shape — BOTH
 *  4-tuples). With a material table present, each mesh's colour comes from its class instead;
 *  {@link STONE.specular} stays the one specular across all field surfaces (colour-only variation,
 *  matching the editor field-host). */
const STONE: MaterialDescriptor = {
  color: [0.62, 0.6, 0.58, 1],
  specular: [0.06, 0.06, 0.06, 16],
};

// --- kit render math (PORTED from the editor field-host, viewport-host/field-host.ts) ----------
// The dungeon must render kit pieces exactly as the editor previews them, so the tint + yaw math
// is reproduced here byte-for-byte rather than imported (cross-package). NOTE: this is now the
// SECOND occurrence of this math (host + loader); a third would earn a shared @furnace/core/field
// kit-render helper — flagged for the planning session, deliberately not extracted here.

// Per-piece tint jitter (deterministic from the instance variant): scale RGB by
// KIT_TINT_JITTER_BASE + KIT_TINT_JITTER_SPAN·variant.
const KIT_TINT_JITTER_BASE = 0.92;
const KIT_TINT_JITTER_SPAN = 0.16;

// Exact quarter-turn yaw quaternions (rotation about +Y): (0, sin(θ/2), 0, cos(θ/2)). No trig —
// kit yaws are always {0, ±π/2, π}.
const S = Math.SQRT1_2;
const YAW_ZERO = new Float32Array([0, 0, 0, 1]); // 0°
const YAW_PLUS_90 = new Float32Array([0, S, 0, S]); // +90°
const YAW_180 = new Float32Array([0, 1, 0, 0]); // 180°
const YAW_MINUS_90 = new Float32Array([0, -S, 0, S]); // -90° / 270°

// Kit piece kind → its KitStyle.pieceColors bucket.
const PIECE_COLOR_KEY: Record<
  field.KitPieceId,
  keyof field.KitStyle["pieceColors"]
> = {
  panel: "panel",
  floorTile: "floor",
  ceilTile: "floor",
  post: "trim",
  rimPostV: "collar",
  rimEdgeH: "collar",
};

/** Exact yaw quaternion for a quarter-turn rotation about +Y (yaw ∈ {0, ±π/2, π}). */
function yawQuat(yaw: number): Float32Array {
  const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  switch (q) {
    case 1:
      return YAW_PLUS_90;
    case 2:
      return YAW_180;
    case 3:
      return YAW_MINUS_90;
    default:
      return YAW_ZERO;
  }
}

/** Per-instance tint for a kit piece: the class's KitStyle piece colour, jittered by the instance
 *  variant (RGB only; alpha carried through). Falls back to white for a non-kit class (defensive —
 *  the skinner only emits kit pieces for kit classes). */
function pieceColor(
  table: field.MaterialTable,
  k: field.KitInstance,
): [number, number, number, number] {
  const cls = field.classOf(table, k.classId);
  if (cls.kind !== "kit") return [1, 1, 1, 1];
  const base = cls.kit.pieceColors[PIECE_COLOR_KEY[k.piece]];
  const j = KIT_TINT_JITTER_BASE + KIT_TINT_JITTER_SPAN * k.variant;
  return [base[0] * j, base[1] * j, base[2] * j, base[3]];
}

/** The render-material descriptor for one manifest mesh bucket. Table ABSENT (F1 bake) → the shared
 *  {@link STONE}. Table present → the entry's class colour: an ORGANIC class contributes its
 *  surface colour; a kit BACKING bucket contributes the kit's `backingColor` (the raw surface
 *  behind proud kit pieces). Every field surface shares {@link STONE.specular} (colour-only
 *  variation, matching the editor field-host). */
function materialDescriptorFor(
  entry: field.FieldManifest["meshes"][number],
  table: field.MaterialTable | undefined,
): MaterialDescriptor {
  if (!table) return STONE;
  const cls = field.classOf(table, entry.classId ?? field.MAT_ROCK);
  if (entry.backing) {
    const color = cls.kind === "kit" ? cls.kit.backingColor : cls.color;
    return { color, specular: STONE.specular };
  }
  return { color: cls.color, specular: STONE.specular };
}

/**
 * Load a baked v2 field world into `world`: rebuild the density store from its per-chunk files →
 * one static shell voxel collider per chunk (traversal), the pre-baked `.fmesh` render mesh per
 * class with a per-class material, and one instanced kit mesh per kit chunk. Returns the same
 * {@link LoadedWorld} shape the v1 loader does, so `main.ts` reads its spawn + draws from one
 * object regardless of world class.
 *
 * @throws if a manifest-referenced chunk density file, render mesh, or kit file fails to fetch (a
 *   partial / corrupt bake) — setup-loud, like the v1 loader's `fetchArtifact`.
 */
export async function loadFieldWorld(
  ctx: Context,
  world: physics.World,
  matCache: MaterialCache,
  manifest: field.FieldManifest,
  baseUrl: string, // "/worlds/<name>"
): Promise<LoadedWorld> {
  const store = await rebuildStore(manifest, baseUrl);
  createColliderBodies(ctx, world, store);
  const { meshes, geometries } = await buildRenderMeshes(
    ctx,
    matCache,
    manifest,
    baseUrl,
  );
  const kitOwned = await buildKitInstances(
    ctx,
    matCache,
    manifest,
    store.cellSize,
    baseUrl,
  );

  return {
    meshes,
    instanced: kitOwned.map((o) => o.im),
    dynamicProps: [],
    update: () => {
      // No-op: a field world is static level geometry — no dynamic props to sync per frame.
      // The LoadedWorld contract requires an `update`, so it's present but intentionally empty.
    },
    // Match the v1 loader's teardown: free THIS world's meshes + geometries + instanced kit only;
    // the static collider bodies die with the world (physics.destroyWorld), never explicitly here.
    // Mirrors the field-host destroy order: destroyInstanced BEFORE the kit geometry.
    destroy: () => {
      for (const m of meshes) mesh.destroy(ctx, m);
      for (const g of geometries) geometry.destroy(ctx, g);
      for (const o of kitOwned) {
        mesh.destroyInstanced(ctx, o.im);
        geometry.destroy(ctx, o.g);
      }
    },
    playerStart: manifest.playerStart,
    playerYaw: manifest.playerYaw,
  };
}

/** Rebuild the density store from the manifest's per-chunk density files (the authoring truth).
 *  Sequential (`for ... await`) so a partial bake fails loud on the FIRST missing chunk. */
async function rebuildStore(
  manifest: field.FieldManifest,
  baseUrl: string,
): Promise<field.FieldStore> {
  const store = field.createFieldStore(manifest.cellSize);
  for (const c of manifest.chunks) {
    const res = await fetch(`${baseUrl}/${c.file}`);
    if (!res.ok) {
      throw new Error(`field world: chunk missing ${c.file} (${res.status})`);
    }
    store.chunks.set(
      c.key,
      field.decodeChunkFile(new Uint8Array(await res.arrayBuffer())),
    );
  }
  return store;
}

/** One static shell voxel collider per allocated chunk (interior rock is unreachable, so only the
 *  air-adjacent shell colliders). Density-only: masonry is solid density, so a kit wall blocks with
 *  no material-channel involvement here. Bodies die with the world — not tracked for teardown,
 *  matching the v1 loader's `createColliderBodies`. */
function createColliderBodies(
  ctx: Context,
  world: physics.World,
  store: field.FieldStore,
): void {
  for (const key of store.chunks.keys()) {
    const col = field.chunkColliders(store, key);
    if (col === null) continue;
    physics.createBody(ctx, world, {
      type: "static",
      shape: { voxels: { coords: col.coords, size: col.size } },
      position: col.position,
    });
  }
}

/** Decode each per-class `.fmesh` bucket into a GPU mesh at its chunk origin, each with the
 *  material its class resolves to ({@link materialDescriptorFor}). `matCache.get` dedupes by
 *  descriptor, so classes sharing a colour share one material. Returns meshes + owned geometries
 *  for teardown. Sequential (`for ... await`): `matCache.get` is async and not concurrency-safe. */
async function buildRenderMeshes(
  ctx: Context,
  matCache: MaterialCache,
  manifest: field.FieldManifest,
  baseUrl: string,
): Promise<{ meshes: mesh.Mesh[]; geometries: geometry.Geometry[] }> {
  const meshes: mesh.Mesh[] = [];
  const geometries: geometry.Geometry[] = [];
  const table = manifest.materialTable;
  for (const m of manifest.meshes) {
    const mat = await matCache.get(materialDescriptorFor(m, table));
    const res = await fetch(`${baseUrl}/${m.file}`);
    if (!res.ok) {
      throw new Error(`field world: mesh missing ${m.file} (${res.status})`);
    }
    const blob = decodeMeshBlob(await res.arrayBuffer());
    const g = geometry.create(ctx, blob.render, { retainForCollision: false });
    const handle = mesh.create(ctx, { geometry: g, material: mat });
    mesh.setPosition(ctx, handle, new Float32Array(m.origin));
    geometries.push(g);
    meshes.push(handle);
  }
  return { meshes, geometries };
}

/** One owned instanced kit mesh: the draw handle + its per-chunk unit-cube geometry. */
type KitOwned = { im: mesh.InstancedMesh; g: geometry.Geometry };

/** Build one instanced kit mesh per kit chunk: a unit cube drawn once per piece, each transformed
 *  by its (yaw · box) matrix at its world position (chunk-local position + chunk origin), tinted
 *  per piece. One packed matrix array + one bulk upload per chunk. All kit pieces share ONE
 *  white-base lit-instanced material (per-piece colour rides the tint). Sequential (`for ... await`):
 *  `matCache.getInstanced` is async and not concurrency-safe. */
async function buildKitInstances(
  ctx: Context,
  matCache: MaterialCache,
  manifest: field.FieldManifest,
  cellSize: number,
  baseUrl: string,
): Promise<KitOwned[]> {
  const table = manifest.materialTable;
  const kitFiles = manifest.kit ?? [];
  if (kitFiles.length === 0 || !table) return [];
  const mat = await matCache.getInstanced(
    { color: [1, 1, 1, 1], specular: STONE.specular },
    "lit",
  );
  const owned: KitOwned[] = [];
  for (const { key, file } of kitFiles) {
    const res = await fetch(`${baseUrl}/${file}`);
    if (!res.ok) {
      throw new Error(`field world: kit missing ${file} (${res.status})`);
    }
    // Boundary cast: the kit file is external JSON — an array of KitInstance the bake wrote.
    const pieces = (await res.json()) as field.KitInstance[];
    if (pieces.length === 0) continue;
    owned.push(buildKitChunk(ctx, mat, table, key, pieces, cellSize));
  }
  return owned;
}

/** Build one chunk's instanced kit mesh from its pieces (chunk-local positions) at `key`'s world
 *  origin, packing every piece's TRS matrix into one array and uploading it in a single call, then
 *  tinting each instance per piece. */
function buildKitChunk(
  ctx: Context,
  mat: Material,
  table: field.MaterialTable,
  key: string,
  pieces: field.KitInstance[],
  cellSize: number,
): KitOwned {
  // Safe under litInstanced's no-normal-matrix shortcut (it reconstructs the world normal from
  // the upper 3×3 with no inverse-transpose) ONLY because this is an axis-aligned unit cube +
  // quarter-turn yaw: a per-axis-scaled face normal still normalize()s back to its correct
  // outward direction. Do NOT swap to non-axis-aligned kit geometry (beveled/rounded/cylindrical)
  // — non-uniform per-instance box scale would skew its normals with no compiler error and no test
  // to catch it (GPU-visual only). See field-host.ts buildKit, the first copy of this pattern.
  const g = geometry.cube(ctx, { size: 1 });
  const im = mesh.createInstanced(ctx, {
    geometry: g,
    material: mat,
    count: pieces.length,
  });
  const [cx, cy, cz] = field.parseChunkKey(key);
  const dim = field.CHUNK_DIM * cellSize;
  const ox = cx * dim;
  const oy = cy * dim;
  const oz = cz * dim;
  const packed = new Float32Array(16 * pieces.length);
  const m = mat4.create();
  const t = new Float32Array(3);
  const s = new Float32Array(3);
  pieces.forEach((k, i) => {
    t[0] = k.position[0] + ox;
    t[1] = k.position[1] + oy;
    t[2] = k.position[2] + oz;
    s[0] = k.box[0];
    s[1] = k.box[1];
    s[2] = k.box[2];
    mat4.fromRotationTranslationScale(m, yawQuat(k.yaw), t, s);
    packed.set(m, i * 16);
  });
  mesh.setInstanceMatrices(ctx, im, packed);
  pieces.forEach((k, i) =>
    mesh.setInstanceTint(ctx, im, i, pieceColor(table, k)),
  );
  return { im, g };
}
