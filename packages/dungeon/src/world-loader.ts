// packages/dungeon/src/world-loader.ts
// Load a baked declarative world (Epic 3 W1): the GAME-side mirror of `wing-loader.ts`
// against the world manifest. Reads the worlds index → the default world's manifest,
// fragment-loads the ONE merged render-only doc, creates static bodies from the manifest's
// per-region cuboid lists, re-expands each cave's voxel proxy + dressing from provenance,
// and — the new W1 behaviour — re-expands each CONNECTOR's voxel proxy from its placed
// portals + tunnel opts (the connector carries no cuboids: its collision IS the bore).
//
// SETUP-LOUD, no live-generation fallback (unlike wing-loader's null-on-404): a healthy
// clone commits the default world's fixtures, so a missing index/manifest is a broken
// checkout, not a "nothing baked yet" state — throw with a fix-it message rather than
// silently degrade.
import type { Context } from "@furnace/core/gpu";
import type * as mesh from "@furnace/core/mesh";
import * as physics from "@furnace/core/physics";
import {
  decodeMeshBlob,
  loadScene,
  type SceneDocument,
} from "@furnace/core/scene";
import {
  type WorldConnectorEntry,
  type WorldManifest,
  type WorldRegionEntry,
  worldDir,
} from "./bake.ts";
import { placePiece } from "./connect.ts";
import { organicTunnel } from "./connector.ts";
import {
  type DynamicProp,
  type MaterialCache,
  realizeRegion,
} from "./realize.ts";
import {
  GENERATOR_VERSION,
  type RegionCollider,
  type RegionData,
  type Vec3,
} from "./region.ts";
import { type CaveParams, caveDressing, caveProxy } from "./themes/cave.ts";

/** The runtime handles of a loaded world. The `LoadedWing` shape plus the player spawn the
 *  manifest bakes — so `main.ts` reads its spawn from the same object that carries the draws. */
export type LoadedWorld = {
  meshes: mesh.Mesh[];
  instanced: mesh.InstancedMesh[];
  dynamicProps: DynamicProp[];
  update: () => void;
  destroy: () => void;
  /** World-space player spawn baked by `realizeWorldSpec` (world-build.ts). */
  playerStart: Vec3;
  /** Player yaw (FpController convention) baked alongside `playerStart`. */
  playerYaw: number;
};

/** The only manifest version this loader understands. */
const SUPPORTED_MANIFEST_VERSION = 1;
/** Regions bake + re-expand in their own LOCAL frame; `placePiece` seats them in world. */
const LOCAL_ORIGIN: Vec3 = [0, 0, 0];
/** The well-known worlds index: `{ version, default }` — names the default world to load. */
const WORLDS_INDEX_PATH = "/worlds/index.json";

/** External-JSON shape of the worlds index (validated at the fetch boundary). */
type WorldsIndex = { version: number; default: string };

/**
 * Load the committed default world: worlds index → its manifest → the merged render-only
 * doc + deterministic re-expansion of every voxel proxy and dressing group, plus the baked
 * player spawn.
 *
 * Renders from the single merged doc, collides against the manifest's world-frame cuboids
 * plus a voxel proxy per cave (regenerated from `params`/`seed`) and per connector
 * (regenerated from its placed portals + tunnel opts), and re-expands each cave's decorative
 * scatter from the seed.
 *
 * @throws if the worlds index or the default world's manifest is missing (a broken clone —
 *   commit or bake a default world); if the manifest version is unknown or was baked by a
 *   different `generatorVersion`; or if a region declares an algorithm other than "cave"
 *   (only cave exists this slice).
 */
