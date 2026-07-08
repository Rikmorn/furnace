// packages/dungeon/src/wing-loader.ts
// Load a baked generated wing (Slice 3.1 spec §5, consolidated in 3.2.1): fragment-load the
// ONE merged render-only doc, create static bodies from the manifest's cuboid lists,
// regenerate the cave voxel
// proxy from provenance, and re-expand dressing deterministically (the load-time
// embryo of 3.3's generator-entity expansion). Returns null when no wing is baked, so
// the caller falls back to live generation — the shipped game never regresses.
import type { Context } from "@furnace/core/gpu";
import type * as mesh from "@furnace/core/mesh";
import * as physics from "@furnace/core/physics";
import {
  decodeMeshBlob,
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
import type {
  RegionCollider,
  RegionData,
  RegionParams,
  ThemeName,
  Vec3,
} from "./region.ts";
import { GENERATOR_VERSION, themes } from "./region.ts";
import { type CaveParams, caveDressing, caveProxy } from "./themes/cave.ts";

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
 * Renders from the single merged render-only doc, collides against the manifest's
 * world-frame cuboids plus a cave voxel proxy regenerated from provenance, and re-expands
 * each region's decorative scatter deterministically from the seed.
 *
 * @throws if the manifest version is unknown, was baked by a different `generatorVersion`
 *   than the running runtime, or is a pre-consolidation bake (no `scene` field) — all
 *   stale-bake conditions; re-bake.
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

  // 1) The ONE merged render-only doc → meshes; manifest cuboids → static bodies.
  const doc = (await (
    await fetchArtifact(`/${manifest.scene}`)
  ).json()) as SceneDocument;
  const scene = await loadScene(ctx, doc, { world, fragment: true });
  for (const entry of [...manifest.regions, ...manifest.connectors]) {
    createColliderBodies(ctx, world, entry.colliders);
  }
  // 2) Cave voxel proxies re-expanded from provenance (voxel shapes never serialize).
  for (const r of manifest.regions) createCaveProxyBody(ctx, world, r);
  // 3) Dressing re-expanded from the seed → GPU-instanced draws (no colliders, no meshes).
  // The `.fmesh` sidecars live beside the merged scene doc — derive their base dir from it.
  const dir = manifest.scene.slice(0, manifest.scene.lastIndexOf("/"));
  const realized: Awaited<ReturnType<typeof realizeRegion>>[] = [];
  for (const r of manifest.regions) {
    const dressing = await dressingFor(r, dir);
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
    meshes: scene.meshes,
    instanced: realized.flatMap((a) => a.instanced),
    dynamicProps: realized.flatMap((a) => a.dynamicProps),
    update: () => {
      for (const a of realized) a.update();
    },
    destroy: () => {
      for (const a of realized) a.destroy();
      scene.destroy();
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
  // Boundary cast: manifest is external JSON; a pre-consolidation bake lacks the declared scene field.
  if (typeof (manifest as { scene?: unknown }).scene !== "string") {
    throw new Error(
      "wing: stale pre-consolidation bake (manifest has no scene) — re-bake",
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

/** Build one piece's manifest cuboid colliders as static bodies (the `LEVEL_BOXES` pattern).
 *  Regions and connectors both carry a cuboid `colliders` list, so one path serves both;
 *  their render-only meshes live in the wing's single merged scene doc, loaded once above. */
function createColliderBodies(
  ctx: Context,
  world: physics.World,
  colliders: RegionCollider[],
): void {
  for (const c of colliders) {
    physics.createBody(ctx, world, {
      type: "static",
      shape: c.shape,
      position: c.position,
      rotation: c.rotation,
    });
  }
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
  if (!r.themeParams)
    throw new Error(
      `wing: cave region ${r.id} lacks themeParams — re-bake the wing`,
    );
  // Boundary cast: themeParams is the materializer's recorded cave call params
  // (mouths/capped) from the manifest JSON; cave() itself validates them setup-loud.
  const local = caveProxy({
    theme: "cave",
    seed: r.seed,
    origin: LOCAL_ORIGIN,
    ...r.themeParams,
  } as CaveParams);
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
async function dressingFor(
  r: WingRegionEntry,
  dir: string,
): Promise<RegionData | null> {
  if (r.theme === "cave") {
    if (!r.themeParams)
      throw new Error(
        `wing: cave region ${r.id} lacks themeParams — re-bake the wing`,
      );
    // The cave's baked isosurface (mesh index 0) sidecar — see bake.ts appendPiece; it
    // lives beside the merged scene doc, so its base dir comes from `manifest.scene`.
    const buf = await (
      await fetchArtifact(`/${dir}/${r.id}-0.fmesh`)
    ).arrayBuffer();
    const surface = decodeMeshBlob(buf).render;
    // Boundary cast: see createCaveProxyBody — recorded materializer params.
    const d = caveDressing(
      {
        theme: "cave",
        seed: r.seed,
        origin: LOCAL_ORIGIN,
        ...r.themeParams,
      } as CaveParams,
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
  // Boundary cast + spread: themeParams is the materializer's recorded extra generator
  // params (e.g. pillarHall's graph-derived multi-door specs). WITHOUT them the re-run
  // falls back to theme defaults (single S door) → different scatter keep-outs → solid
  // dressing lands in the real doorways (the 3.1-gate "blocked rooms" bug). The theme
  // generator validates the params setup-loud.
  const full = themes[name]({
    theme: name,
    seed: r.seed,
    origin: LOCAL_ORIGIN,
    ...(r.themeParams ?? {}),
  } as RegionParams);
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
