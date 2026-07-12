// packages/dungeon/src/bake.ts
// The wing-writer (Slice 3.1 spec §4, consolidated in 3.2.1): regenerate the frozen world
// from its winning derived seed and emit the baked artifact set. PURE — no FS; the editor
// daemon (or a test) owns the writes. Dungeon-owned so the editor carries zero generator
// knowledge.
//
// The WHOLE wing bakes to ONE render-only `wing.scene.json` (all regions AND connectors
// merged into a single SceneDocument; resource keys are piece-prefixed so pieces can't
// collide). It carries NO rigidBody components: colliders ride the manifest as per-piece
// cuboid lists (voxel shapes never serialize — the cave's voxel proxy re-expands at load
// from provenance), and the cave's decorative scatter re-expands at load too. Custom
// (Surface-Nets) meshes ship as `.fmesh` sidecars carrying LOCAL vertices; the entity
// transform positions them in world (the 3.0 baker convention — avoids a double-offset).
// The manifest is written LAST (crash-safety: an interrupted bake leaves no manifest, so
// the loader falls back to live generation and a torn wing never loads).
import {
  CURRENT_SCENE_VERSION,
  type EntityDoc,
  encodeMeshBlob,
  type SceneDocument,
} from "@furnace/core/scene";
import type { Placement } from "./connect.ts";
import { TUNNEL_OVERSHOOT, TUNNEL_RADIUS } from "./connector.ts";
import type { LayoutBudget } from "./layout.ts";
import {
  type Connection,
  GENERATOR_VERSION,
  type RegionCollider,
  type RegionData,
  type Vec3,
} from "./region.ts";
import type { TopologyConfig } from "./topology.ts";
import { buildWorld } from "./world.ts";
import { type RealizedWorld, realizeWorldSpec } from "./world-build.ts";
import type {
  WorldConnectorSpec,
  WorldPlacement,
  WorldRegionSpec,
  WorldSpec,
} from "./world-spec.ts";

/** Default wing name — the game's loader reads this well-known wing. */
export const DEFAULT_WING_NAME = "generated-wing";

/** Project-root-relative artifact dir for a named wing. */
export const wingDir = (name: string): string => `regions/${name}`;

/** MIGRATION-free compat: the default wing's dir (loader + existing tests). */
export const WING_DIR = wingDir(DEFAULT_WING_NAME);

/** Project-root-relative artifact dir for a named world (W1 declarative worlds). */
export const worldDir = (name: string): string => `worlds/${name}`;

// Filesystem- and URL-safe; also guarantees daemon root-containment can't be tricked.
const WING_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/** One file the caller (daemon/test) writes: JSON docs/manifest as text, `.fmesh` as bytes. */
export type BakeFile = { path: string; contents: string | Uint8Array };

/** A baked region's manifest entry — enough to re-expand its runtime-only parts (cave
 *  voxel proxy + dressing) at load from provenance, plus its world-frame cuboid colliders.
 *  Its render-only meshes live in the wing's single merged `scene` doc, not here. */
export type WingRegionEntry = {
  id: string;
  theme: string;
  /** Provenance seed of the region (theme-level, NOT the world seed). */
  seed: string;
  /** layoutWorld placement — dressing re-expands locally then transforms by this. */
  placement: Placement;
  /** Cuboid colliders in WORLD frame (voxels never serialize — cave proxy regens). */
  colliders: RegionCollider[];
  /** The materializer's extra generator params (cave: mouths/capped; pillarHall:
   *  graph-derived doors) — REQUIRED to re-derive proxy/dressing exactly at load;
   *  a bare {theme,seed,origin} re-run reproduces a different region. */
  themeParams?: Record<string, unknown>;
};

/** The baked wing's index: provenance to regenerate, the single merged render-only doc,
 *  plus per-region + connector colliders (their meshes live in that one doc). */
export type WingManifest = {
  version: 1;
  provenance: {
    generatorId: "dungeon";
    generatorVersion: number;
    /** The WINNING derived seed (e.g. "myseed:4") — regenerates on attempt 0. */
    seed: string;
    config: Partial<TopologyConfig>;
    budget: Partial<LayoutBudget>;
  };
  attach: { node: "authored"; note: string };
  /** The single merged render-only doc for the whole wing, project-root-relative. */
  scene: string;
  regions: WingRegionEntry[];
  /** Connectors carry no dressing; world-frame cuboid colliders only. */
  connectors: { colliders: RegionCollider[] }[];
};