export async function loadWorld(
  ctx: Context,
  world: physics.World,
  matCache: MaterialCache,
): Promise<LoadedWorld> {
  const indexRes = await fetch(WORLDS_INDEX_PATH);
  if (!indexRes.ok) {
    throw new Error(
      `world: worlds index missing at ${WORLDS_INDEX_PATH} — commit or bake a default world`,
    );
  }
  // Boundary cast: the worlds index is external JSON — { version, default }.
  const index = (await indexRes.json()) as WorldsIndex;

  const manifestPath = `/${worldDir(index.default)}/manifest.json`;
  const manifestRes = await fetch(manifestPath);
  if (!manifestRes.ok) {
    throw new Error(
      `world: manifest missing at ${manifestPath} — commit or bake a default world`,
    );
  }
  // Boundary cast: the manifest is external JSON; assertCompatible validates it.
  const manifest = (await manifestRes.json()) as WorldManifest;
  assertCompatible(manifest);

  // 1) The ONE merged render-only doc → meshes (regions AND connectors, resource-key-prefixed).
  // Boundary cast: the merged scene doc is external JSON; loadScene validates it.
  const doc = (await (
    await fetchArtifact(`/${manifest.scene}`)
  ).json()) as SceneDocument;
  const scene = await loadScene(ctx, doc, { world, fragment: true });

  // 2) Region cuboids → static bodies; each cave's voxel proxy re-expanded from provenance.
  for (const r of manifest.regions) {
    createColliderBodies(ctx, world, r.cuboids);
    createCaveProxyBody(ctx, world, r);
  }
  // 3) Each connector's voxel proxy re-expanded from its placed portals + tunnel opts. The
  // connector carries NO cuboids — this bore IS its collision (the core new W1 behaviour).
  for (const c of manifest.connectors) createConnectorProxyBody(ctx, world, c);

  // 4) Dressing re-expanded from the seed + the decoded `.fmesh` → GPU-instanced draws (no
  // colliders, no meshes). The sidecars live beside the merged scene doc — derive their dir.
  const dir = manifest.scene.slice(0, manifest.scene.lastIndexOf("/"));
  const realized: Awaited<ReturnType<typeof realizeRegion>>[] = [];
  for (const r of manifest.regions) {
    const dressing = await dressingFor(r, dir);
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
    playerStart: manifest.playerStart,
    playerYaw: manifest.playerYaw,
  };
}

/** Reject a manifest the runtime cannot faithfully reproduce (wrong schema, generator, or
 *  content). PURE manifest inspection — runs BEFORE any GPU/scene allocation, so a malformed
 *  region algorithm / connector kind throws setup-loud without leaking an already-loaded
 *  scene (the "throws before GPU use" invariant covers content errors, not only 404s). */
function assertCompatible(manifest: WorldManifest): void {
  if (manifest.version !== SUPPORTED_MANIFEST_VERSION) {
    throw new Error(`world: unknown manifest version ${manifest.version}`);
  }
  if (manifest.provenance.generatorVersion !== GENERATOR_VERSION) {
    throw new Error(
      `world: baked with generatorVersion ${manifest.provenance.generatorVersion}, runtime is ${GENERATOR_VERSION} — re-bake`,
    );
  }
  // Boundary cast: manifest is external JSON; a malformed/pre-schema bake lacks the scene field.
  if (typeof (manifest as { scene?: unknown }).scene !== "string") {
    throw new Error("world: malformed bake (manifest has no scene) — re-bake");
  }
  // Content validation BEFORE loadScene: only cave/organic-tunnel exist this slice, so an
  // unknown algorithm/kind is a stale/foreign bake — throw here, not mid-loop after GPU alloc.
  for (const r of manifest.regions) {
    if (r.algorithm !== "cave") {
      throw new Error(
        `world: unsupported region algorithm "${r.algorithm}" — re-bake`,
      );
    }
  }
  for (const c of manifest.connectors) {
    if (c.kind !== "organic-tunnel") {
      throw new Error(
        `world: unsupported connector kind "${c.kind}" — re-bake`,
      );
    }
  }
}

