// packages/dungeon/src/bake.ts
// The wing-writer (Slice 3.1 spec §4): regenerate the frozen world from its winning
// derived seed and emit the baked artifact set. PURE — no FS; the editor daemon (or a
// test) owns the writes. Dungeon-owned so the editor carries zero generator knowledge.
//
// Docs are RENDER-ONLY (no rigidBody components): colliders ride the manifest as cuboid
// lists (voxel shapes never serialize — the cave's voxel proxy re-expands at load from
// provenance), and the cave's decorative scatter re-expands at load too. Custom
// (Surface-Nets) meshes ship as `.fmesh` sidecars carrying LOCAL vertices; the entity
// transform positions them in world (the 3.0 baker convention — avoids a double-offset).
import {
  CURRENT_SCENE_VERSION,
  type EntityDoc,
  encodeMeshBlob,
  type SceneDocument,
} from "@furnace/core/scene";
import type { Placement } from "./connect.ts";
import type { LayoutBudget } from "./layout.ts";
import {
  GENERATOR_VERSION,
  type RegionCollider,
  type RegionData,
} from "./region.ts";
import type { TopologyConfig } from "./topology.ts";
import { buildWorld } from "./world.ts";

/** Default wing name — the game's loader reads this well-known wing. */
export const DEFAULT_WING_NAME = "generated-wing";

/** Project-root-relative artifact dir for a named wing. */
export const wingDir = (name: string): string => `regions/${name}`;

/** MIGRATION-free compat: the default wing's dir (loader + existing tests). */
export const WING_DIR = wingDir(DEFAULT_WING_NAME);

// Filesystem- and URL-safe; also guarantees daemon root-containment can't be tricked.
const WING_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/** One file the caller (daemon/test) writes: JSON docs/manifest as text, `.fmesh` as bytes. */
export type BakeFile = { path: string; contents: string | Uint8Array };

/** A baked region's manifest entry — enough to re-expand its runtime-only parts (cave
 *  voxel proxy + dressing) at load from provenance, plus its render-only doc + colliders. */
export type WingRegionEntry = {
  id: string;
  /** Doc file, relative to the project root. */
  file: string;
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

/** The baked wing's index: provenance to regenerate, plus per-region + connector artifacts. */
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
  regions: WingRegionEntry[];
  /** Connector docs carry no dressing; colliders only. */
  connectors: { file: string; colliders: RegionCollider[] }[];
};

/**
 * Bake one frozen wing to a file set.
 *
 * `seed` MUST be the winning derived seed: `bakeWing` forces a SINGLE placement attempt
 * (`attempts: 1`), so `buildWorld` throws setup-loud if the seed does not reproduce the
 * previewed world on attempt 0 (a wrong seed would bake a DIFFERENT world than the one
 * previewed). PURE: returns files, writes nothing.
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
    budget,
  );

  const files: BakeFile[] = [];
  const regions: WingRegionEntry[] = [];

  for (const [i, node] of graph.nodes.entries()) {
    if (node.region.provenance.theme === "authored") continue; // the pinned phantom
    const placed = layout.regions[i];
    if (!placed) throw new Error(`bake: node ${node.id} missing from layout`);
    const placement = layout.placements.get(node.id);
    if (!placement) throw new Error(`bake: node ${node.id} has no placement`);

    const file = `${dir}/region-${node.id}.scene.json`;
    const { doc, sidecars } = regionDoc(node.id, placed, dir);
    files.push(
      { path: file, contents: JSON.stringify(doc, null, 2) },
      ...sidecars,
    );
    regions.push({
      id: node.id,
      file,
      theme: node.region.provenance.theme,
      seed: node.region.provenance.seed,
      placement,
      colliders: cuboidColliders(placed),
      ...(node.themeParams ? { themeParams: node.themeParams } : {}),
    });
  }

  const connectors: WingManifest["connectors"] = [];
  for (const [i, c] of layout.connectors.entries()) {
    const file = `${dir}/connector-${i}.scene.json`;
    const { doc } = regionDoc(`connector-${i}`, c, dir);
    files.push({ path: file, contents: JSON.stringify(doc, null, 2) });
    connectors.push({ file, colliders: cuboidColliders(c) });
  }

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
    regions,
    connectors,
  };
  files.push({
    path: `${dir}/manifest.json`,
    contents: JSON.stringify(manifest, null, 2),
  });
  return { files };
}

/** Cuboid-only collider list (voxel shapes are regenerated at load, never serialized). */
function cuboidColliders(r: RegionData): RegionCollider[] {
  return r.colliders.filter((c) => "cuboid" in c.shape);
}

/**
 * A render-only scene doc for one placed piece: box meshes as scaled unit-cube entities,
 * custom meshes as `.fmesh` sidecar resources (LOCAL vertices; world pose on the entity
 * transform — the 3.0 baker convention). Materials are the `standard` kind lit by `s_lit`;
 * the scene material schema carries only `color`, so `specular` is intentionally dropped
 * (matches the 3.0 baker — see docs/backlog/engine-architecture/scene-material-specular-param.md).
 */
function regionDoc(
  id: string,
  r: RegionData,
  dir: string,
): { doc: SceneDocument; sidecars: BakeFile[] } {
  const sidecars: BakeFile[] = [];
  const geometries: Record<string, unknown> = { g_cube: { kind: "cube" } };
  const materials = Object.fromEntries(
    r.materials.map((m, i) => [
      `m_${i}`,
      { shader: "s_lit", params: { color: m.color } },
    ]),
  );

  const entities: EntityDoc[] = [];
  for (const [mi, m] of r.meshes.entries()) {
    const transform: Record<string, unknown> = { position: m.position };
    if (m.rotation) transform["rotation"] = m.rotation;
    let geoRef = "g_cube";
    if ("custom" in m.geometry) {
      const sidecarPath = `${dir}/${id}-${mi}.fmesh`;
      sidecars.push({
        path: sidecarPath,
        contents: new Uint8Array(encodeMeshBlob({ render: m.geometry.custom })),
      });
      geoRef = `g_mesh_${mi}`;
      geometries[geoRef] = { kind: "mesh", src: `/${sidecarPath}` };
      // realize.ts applies m.scale to a CUSTOM mesh only (box meshes use geometry.box).
      if (m.scale) transform["scale"] = m.scale;
    } else {
      // Mirror realize.ts: a box mesh renders as a unit cube scaled by geometry.box.
      transform["scale"] = m.geometry.box;
    }
    entities.push({
      id: `${id}-m${mi}`,
      components: {
        transform,
        meshRenderer: { geometry: geoRef, material: `m_${m.material}` },
      },
    });
  }

  return {
    doc: {
      version: CURRENT_SCENE_VERSION,
      settings: {},
      resources: { geometries, shaders: { s_lit: { kind: "lit" } }, materials },
      entities,
    },
    sidecars,
  };
}
