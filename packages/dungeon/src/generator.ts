import type { ShapeDescriptor } from "@furnace/core/physics";
import * as rng from "@furnace/core/rng";
import type { Field } from "./field.ts";
import * as field from "./field.ts";
import { voxelProxyPosition, voxelsFromField } from "./proxy.ts";
import { type GridConfig, type MeshData, surfaceNets } from "./surface-nets.ts";

export type RegionKind = "cavern" | "shaft" | "chamber";

export type RegionParams = {
  seed: string;
  kind: RegionKind;
  origin: [number, number, number];
};

export type Provenance = {
  generatorId: "dungeon";
  generatorVersion: number;
  seed: string;
  kind: RegionKind;
};

/** The abstract region model passes read/write. 2.1 fills only `field` + `grid`;
 *  `entities`/`theme` are the seams future prop/lighting passes will populate. */
export type RegionModel = {
  params: RegionParams;
  rng: rng.Rng;
  field: Field | null;
  grid: GridConfig;
  theme: string;
  entities: never[]; // populated by future passes (prop/light scatter)
};

/** A generated region: the realised mesh + collision proxy + provenance + placement origin. */
export type Region = {
  mesh: MeshData;
  origin: [number, number, number];
  provenance: Provenance;
  theme: string;
  proxy: ShapeDescriptor;
  proxyPosition: [number, number, number];
};

const GENERATOR_VERSION = 1;

// Per-kind generation config: the sampling grid and a factory that builds the
// full field (base + noise) from a seeded Rng. Each kind is carved so the player
// can be INSIDE the space (open top via grid truncation), not approach a closed blob.
const KIND_CONFIG: Record<
  RegionKind,
  { grid: GridConfig; makeField: (rng: rng.Rng) => Field }
> = {
  // Open-top bowl you slide down into. Center above the grid top (y=0) so only
  // the lower bowl is meshed; floor closes ~world y=-3, opening radius ~3.9 at y=0.
  cavern: {
    grid: { min: [-5, -4, -5], cellSize: 0.5, dims: [20, 8, 20] },
    // A rounded-box grotto sized to the authored floor pit (world x[-2,2],
    // z[-22,-26], centred at the region origin [0,0,-24]). A box (not a sphere)
    // fills the SQUARE pit with no unfilled corners → no fall-through, and stays
    // within the pit → no rim poking up into the surrounding chamber floor.
    // Half-extents 1.9 keep the walls a touch inside the 2.0 pit edge so noise
    // can't push them into the chamber; depth 2 floors the grotto at world y=-2.
    makeField: (r) =>
      field.noiseDisplace(field.boxCavern(0, 0, 0, 1.9, 2, 1.9), r, 0.3, 0.4),
  },
  // Deep narrow vertical shaft you DROP down. Air cylinder extends above the grid
  // top (y=0) → open mouth; floor closes ~world y=-6, opening radius ~2.5 at y=0.
  shaft: {
    grid: { min: [-4, -7, -4], cellSize: 0.5, dims: [16, 14, 16] },
    makeField: (r) =>
      field.noiseDisplace(field.shaft(0, 0, 2.5, -6, 2), r, 0.45, 0.3),
  },
  // A bumpy carved FLOOR you walk onto: a tall air box (walls/ceiling outside the
  // grid → only the y=0 floor meshes) with edge-tapered noise so the seam stays
  // flush (walkable) while the interior is visibly carved.
  chamber: {
    grid: { min: [-6, -1.5, -3], cellSize: 0.5, dims: [24, 6, 14] },
    makeField: (r) =>
      field.taperedNoiseDisplace(
        field.boxCavern(0, 10, 0, 10, 10, 10),
        r,
        0.6,
        0.55,
        field.rectWeight(6, 3, 1.5), // footprint half-extents x=6, z=3; 1.5-wide flush border
      ),
  },
};

type Pass = (model: RegionModel) => RegionModel;

/** The one pass 2.1 ships: choose a field by kind, roughen it with seeded noise. */
const geometryPass: Pass = (model) => {
  const cfg = KIND_CONFIG[model.params.kind];
  return {
    ...model,
    grid: cfg.grid,
    field: cfg.makeField(model.rng.derive("geometry")),
  };
};

const PASSES: Pass[] = [geometryPass];

function seedModel(params: RegionParams): RegionModel {
  return {
    params,
    rng: rng.create(params.seed),
    field: null,
    grid: KIND_CONFIG.cavern.grid,
    theme: "damp-stone",
    entities: [],
  };
}

// Collision voxels are anisotropic in Y: half the cubic cell height so a
// floor-height quantization step is 0.25m (< the controller's 0.4m STEP_HEIGHT)
// instead of a 0.5m cubic cell (> STEP_HEIGHT, which stalls walking). X/Z stay
// at grid.cellSize — only the climbed axis needs the finer resolution.
const PROXY_VOXEL_Y = 0.25;

function buildProxy(
  f: Field,
  grid: GridConfig,
  origin: [number, number, number],
): { proxy: ShapeDescriptor; proxyPosition: [number, number, number] } {
  const vox = voxelsFromField(f, grid, [
    grid.cellSize,
    PROXY_VOXEL_Y,
    grid.cellSize,
  ]);
  return {
    proxy: { voxels: vox },
    proxyPosition: voxelProxyPosition(grid, origin),
  };
}

/** Build only the collision proxy for `params` (runs the field, no Surface-Nets).
 *  Used for baked regions whose render comes from a `.fmesh`. */
export function generateProxy(params: RegionParams): {
  proxy: ShapeDescriptor;
  proxyPosition: [number, number, number];
} {
  const cfg = KIND_CONFIG[params.kind];
  const r = rng.create(params.seed);
  const f = cfg.makeField(r.derive("geometry"));
  return buildProxy(f, cfg.grid, params.origin);
}

/** Run the pass pipeline for `params` and realise the result to mesh data. */
export function generateRegion(params: RegionParams): Region {
  let model = seedModel(params);
  for (const pass of PASSES) model = pass(model);
  if (!model.field)
    throw new Error("generator: no geometry pass produced a field");
  const mesh = surfaceNets(model.field, model.grid);
  const { proxy, proxyPosition } = buildProxy(
    model.field,
    model.grid,
    params.origin,
  );
  return {
    mesh,
    origin: params.origin,
    theme: model.theme,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      seed: params.seed,
      kind: params.kind,
    },
    proxy,
    proxyPosition,
  };
}
