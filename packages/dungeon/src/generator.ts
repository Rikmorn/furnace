import * as rng from "@furnace/core/rng";
import type { Field } from "./field.ts";
import * as field from "./field.ts";
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

/** A generated region: the realised mesh + its provenance + placement origin. */
export type Region = {
  mesh: MeshData;
  origin: [number, number, number];
  provenance: Provenance;
  theme: string;
};

const GENERATOR_VERSION = 1;

// Per-kind generation config: the sampling grid, the base density field, and the
// surface-noise (amplitude/frequency). Each kind is carved so the player can be
// INSIDE the space (open top via grid truncation), not approach a closed blob.
const KIND_CONFIG: Record<
  RegionKind,
  { grid: GridConfig; base: Field; amp: number; freq: number }
> = {
  // Open-top bowl you slide down into. Center above the grid top (y=0) so only
  // the lower bowl is meshed; floor closes ~world y=-3, opening radius ~3.9 at y=0.
  cavern: {
    grid: { min: [-5, -4, -5], cellSize: 0.5, dims: [20, 8, 20] },
    base: field.sphereCavern(0, 1, 0, 4),
    amp: 0.6,
    freq: 0.35,
  },
  // Deep narrow vertical shaft you DROP down. Air cylinder extends above the grid
  // top (y=0) → open mouth; floor closes ~world y=-6, opening radius ~2.5 at y=0.
  shaft: {
    grid: { min: [-4, -7, -4], cellSize: 0.5, dims: [16, 14, 16] },
    base: field.shaft(0, 0, 2.5, -6, 2),
    amp: 0.45,
    freq: 0.3,
  },
  // A bumpy carved FLOOR you walk onto across a seam. A tall air box whose walls
  // and ceiling sit OUTSIDE the grid, so only its floor (the y=0 boundary) meshes
  // — a continuous bumpy sheet covering the whole footprint (no holes to fall through).
  chamber: {
    grid: { min: [-6, -1.5, -3], cellSize: 0.5, dims: [24, 6, 12] },
    base: field.boxCavern(0, 10, 0, 10, 10, 10),
    amp: 0.3,
    freq: 0.3,
  },
};

type Pass = (model: RegionModel) => RegionModel;

/** The one pass 2.1 ships: choose a field by kind, roughen it with seeded noise. */
const geometryPass: Pass = (model) => {
  const r = model.rng.derive("geometry");
  const cfg = KIND_CONFIG[model.params.kind];
  return {
    ...model,
    grid: cfg.grid,
    field: field.noiseDisplace(cfg.base, r, cfg.amp, cfg.freq),
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

/** Run the pass pipeline for `params` and realise the result to mesh data. */
export function generateRegion(params: RegionParams): Region {
  let model = seedModel(params);
  for (const pass of PASSES) model = pass(model);
  if (!model.field)
    throw new Error("generator: no geometry pass produced a field");
  const mesh = surfaceNets(model.field, model.grid);
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
  };
}
