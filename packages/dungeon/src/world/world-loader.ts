// packages/dungeon/src/world/world-loader.ts
// Load a baked declarative world (Epic 3 W1): the GAME-side loader for the world
// manifest. Reads the worlds index → the default world's manifest,
// fragment-loads the ONE merged render-only doc, creates static bodies from the manifest's
// per-region cuboid lists, re-expands each cave's voxel proxy + dressing from provenance,
// and — the new W1 behaviour — re-expands each CONNECTOR's voxel proxy from its placed
// portals + tunnel opts (the connector carries no cuboids: its collision IS the bore).
//
// SETUP-LOUD: a missing index/manifest THROWS with a fix-it message — there is no
// live-generation fallback. A healthy clone commits the default world's fixtures, so an
// absent index/manifest is a broken checkout, not a "nothing baked yet" state; failing
// loudly beats silently degrading.
import type { Context } from "@furnace/core/gpu";
import type * as mesh from "@furnace/core/mesh";
import { decodeMeshBlob } from "@furnace/core/mesh-blob";
import * as physics from "@furnace/core/physics";
import { loadScene, type SceneDocument } from "@furnace/core/scene";
import { isFieldManifest, loadFieldWorld } from "../field/field-world.ts";
import { type CaveParams, caveDressing, caveProxy } from "../themes/cave.ts";
import {
  type WorldBoreConnectorEntry,
  type WorldCaveRegionEntry,
  type WorldManifest,
  worldDir,
} from "./bake.ts";
import { organicTunnel } from "./connector.ts";
import { buildCorridor } from "./connector-built.ts";
import { placePiece } from "./placement.ts";
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
import { expandGridRegionFromEntry } from "./world-build.ts";

/** The runtime handles of a loaded world: its draws (region + dressing meshes, dynamic props)
 *  and per-frame/teardown hooks, plus the player spawn the manifest bakes — so `main.ts` reads
 *  its spawn from the same object that carries the draws. */
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
/** The connector kinds a W2 manifest may declare (assertCompatible rejects the rest). */
const KNOWN_CONNECTOR_KINDS = new Set([
  "organic-tunnel",
  "corridor",
  "aperture",
  "collar-bore",
]);

/** External-JSON shape of the worlds index (validated at the fetch boundary). */
type WorldsIndex = { version: number; default: string };

