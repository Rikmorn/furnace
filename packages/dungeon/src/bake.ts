// packages/dungeon/src/bake.ts
// The world-writer (Epic 3 W1): regenerate a declarative world from its spec and emit
// the baked artifact set. PURE — no FS; the editor daemon (or a test) owns the writes.
//
// The WHOLE world bakes to ONE render-only `world.scene.json` (all regions AND
// connectors merged into a single SceneDocument; resource keys are piece-prefixed so
// pieces can't collide). That doc carries NO rigidBody components — collision rides
// the MANIFEST instead, per region class: a field-organic (cave) region ships a
// world-frame cuboid list plus a voxel proxy re-expanded at load from its provenance,
// while a grid-built (hall|maze) region ships `cuboids: []` and re-expands render AND
// collision wholesale at load. Voxel shapes themselves never serialize. Custom
// (Surface-Nets) meshes ship as `.fmesh` sidecars carrying LOCAL vertices; the entity
// transform positions them in world (the 3.0 baker convention — avoids a
// double-offset). The manifest is written LAST (crash-safety: an interrupted bake
// leaves no manifest, so a torn world never loads).
import {
  CURRENT_SCENE_VERSION,
  type EntityDoc,
  encodeMeshBlob,
  type SceneDocument,
} from "@furnace/core/scene";
import { TUNNEL_OVERSHOOT, TUNNEL_RADIUS } from "./connector.ts";
import { BORE_SHELL_EXTENSION } from "./connector-built.ts";
import {
  type Connection,
  GENERATOR_VERSION,
  type RegionCollider,
  type RegionData,
  type Vec3,
} from "./region.ts";
import type { HallParams } from "./themes/hall.ts";
import type { MazeParams } from "./themes/maze.ts";
import { type RealizedWorld, realizeWorldSpec } from "./world-build.ts";
import type {
  CaveRegionSpec,
  WorldConnectorSpec,
  WorldPlacement,
  WorldSpec,
} from "./world-spec.ts";

/** Project-root-relative artifact dir for a named world (W1 declarative worlds). */
export const worldDir = (name: string): string => `worlds/${name}`;

// Filesystem- and URL-safe; also guarantees daemon root-containment can't be tricked.
const WORLD_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/** One file the caller (daemon/test) writes: JSON docs/manifest as text, `.fmesh` as bytes. */
export type BakeFile = { path: string; contents: string | Uint8Array };

/** Fields every baked region entry carries regardless of class. */
type WorldRegionEntryBase = {
  id: string;
  seed: string;
  placement: WorldPlacement;
};

/** A baked field-organic (cave) region: its provenance params + resolved placement to
 *  re-generate + re-place the region at load, plus its world-frame cuboid colliders. Its
 *  render-only isosurface mesh lives in the world's single merged `scene` doc, and its voxel
 *  proxy + dressing re-expand at load from `params`/`seed`. */
export type WorldCaveRegionEntry = WorldRegionEntryBase & {
  class: "field-organic";
  algorithm: "cave";
  /** Single-sourced from the spec so it can't drift if `params` gains a field. */
  params: CaveRegionSpec["params"];
  /** Cuboid colliders in WORLD frame (voxels never serialize — proxies regen). */
  cuboids: RegionCollider[];
};

/** A baked grid-built (hall) region: its hall params + resolved placement. Contributes
 *  NOTHING to the merged scene doc and NO `.fmesh` sidecars — the loader re-expands its
 *  patch mesh + kit instances + voxel collider through `expandGridRegionFromEntry`. `cuboids`
 *  is always `[]` (the collider IS the re-expanded voxel proxy, never a serialized cuboid). */
export type WorldHallRegionEntry = WorldRegionEntryBase & {
  class: "grid-built";
  algorithm: "hall";
  params: HallParams;
  cuboids: [];
};

/** A baked grid-built MAZE region (W3): exactly the hall entry's posture — nothing in
 *  the merged scene doc, no sidecars, `cuboids: []`; the loader re-expands render +
 *  collider through `expandGridRegionFromEntry`'s maze dispatch. */
export type WorldMazeRegionEntry = WorldRegionEntryBase & {
  class: "grid-built";
  algorithm: "maze";
  params: MazeParams;
  cuboids: [];
};

/** A baked world region's manifest entry — a union over class + grid algorithm. */
export type WorldRegionEntry =
  | WorldCaveRegionEntry
  | WorldHallRegionEntry
  | WorldMazeRegionEntry;

/** Fields every baked connector entry carries: its seed, the exact PLACED world-frame
 *  portals it was built from (`a`/`b` — the loader re-expands its proxy/tube from these),
 *  and the spec endpoint refs (`aRef`/`bRef` = `[regionId, portalIndex]`) the loader groups
 *  each region's door-open / carve mutations by. */
type WorldConnectorEntryBase = {
  id: string;
  seed: string;
  a: Connection;
  b: Connection;
  aRef: [string, number];
  bRef: [string, number];
};

/** An organic-tunnel (cave↔cave) or collar-bore (grid↔cave) connector: both re-expand
 *  their voxel proxy from `organicTunnel(a, b, seed, {radius, overshoot, extendA})` at load
 *  (symmetric in a/b except `extendA`, which extends the A end only), so both carry the
 *  explicit bore opts — recorded, not re-derived from constants, so a bake re-expands
 *  faithfully even if a default later changes. `extendA` is the collar-bore's built-shell
 *  band extension (0 for organic-tunnel); its A end is ALWAYS the door-side portal. Their
 *  render mesh rides the merged `scene` doc as W1's organic-tunnel does. */
