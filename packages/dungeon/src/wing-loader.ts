// packages/dungeon/src/wing-loader.ts
// Load a baked generated wing (Slice 3.1 spec §5): fragment-load the render-only docs,
// create static bodies from the manifest's cuboid lists, regenerate the cave voxel
// proxy from provenance, and re-expand dressing deterministically (the load-time
// embryo of 3.3's generator-entity expansion). Returns null when no wing is baked, so
// the caller falls back to live generation — the shipped game never regresses.
import type { Context } from "@furnace/core/gpu";
import type * as mesh from "@furnace/core/mesh";
import * as physics from "@furnace/core/physics";
import {
  decodeMeshBlob,
  type LoadedScene,
  loadScene,
  type SceneDocument,
} from "@furnace/core/scene";
import { WING_DIR, type WingManifest, type WingRegionEntry } from "./bake.ts";
import { placePiece } from "./connect.ts";
import {
  type DynamicProp,
  type MaterialCache,
  realizeRegion,
} from "./realize.ts";
import type { RegionCollider, RegionData, ThemeName, Vec3 } from "./region.ts";
import { GENERATOR_VERSION, themes } from "./region.ts";
import { caveDressing, caveProxy } from "./themes/cave.ts";

/** The runtime handles of a loaded wing. Structurally identical to a `realizeRegion`
 *  result so it slots into `main.ts`'s `area` list beside live-realized regions. */
export type LoadedWing = {
  meshes: mesh.Mesh[];
  instanced: mesh.InstancedMesh[];
  dynamicProps: DynamicProp[];
  update: () => void;
  destroy: () => void;
};

/** The only manifest version this loader understands. */
const SUPPORTED_MANIFEST_VERSION = 1;
/** Regions bake + re-expand in their own LOCAL frame; `placePiece` seats them in world. */
const LOCAL_ORIGIN: Vec3 = [0, 0, 0];

/**
 * Load the baked wing if `regions/generated-wing/manifest.json` exists; `null` on a 404
 * (the caller falls back to live generation — the shipped game never regresses).
 *
 * Renders from the baked render-only docs, collides against the manifest's world-frame
 * cuboids plus a cave voxel proxy regenerated from provenance, and re-expands each
 * region's decorative scatter deterministically from the seed.
 *
 * @throws if the manifest version is unknown, or was baked by a different
 *   `generatorVersion` than the running runtime (stale bake — re-bake).
 */
export async function loadGeneratedWing(
  ctx: Context,
  world: physics.World,
  matCache: MaterialCache,
): Promise<LoadedWing | null> {
  const res = await fetch(`/${WING_DIR}/manifest.json`);
  if (!res.ok) return null;
  const manifest = (await res.json()) as WingManifest;
  assertCompatible(manifest);

  // 1) Render-only docs (regions + connectors) → meshes; manifest cuboids → static bodies.
  const scenes: LoadedScene[] = [];
  for (const entry of [...manifest.regions, ...manifest.connectors]) {
    scenes.push(await loadPieceDoc(ctx, world, entry));
  }
  // 2) Cave voxel proxies re-expanded from provenance (voxel shapes never serialize).
  for (const r of manifest.regions) createCaveProxyBody(ctx, world, r);
  // 3) Dressing re-expanded from the seed → GPU-instanced draws (no colliders, no meshes).
  const realized: Awaited<ReturnType<typeof realizeRegion>>[] = [];
  for (const r of manifest.regions) {
    const dressing = await dressingFor(r);
    if (!dressing) continue;
    realized.push(
      await realizeRegion(
        ctx,
        world,
        matCache,
        placePiece(dressing, r.placement),
      ),
    );
  }

  return {
    meshes: scenes.flatMap((s) => s.meshes),
    instanced: realized.flatMap((a) => a.instanced),
    dynamicProps: realized.flatMap((a) => a.dynamicProps),
    update: () => {
      for (const a of realized) a.update();
    },
    destroy: () => {
      for (const a of realized) a.destroy();
      for (const s of scenes) s.destroy();
    },
  };
}

/** Reject a manifest the runtime cannot faithfully reproduce (wrong schema or generator). */
function assertCompatible(manifest: WingManifest): void {
  if (manifest.version !== SUPPORTED_MANIFEST_VERSION) {
    throw new Error(`wing: unknown manifest version ${manifest.version}`);
  }
  if (manifest.provenance.generatorVersion !== GENERATOR_VERSION) {
    throw new Error(
      `wing: baked with generatorVersion ${manifest.provenance.generatorVersion}, runtime is ${GENERATOR_VERSION} — re-bake`,
    );
  }
}