/**
 * Bake one frozen wing to a file set.
 *
 * `seed` MUST be the winning derived seed: `bakeWing` forces a SINGLE placement attempt
 * (`attempts: 1`), so `buildWorld` throws setup-loud if the seed does not reproduce the
 * previewed world on attempt 0 (a wrong seed would bake a DIFFERENT world than the one
 * previewed). PURE: returns files, writes nothing.
 *
 * `budget.deadlineMs` is ignored (forced to Infinity): a bake must deterministically
 * reproduce the previewed success, and a wall-clock deadline can only prevent successes,
 * never create them (D4).
 *
 * @throws (via `buildWorld`) if the seed does not place on attempt 0; or if a placed node
 *   is missing its layout entry / placement.
 */
export function bakeWing(
  seed: string,
  config: Partial<TopologyConfig>,
  budget: Partial<LayoutBudget>,
  name: string = DEFAULT_WING_NAME,
): { files: BakeFile[] } {
  if (!WING_NAME_RE.test(name)) {
    throw new Error(`bake: invalid wing name "${name}"`);
  }
  const dir = wingDir(name);

  const { graph, layout } = buildWorld(
    seed,
    { ...config, attempts: 1 },
    // deadlineMs is a SEARCH-TIME knob and never reaches a bake: it is
    // machine-speed-dependent, while a bake must deterministically reproduce the
    // previewed success — counted budgets alone re-run identically (a deadline can
    // only PREVENT successes, never create them).
    { ...budget, deadlineMs: Number.POSITIVE_INFINITY },
  );

  const files: BakeFile[] = [];
  const regions: WingRegionEntry[] = [];
  const merged: MergedDoc = {
    geometries: { g_cube: { kind: "cube" } },
    materials: {},
    entities: [],
    sidecars: [],
  };

  for (const [i, node] of graph.nodes.entries()) {
    if (node.region.provenance.theme === "authored") continue; // the pinned phantom
    const placed = layout.regions[i];
    if (!placed) throw new Error(`bake: node ${node.id} missing from layout`);
    const placement = layout.placements.get(node.id);
    if (!placement) throw new Error(`bake: node ${node.id} has no placement`);

    appendPiece(merged, dir, node.id, placed);
    regions.push({
      id: node.id,
      theme: node.region.provenance.theme,
      seed: node.region.provenance.seed,
      placement,
      colliders: cuboidColliders(placed),
      ...(node.themeParams ? { themeParams: node.themeParams } : {}),
    });
  }

  const connectors: WingManifest["connectors"] = [];
  for (const [i, c] of layout.connectors.entries()) {
    appendPiece(merged, dir, `connector-${i}`, c);
    connectors.push({ colliders: cuboidColliders(c) });
  }

  // Sidecars first, then the ONE merged scene doc; the manifest is pushed LAST (below).
  const scenePath = `${dir}/wing.scene.json`;
  const doc: SceneDocument = {
    version: CURRENT_SCENE_VERSION,
    settings: {},
    resources: {
      geometries: merged.geometries,
      shaders: { s_lit: { kind: "lit" } },
      materials: merged.materials,
    },
    entities: merged.entities,
  };
  files.push(...merged.sidecars, {
    path: scenePath,
    contents: JSON.stringify(doc, null, 2),
  });

  const manifest: WingManifest = {
    version: 1,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      seed,
      config,
      budget,
    },
    attach: {
      node: "authored",
      note: "wing grows from the authored chamber door; regions are already world-placed",
    },
    scene: scenePath,
    regions,
    connectors,
  };
  // LAST — the crash-safety contract: an interrupted bake leaves no manifest, so the loader
  // falls back to live generation and a torn wing never loads.
  files.push({
    path: `${dir}/manifest.json`,
    contents: JSON.stringify(manifest, null, 2),
  });
  return { files };
}

/** A baked world region's manifest entry: its provenance params + resolved placement to
 *  re-generate + re-place the region at load, plus its world-frame cuboid colliders. Its
 *  render-only mesh lives in the world's single merged `scene` doc, not here. */
export type WorldRegionEntry = {
  id: string;
  class: "field-organic";
  algorithm: "cave";
  /** Single-sourced from the spec so it can't drift if `params` gains a field. */
  params: WorldRegionSpec["params"];
  seed: string;
  placement: WorldPlacement;
  /** Cuboid colliders in WORLD frame (voxels never serialize — proxies regen). */
  cuboids: RegionCollider[];
};

/** A baked connector's manifest entry: the exact PLACED world-frame portals + tunnel opts
 *  it was built from, so the loader re-expands the identical bore (organicTunnel is pure in
 *  these inputs). Its mesh lives in the merged `scene` doc; its voxel proxy regenerates. */
export type WorldConnectorEntry = {
  id: string;
  kind: "organic-tunnel";
  seed: string;
  /** The exact world-frame portals + opts the tunnel was built from (re-expansion inputs). */
  a: Connection;
  b: Connection;
  radius: number;
  overshoot: number;
};