/**
 * Load the committed default world: worlds index → its manifest → the merged render-only
 * doc + deterministic re-expansion of every voxel proxy and dressing group, plus the baked
 * player spawn.
 *
 * Renders from the single merged doc for the cave + collar-bore/organic-tunnel meshes,
 * plus RE-EXPANDED render for the grid class: each `hall`/`maze` region rebuilds its patch
 * mesh + kit instances + voxel collider via `expandGridRegion`, and each `corridor` re-expands
 * its tube — neither bakes scene entities (D-W2-6). Collides against the manifest's world-frame
 * cuboids, a voxel proxy per cave and per organic-tunnel/collar-bore connector, and the
 * re-expanded grid/corridor voxel proxies. Cave scatter re-expands from the seed.
 *
 * @throws if the worlds index or the default world's manifest is missing (a broken clone —
 *   commit or bake a default world); if the manifest version is unknown or was baked by a
 *   different `generatorVersion`; or if a region algorithm is not `cave`/`hall`/`maze` or a
 *   connector kind is not one of the four W2 kinds (a stale/foreign bake).
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
  // Boundary cast: the manifest is external JSON — inspect it as `unknown` so the v2 field-world
  // gate can branch off it BEFORE the v1 `assertCompatible`. A v2 field manifest has none of the
  // v1 fields (provenance, scene, regions), so it MUST NOT reach `assertCompatible`.
  const manifestJson = (await manifestRes.json()) as unknown;
  if (isFieldManifest(manifestJson)) {
    return loadFieldWorld(
      ctx,
      world,
      matCache,
      manifestJson,
      `/${worldDir(index.default)}`,
    );
  }
  // Boundary cast: past the v2 gate this is a v1 region-world manifest; assertCompatible validates it.
  const manifest = manifestJson as WorldManifest;
  assertCompatible(manifest);
  // Dev-facing load banner: which bake is this? (bakedAt is deliberately absent —
  // re-bakes are byte-deterministic — so the seeds ARE the bake's identity.)
  console.info(
    `world "${index.default}" loaded: ${manifest.regions.length} region(s) [${manifest.regions
      .map((r) => `${r.id}:${r.seed}`)
      .join(", ")}], ${manifest.connectors.length} connector(s)`,
  );

  // 1) The ONE merged render-only doc → meshes (regions AND connectors, resource-key-prefixed).
  // Boundary cast: the merged scene doc is external JSON; loadScene validates it.
  const doc = (await (
    await fetchArtifact(`/${manifest.scene}`)
  ).json()) as SceneDocument;
  const scene = await loadScene(ctx, doc, { world, fragment: true });

  // The sidecars (cave `.fmesh`) live beside the merged scene doc — derive their base dir.
  const dir = manifest.scene.slice(0, manifest.scene.lastIndexOf("/"));
  // Every re-expanded region/connector `realizeRegion` result: grid regions + corridors bake
  // NO scene entities, so their meshes/instances come back HERE, not from the merged doc.
  const realized: Awaited<ReturnType<typeof realizeRegion>>[] = [];

  // 2) Regions dispatched by class. Cave: manifest cuboids → static bodies, voxel proxy +
  // dressing re-expanded from provenance. Grid (hall|maze): ONE `realizeRegion` builds its
  // patch mesh, kit instances AND voxel collider from the re-expanded local RegionData (D-W2-6).
  for (const r of manifest.regions) {
    if (r.class === "field-organic") {
      createColliderBodies(ctx, world, r.cuboids);
      createCaveProxyBody(ctx, world, r);
      const dressing = await dressingFor(r, dir);
      realized.push(
        await realizeRegion(
          ctx,
          world,
          matCache,
          placePiece(dressing, r.placement),
        ),
      );
      continue;
    }
    // grid-built (hall | maze): re-expand its local RegionData from params/seed + the touching
    // connectors (grouped by aRef/bRef), then place it. `realizeRegion` creates the voxel
    // body + patch mesh + kit instances in one call — no separate cuboids/proxy/dressing.
    const touching = manifest.connectors.filter(
      (c) => c.aRef[0] === r.id || c.bRef[0] === r.id,
    );
    const data = expandGridRegionFromEntry(r, touching, r.id);
    realized.push(
      await realizeRegion(ctx, world, matCache, placePiece(data, r.placement)),
    );
  }

  // 3) Connectors dispatched by kind. organic-tunnel / collar-bore: voxel proxy re-expanded
  // from its placed portals + tunnel opts (its render mesh came from the merged doc). corridor:
  // re-expand its world-frame tube via `realizeRegion` (already world-frame — NO placePiece).
  // aperture: a pure hole (no proxy, no render).
  for (const c of manifest.connectors) {
    if (c.kind === "organic-tunnel" || c.kind === "collar-bore") {
      createConnectorProxyBody(ctx, world, c);
    } else if (c.kind === "corridor") {
      realized.push(
        await realizeRegion(
          ctx,
          world,
          matCache,
          buildCorridor(c.a, c.b, c.seed),
        ),
      );
    }
  }

  return {
    // Grid-region + corridor meshes re-expand HERE (not in the merged doc); cave +
    // collar-bore/organic-tunnel meshes stay in `scene.meshes`.
    meshes: [...scene.meshes, ...realized.flatMap((a) => a.meshes)],
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
  // Content validation BEFORE loadScene: cave + hall + maze regions and all four connector
  // kinds exist as of W3, so anything else is a stale/foreign bake — throw here, not mid-loop
  // after GPU alloc.
  for (const r of manifest.regions) {
    // The manifest is external JSON: widen `algorithm` to `string` so an unknown value from a
    // stale/foreign bake is caught here rather than exhausting the typed union to `never`.
    const algorithm: string = r.algorithm;
    if (algorithm !== "cave" && algorithm !== "hall" && algorithm !== "maze") {
      throw new Error(
        `world: unsupported region algorithm "${algorithm}" — re-bake`,
      );
    }
  }
  for (const c of manifest.connectors) {
    const kind: string = c.kind;
    if (!KNOWN_CONNECTOR_KINDS.has(kind)) {
      throw new Error(`world: unsupported connector kind "${kind}" — re-bake`);
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

/** Build a region's manifest cuboid colliders as static bodies — one static body per
 *  manifest cuboid. A region's render-only meshes live in the world's single merged
 *  scene doc, loaded once. */
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
 *  seat it in world via the same placement its meshes went through. Cave-only by type — the
 *  loader dispatches on `class` and routes grid regions elsewhere (`expandGridRegionFromEntry`). */
function createCaveProxyBody(
  ctx: Context,
  world: physics.World,
  r: WorldCaveRegionEntry,
): void {
  // `params` is the recorded (typed) cave call params, spread over the base RegionParams.
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

/** Re-expand a BORE connector's (organic-tunnel or collar-bore) field-derived voxel proxy
 *  from its placed portals + EXPLICIT tunnel opts (the manifest records `radius`/`overshoot`,
 *  so a non-default bore re-expands faithfully rather than snapping back to `organicTunnel`'s
 *  internal defaults). `organicTunnel` is symmetric in `a`/`b` and its proxy is ALREADY
 *  world-frame (its portals are world-frame) — no `placePiece`. Setup-loud: the connector
 *  carries no cuboids, so this bore IS its collision. */
function createConnectorProxyBody(
  ctx: Context,
  world: physics.World,
  c: WorldBoreConnectorEntry,
): void {
  const tunnel = organicTunnel(c.a, c.b, c.seed, {
    radius: c.radius,
    overshoot: c.overshoot,
    extendA: c.extendA,
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
 *  `placePiece` seats it in world after. Cave-only by type — the loader dispatches on `class`
 *  and only routes field-organic regions here. */
async function dressingFor(
  r: WorldCaveRegionEntry,
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