/** Fetch a wing artifact the manifest references, failing loud with the offending path on
 *  a partial/corrupt bake (a referenced doc/`.fmesh` missing → `serve.ts` 404) instead of
 *  the opaque downstream error (`"Not found" is not valid JSON` / `mesh-blob: bad magic`).
 *  NOT used for the manifest itself — that fetch needs 404 → null (no wing baked). */
async function fetchArtifact(path: string): Promise<Response> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`wing: artifact ${path} failed to load (${res.status})`);
  }
  return res;
}

/** Fragment-load one piece's render-only doc into `world` and build its manifest cuboid
 *  colliders as static bodies (the `LEVEL_BOXES` pattern). Regions and connectors both
 *  carry a `file` + a cuboid `colliders` list, so one path serves both. */
async function loadPieceDoc(
  ctx: Context,
  world: physics.World,
  entry: { file: string; colliders: RegionCollider[] },
): Promise<LoadedScene> {
  const doc = (await (
    await fetchArtifact(`/${entry.file}`)
  ).json()) as SceneDocument;
  const scene = await loadScene(ctx, doc, { world, fragment: true });
  for (const c of entry.colliders) {
    physics.createBody(ctx, world, {
      type: "static",
      shape: c.shape,
      position: c.position,
      rotation: c.rotation,
    });
  }
  return scene;
}

/** Re-expand a cave region's field-derived voxel proxy from provenance and seat it in
 *  world via the same placement its meshes went through. Non-cave regions have no voxel
 *  proxy (their colliders are the serialized cuboids) — no-op. */
function createCaveProxyBody(
  ctx: Context,
  world: physics.World,
  r: WingRegionEntry,
): void {
  if (r.theme !== "cave") return;
  if (!r.caveParams)
    throw new Error(`wing: cave region ${r.id} lacks caveParams`);
  const local = caveProxy({
    theme: "cave",
    seed: r.seed,
    origin: LOCAL_ORIGIN,
    ...r.caveParams,
  });
  // The proxy is LOCAL-frame; run it through `placePiece` (which rotates+translates a
  // collider's position and carries the yaw on its body rotation) so it lands exactly
  // where the placed meshes did. The voxel shape itself is placement-invariant.
  const placed = placePiece(
    pieceRegion({
      colliders: [{ shape: local.shape, position: local.position }],
    }),
    r.placement,
  );
  const col = placed.colliders[0];
  if (!col) return;
  physics.createBody(ctx, world, {
    type: "static",
    shape: col.shape,
    position: col.position,
    rotation: col.rotation,
  });
}

/** Local-frame dressing for a baked region: a cave scatters over its DECODED baked mesh;
 *  a box theme re-runs its (cheap, meshless) generator and keeps only the instances.
 *  Returns null for a theme carrying no dressing. `placePiece` seats it in world after. */
async function dressingFor(r: WingRegionEntry): Promise<RegionData | null> {
  if (r.theme === "cave") {
    if (!r.caveParams)
      throw new Error(`wing: cave region ${r.id} lacks caveParams`);
    // The cave's baked isosurface (mesh index 0) sidecar — see bake.ts regionDoc.
    const buf = await (
      await fetchArtifact(`/${WING_DIR}/${r.id}-0.fmesh`)
    ).arrayBuffer();
    const surface = decodeMeshBlob(buf).render;
    const d = caveDressing(
      { theme: "cave", seed: r.seed, origin: LOCAL_ORIGIN, ...r.caveParams },
      surface,
    );
    return pieceRegion({ instances: d.instances, materials: d.materials });
  }
  // `Object.hasOwn` (not `in`): the manifest is an external-JSON trust boundary, and `in`
  // would also match Object.prototype keys (e.g. a hostile `theme: "constructor"`), calling
  // an inherited method as a generator. Own-key check rejects those → connectors/unknown.
  if (!Object.hasOwn(themes, r.theme)) return null;
  // Boundary cast: `Object.hasOwn(themes, r.theme)` proves the string is a live ThemeName key.
  const name = r.theme as ThemeName;
  const full = themes[name]({
    theme: name,
    seed: r.seed,
    origin: LOCAL_ORIGIN,
  });
  return pieceRegion({ instances: full.instances, materials: full.materials });
}

/** A minimal, valid `RegionData` carrying only the fields a caller sets — the rest are
 *  empty defaults — so `placePiece`/`realizeRegion` can process a dressing or a lone
 *  collider without a full generator run. */
function pieceRegion(over: Partial<RegionData>): RegionData {
  return {
    meshes: [],
    colliders: [],
    materials: [],
    connections: [],
    instances: [],
    origin: LOCAL_ORIGIN,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "connector",
      seed: "wing-loader",
    },
    ...over,
  };
}
