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
  // The unit-cube + quarter-turn no-normal-matrix invariant that makes
  // litInstanced safe is documented on core's `packKitMatrices` — do NOT swap to
  // non-axis-aligned kit geometry (it would skew normals with no test to catch).
  const g = geometry.cube(ctx, { size: 1 });
  const im = mesh.createInstanced(ctx, {
    geometry: g,
    material: mat,
    count: pieces.length,
  });
  const [cx, cy, cz] = field.parseChunkKey(key);
  const dim = field.CHUNK_DIM * cellSize;
  mesh.setInstanceMatrices(
    ctx,
    im,
    field.packKitMatrices(pieces, [cx * dim, cy * dim, cz * dim]),
  );
  pieces.forEach((k, i) =>
    mesh.setInstanceTint(ctx, im, i, field.pieceColor(table, k)),
  );
  return { im, g };
}