/** Fetch a world artifact the manifest references, failing loud with the offending path on a
 *  partial/corrupt bake (a referenced doc/`.fmesh` missing → `serve.ts` 404) instead of the
 *  opaque downstream error (`"Not found" is not valid JSON` / `mesh-blob: bad magic`). NOT
 *  used for the index/manifest — those 404s are distinct "broken clone" throws above. */
async function fetchArtifact(path: string): Promise<Response> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`world: artifact ${path} failed to load (${res.status})`);
  }
  return res;
}

/** Build a region's manifest cuboid colliders as static bodies (the `LEVEL_BOXES` pattern).
 *  A region's render-only meshes live in the world's single merged scene doc, loaded once. */
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

/** Re-expand a cave region's field-derived voxel proxy from its recorded `params`/`seed` and
 *  seat it in world via the same placement its meshes went through. Setup-loud on any
 *  algorithm but "cave" — the only interior algorithm this slice (world-build.ts). */
function createCaveProxyBody(
  ctx: Context,
  world: physics.World,
  r: WorldRegionEntry,
): void {
  if (r.algorithm !== "cave") {
    throw new Error(
      `world: region ${r.id} has unsupported algorithm "${r.algorithm}" — only "cave" exists this slice`,
    );
  }
  // `theme: "cave"` widens to ThemeName; `params` is the recorded (typed) cave call params.
  const local = caveProxy({
    theme: "cave",
    seed: r.seed,
    origin: LOCAL_ORIGIN,
    ...r.params,
  } as CaveParams);
  // The proxy is LOCAL-frame; run it through `placePiece` (which rotates+translates a
  // collider's position and carries the yaw on its body rotation) so it lands exactly where
  // the placed meshes did. The voxel shape itself is placement-invariant.
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

/** Re-expand a connector's field-derived voxel proxy from its placed portals + EXPLICIT
 *  tunnel opts (the manifest records `radius`/`overshoot`, so a future non-default connector
 *  re-expands faithfully rather than snapping back to `organicTunnel`'s internal defaults).
 *  `organicTunnel`'s proxy is ALREADY world-frame (its portals are world-frame) — no
 *  `placePiece`. Setup-loud: the connector carries no cuboids, so this bore IS its collision. */
function createConnectorProxyBody(
  ctx: Context,
  world: physics.World,
  c: WorldConnectorEntry,
): void {
  if (c.kind !== "organic-tunnel") {
    throw new Error(
      `world: connector ${c.id} has unsupported kind "${c.kind}" — only "organic-tunnel" exists this slice`,
    );
  }
  const tunnel = organicTunnel(c.a, c.b, c.seed, {
    radius: c.radius,
    overshoot: c.overshoot,
  });
  const col = tunnel.colliders[0];
  if (!col) {
    throw new Error(
      `world: connector ${c.id} re-expanded no voxel proxy — traversal would break`,
    );
  }
  physics.createBody(ctx, world, {
    type: "static",
    shape: col.shape,
    position: col.position,
    rotation: col.rotation,
  });
}

/** Local-frame dressing for a baked cave region: scatter re-derived over its DECODED baked
 *  mesh (sidecar index 0), reproducing the live scatter byte-for-byte from the seed.
 *  `placePiece` seats it in world after. Cave-only — createCaveProxyBody already gated the
 *  algorithm setup-loud, so this is only reached for caves. */
async function dressingFor(
  r: WorldRegionEntry,
  dir: string,
): Promise<RegionData> {
  // The cave's baked isosurface (mesh index 0) sidecar — see bake.ts appendPiece; it lives
  // beside the merged scene doc, so its base dir comes from `manifest.scene`.
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
      ...r.params,
    } as CaveParams,
    surface,
  );
  return pieceRegion({ instances: d.instances, materials: d.materials });
}

/** A minimal, valid `RegionData` carrying only the fields a caller sets — the rest are empty
 *  defaults — so `placePiece`/`realizeRegion` can process a dressing or a lone collider
 *  without a full generator run. */
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
      seed: "world-loader",
    },
    ...over,
  };
}