/** The baked world's index: the single merged render-only doc, the player spawn, and the
 *  per-region + connector re-expansion entries. `bakedAt` is intentionally OMITTED by
 *  `bakeWorld` (a timestamp would break deterministic re-bake); a daemon may stamp it later. */
export type WorldManifest = {
  version: 1;
  /** The single merged render-only doc for the whole world, project-root-relative. */
  scene: string;
  playerStart: Vec3;
  playerYaw: number;
  regions: WorldRegionEntry[];
  connectors: WorldConnectorEntry[];
  provenance: { generatorVersion: number; bakedAt?: string };
};

/**
 * Bake one declarative world to a file set. Mirrors `bakeWing`'s merged-doc / sidecar /
 * manifest-LAST shape, but sources geometry from the deterministic (search-free)
 * `realizeWorldSpec` rather than a placement search, so no seed/attempt/deadline knobs apply.
 *
 * PURE and DETERMINISTIC: returns files, writes nothing, and emits no timestamp (the manifest
 * omits `bakedAt`) — two calls with the same spec produce a byte-identical file set. Regions
 * and connectors fold into ONE render-only `world.scene.json` (resource keys piece-prefixed);
 * colliders ride the manifest as cuboid lists (voxel proxies regenerate at load), and each
 * connector entry carries its placed portals + tunnel opts so the bore re-expands exactly.
 *
 * @param name Defaults to `spec.name`. Validated with `WING_NAME_RE` (FS/URL-safe).
 * @throws if `name` is path-hostile; or if a region/connector/portal is missing from the
 *   realized world (setup-loud, mirroring `bakeWing`).
 */
export function bakeWorld(
  spec: WorldSpec,
  name: string = spec.name,
): BakeFile[] {
  if (!WING_NAME_RE.test(name)) {
    throw new Error(`bake: invalid world name "${name}"`);
  }
  const dir = worldDir(name);
  const realized = realizeWorldSpec(spec);

  const merged: MergedDoc = {
    geometries: { g_cube: { kind: "cube" } },
    materials: {},
    entities: [],
    sidecars: [],
  };

  const regions: WorldRegionEntry[] = [];
  for (const [i, region] of spec.regions.entries()) {
    // Cave-only manifest entries this slice — grid-built regions bake in Task 9. Guard also
    // narrows the union to the cave variant so `class`/`algorithm`/`params` fit the entry type.
    if (region.class !== "field-organic") {
      throw new Error(
        `bake: region ${region.id} class "${region.class}" is not yet bakeable`,
      );
    }
    const placed = realized.regions.get(region.id);
    if (!placed) {
      throw new Error(`bake: region ${region.id} missing from realized world`);
    }
    const resolved = realized.spec.regions[i];
    if (!resolved) {
      throw new Error(`bake: region ${region.id} has no resolved placement`);
    }
    // Order-lock: `resolved` is paired to `region` by array position (resolveSpec preserves
    // order 1:1). Guard it so a future reorder/filter can't silently attach the wrong
    // region's placement to the wrong id — it would fail loud here instead.
    if (resolved.id !== region.id) {
      throw new Error(`bake: resolved region order mismatch at ${region.id}`);
    }
    appendPiece(merged, dir, region.id, placed);
    regions.push({
      id: region.id,
      class: region.class,
      algorithm: region.algorithm,
      params: region.params,
      seed: region.seed,
      // The RESOLVED placement — cave-b's is join-derived, NOT the [0,0,0] placeholder.
      placement: resolved.placement,
      cuboids: cuboidColliders(placed),
    });
  }

  const connectors: WorldConnectorEntry[] = [];
  for (const connector of spec.connectors) {
    const placed = realized.connectors.get(connector.id);
    if (!placed) {
      throw new Error(
        `bake: connector ${connector.id} missing from realized world`,
      );
    }
    appendPiece(merged, dir, connector.id, placed);
    connectors.push(worldConnectorEntry(connector, realized));
  }

  // Sidecars first, then the ONE merged scene doc; the manifest is pushed LAST (below).
  const scenePath = `${dir}/world.scene.json`;
  const doc: SceneDocument = {
    version: CURRENT_SCENE_VERSION,
    settings: {},
    resources: {
      geometries: merged.geometries,
      shaders: { s_lit: { kind: "lit" } },
      materials: merged.materials,
    },
    entities: merged.entities,
  };
  const files: BakeFile[] = [
    ...merged.sidecars,
    { path: scenePath, contents: JSON.stringify(doc, null, 2) },
  ];

  const manifest: WorldManifest = {
    version: 1,
    scene: scenePath,
    playerStart: realized.playerStart,
    playerYaw: realized.playerYaw,
    regions,
    connectors,
    // No bakedAt — a timestamp would break the deterministic re-bake contract.
    provenance: { generatorVersion: GENERATOR_VERSION },
  };
  // LAST — the crash-safety contract (as bakeWing): an interrupted bake leaves no manifest,
  // so the loader falls back to live generation and a torn world never loads.
  files.push({
    path: `${dir}/manifest.json`,
    contents: JSON.stringify(manifest, null, 2),
  });
  return files;
}