export type WorldBoreConnectorEntry = WorldConnectorEntryBase & {
  kind: "organic-tunnel" | "collar-bore";
  radius: number;
  overshoot: number;
  extendA: number;
};

/** A corridor or aperture connector: pure grid joins with NO bore opts. A corridor
 *  re-expands its world-frame tube via `buildCorridor(a, b, seed)` at load; an aperture is a
 *  pure hole (no volume, no proxy). Neither bakes any scene entities. */
export type WorldGridConnectorEntry = WorldConnectorEntryBase & {
  kind: "corridor" | "aperture";
};

/** A baked connector's manifest entry — a union over connector kind. */
export type WorldConnectorEntry =
  | WorldBoreConnectorEntry
  | WorldGridConnectorEntry;

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
 * Bake one declarative world to a file set: `realizeWorldSpec` resolves the spec into placed
 * geometry, which this folds into the merged doc + sidecars and indexes from a manifest
 * written LAST.
 *
 * PURE and DETERMINISTIC: returns files, writes nothing, and emits no timestamp (the manifest
 * omits `bakedAt`) — two calls with the same spec produce a byte-identical file set. Regions
 * and connectors fold into ONE render-only `world.scene.json` (resource keys piece-prefixed);
 * colliders ride the manifest as cuboid lists (voxel proxies regenerate at load), and each
 * connector entry carries its placed portals + tunnel opts so the bore re-expands exactly.
 *
 * @param name Defaults to `spec.name`. Validated with `WORLD_NAME_RE` (FS/URL-safe).
 * @throws if `name` is path-hostile; or if a region/connector/portal is missing from the
 *   realized world (setup-loud).
 */
export function bakeWorld(
  spec: WorldSpec,
  name: string = spec.name,
): BakeFile[] {
  if (!WORLD_NAME_RE.test(name)) {
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
    if (region.class === "field-organic") {
      const placed = realized.regions.get(region.id);
      if (!placed) {
        throw new Error(
          `bake: region ${region.id} missing from realized world`,
        );
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
      continue;
    }
    // grid-built (hall | maze): NO scene entities, NO `.fmesh` sidecars, `cuboids: []`.
    // Render (patch mesh + kit instances) and voxel collider re-expand at load (D-W2-6)
    // from `params`/`seed` + the touching connectors — the loader owns that geometry.
    // Constructed per algorithm because TS cannot correlate `algorithm` with `params`
    // through the 2-variant union in one object literal.
    regions.push(
      region.algorithm === "hall"
        ? {
            id: region.id,
            class: "grid-built",
            algorithm: "hall",
            params: region.params,
            seed: region.seed,
            placement: resolved.placement,
            cuboids: [],
          }
        : {
            id: region.id,
            class: "grid-built",
            algorithm: "maze",
            params: region.params,
            seed: region.seed,
            placement: resolved.placement,
            cuboids: [],
          },
    );
  }

  const connectors: WorldConnectorEntry[] = [];
  for (const connector of spec.connectors) {
    // Only the BORE kinds contribute a render mesh to the merged scene doc (organicTunnel's
    // Surface-Nets tube). Corridor re-expands its tube via `buildCorridor` at load and aperture
    // is a pure hole — both bake NO scene entities and NO sidecars.
    if (
      connector.kind === "organic-tunnel" ||
      connector.kind === "collar-bore"
    ) {
      const placed = realized.connectors.get(connector.id);
      if (!placed) {
        throw new Error(
          `bake: connector ${connector.id} missing from realized world`,
        );
      }
      appendPiece(merged, dir, connector.id, placed);
    }
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
  // LAST — the crash-safety contract: an interrupted bake leaves no manifest, and the
  // loader throws on a missing manifest, so a torn world never loads.
  files.push({
    path: `${dir}/manifest.json`,
    contents: JSON.stringify(manifest, null, 2),
  });
  return files;
}

/** Reconstruct a connector's re-expansion entry (kind-union): its PLACED world-frame portals
 *  (`a`/`b` — the exact `Connection`s the volume was built from) plus its spec endpoint refs
 *  (`aRef`/`bRef`, which the loader groups region mutations by). Bore kinds also carry the
 *  tunnel opts their volume was built with; corridor/aperture carry nothing extra. */
function worldConnectorEntry(
  connector: WorldConnectorSpec,
  realized: RealizedWorld,
): WorldConnectorEntry {
  const base: WorldConnectorEntryBase = {
    id: connector.id,
    seed: connector.seed,
    a: placedPortal(realized, connector.a, connector.id),
    b: placedPortal(realized, connector.b, connector.id),
    aRef: connector.a,
    bRef: connector.b,
  };
  if (connector.kind === "organic-tunnel" || connector.kind === "collar-bore") {
    return {
      ...base,
      kind: connector.kind,
      radius: TUNNEL_RADIUS,
      overshoot: TUNNEL_OVERSHOOT,
      extendA: connector.kind === "collar-bore" ? BORE_SHELL_EXTENSION : 0,
    };
  }
  return { ...base, kind: connector.kind };
}

/** The placed portal a connector endpoint `[regionId, portalIndex]` resolves to. Setup-loud
 *  — the realized world must contain it. */
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

/** The merged world doc under construction: one resource pool + entity list for the whole
 *  world, plus the `.fmesh` sidecars its custom-mesh geometries reference. `appendPiece`
 *  folds each placed piece in; the caller seals it into a single `SceneDocument`. */
type MergedDoc = {
  geometries: Record<string, unknown>;
  materials: Record<string, unknown>;
  entities: EntityDoc[];
  sidecars: BakeFile[];
};

/**
 * Append one placed piece's render-only entities into the merged world doc. Resource keys
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
