// packages/dungeon/src/field-world.ts
// Load a baked v2 FIELD world (One Field · F1): the GAME-side loader for a `@furnace/core/field`
// bake. Where a v1 region world re-expands placed geometry from a manifest of regions/connectors,
// a field world is a chunked density store — so this rebuilds that store from the per-chunk
// density files (the authoring truth), derives one shell voxel collider per chunk for traversal,
// and renders the pre-baked `.fmesh` per chunk. `world-loader.ts` gates on `isFieldManifest` and
// dispatches here BEFORE its v1 `assertCompatible` (a field manifest has none of the v1 fields).
//
// Teardown discipline mirrors the v1 loader (realize.ts): static bodies are NOT freed here — they
// die with `physics.destroyWorld`; the returned `destroy()` frees only this world's meshes +
// geometries (NOT the world, NOT the matCache).
import * as field from "@furnace/core/field";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
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

/** The single lit stone material every field-world render mesh shares (color + specular, dungeon
 *  `MaterialDescriptor` shape — BOTH 4-tuples). Per-material variety is future work; the field
 *  bake carries no material data yet. */
const STONE: MaterialDescriptor = {
  color: [0.62, 0.6, 0.58, 1],
  specular: [0.06, 0.06, 0.06, 16],
};

/**
 * Load a baked v2 field world into `world`: rebuild the density store from its per-chunk files →
 * one static shell voxel collider per chunk (traversal), plus the pre-baked `.fmesh` render mesh
 * per carved chunk. Returns the same {@link LoadedWorld} shape the v1 loader does, so `main.ts`
 * reads its spawn + draws from one object regardless of world class.
 *
 * @throws if a manifest-referenced chunk density file or render mesh fails to fetch (a partial /
 *   corrupt bake) — setup-loud, like the v1 loader's `fetchArtifact`.
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

  return {
    meshes,
    instanced: [],
    dynamicProps: [],
    update: () => {
      // No-op: a field world is static level geometry — no dynamic props to sync per frame.
      // The LoadedWorld contract requires an `update`, so it's present but intentionally empty.
    },
    // Match the v1 loader's teardown: free THIS world's meshes + geometries only; the static
    // collider bodies die with the world (physics.destroyWorld), never explicitly here.
    destroy: () => {
      for (const m of meshes) mesh.destroy(ctx, m);
      for (const g of geometries) geometry.destroy(ctx, g);
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
 *  air-adjacent shell colliders). Bodies die with the world — not tracked for teardown, matching
 *  the v1 loader's `createColliderBodies`. */
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

/** Decode each carved chunk's pre-baked `.fmesh` into a GPU mesh at its chunk origin, all sharing
 *  the one STONE material. Returns meshes + owned geometries for teardown. */
async function buildRenderMeshes(
  ctx: Context,
  matCache: MaterialCache,
  manifest: field.FieldManifest,
  baseUrl: string,
): Promise<{ meshes: mesh.Mesh[]; geometries: geometry.Geometry[] }> {
  const meshes: mesh.Mesh[] = [];
  const geometries: geometry.Geometry[] = [];
  const mat = await matCache.get(STONE);
  for (const m of manifest.meshes) {
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