/** Reconstruct a connector's re-expansion entry: its PLACED world-frame portals (the exact
 *  `Connection`s the tunnel was built from) plus the default tunnel opts Task 3 used. */
function worldConnectorEntry(
  connector: WorldConnectorSpec,
  realized: RealizedWorld,
): WorldConnectorEntry {
  // Organic-tunnel-only manifest entries this slice — built connectors bake in Task 7. Guard
  // also narrows `kind` to the tunnel literal so it fits the entry type.
  if (connector.kind !== "organic-tunnel") {
    throw new Error(
      `bake: connector ${connector.id} kind "${connector.kind}" is not yet bakeable`,
    );
  }
  return {
    id: connector.id,
    kind: connector.kind,
    seed: connector.seed,
    a: placedPortal(realized, connector.a, connector.id),
    b: placedPortal(realized, connector.b, connector.id),
    radius: TUNNEL_RADIUS,
    overshoot: TUNNEL_OVERSHOOT,
  };
}

/** The placed portal a connector endpoint `[regionId, portalIndex]` resolves to. Setup-loud
 *  (mirrors `bakeWing`'s missing-layout throws) — the realized world must contain it. */
function placedPortal(
  realized: RealizedWorld,
  [regionId, portalIndex]: [string, number],
  connectorId: string,
): Connection {
  const region = realized.regions.get(regionId);
  if (!region) {
    throw new Error(
      `bake: connector ${connectorId} references missing region ${regionId}`,
    );
  }
  const portal = region.connections[portalIndex];
  if (!portal) {
    throw new Error(
      `bake: connector ${connectorId} references missing portal ${regionId}:${portalIndex}`,
    );
  }
  return portal;
}

/** Cuboid-only collider list (voxel shapes are regenerated at load, never serialized). */
function cuboidColliders(r: RegionData): RegionCollider[] {
  return r.colliders.filter((c) => "cuboid" in c.shape);
}

/** The merged wing doc under construction: one resource pool + entity list for the whole
 *  wing, plus the `.fmesh` sidecars its custom-mesh geometries reference. `appendPiece`
 *  folds each placed piece in; the caller seals it into a single `SceneDocument`. */
type MergedDoc = {
  geometries: Record<string, unknown>;
  materials: Record<string, unknown>;
  entities: EntityDoc[];
  sidecars: BakeFile[];
};

/**
 * Append one placed piece's render-only entities into the merged wing doc. Resource keys
 * are piece-prefixed (`<id>-m<i>` materials, `<id>-g_mesh_<mi>` custom geometries) so pieces
 * merged into one doc can't collide; `g_cube`/`s_lit` stay shared singletons. Box meshes
 * render as scaled unit cubes; custom (Surface-Nets) meshes ship as `.fmesh` sidecars with
 * LOCAL vertices, world-posed on the entity transform (the 3.0 baker convention). Materials
 * are lit by `s_lit`; the scene material schema carries only `color`, so `specular` is
 * intentionally dropped (see docs/backlog/engine-architecture/scene-material-specular-param.md).
 */
function appendPiece(
  out: MergedDoc,
  dir: string,
  id: string,
  r: RegionData,
): void {
  for (const [i, m] of r.materials.entries()) {
    out.materials[`${id}-m${i}`] = {
      shader: "s_lit",
      params: { color: m.color },
    };
  }
  for (const [mi, m] of r.meshes.entries()) {
    const transform: Record<string, unknown> = { position: m.position };
    if (m.rotation) transform["rotation"] = m.rotation;
    let geoRef = "g_cube";
    if ("custom" in m.geometry) {
      const sidecarPath = `${dir}/${id}-${mi}.fmesh`;
      out.sidecars.push({
        path: sidecarPath,
        contents: new Uint8Array(encodeMeshBlob({ render: m.geometry.custom })),
      });
      geoRef = `${id}-g_mesh_${mi}`;
      out.geometries[geoRef] = { kind: "mesh", src: `/${sidecarPath}` };
      // realize.ts applies m.scale to a CUSTOM mesh only (box meshes use geometry.box).
      if (m.scale) transform["scale"] = m.scale;
    } else {
      // Mirror realize.ts: a box mesh renders as a unit cube scaled by geometry.box.
      transform["scale"] = m.geometry.box;
    }
    out.entities.push({
      id: `${id}-m${mi}`,
      components: {
        transform,
        meshRenderer: { geometry: geoRef, material: `${id}-m${m.material}` },
      },
    });
  }
}
