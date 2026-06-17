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

// Per-kind sampling grids. The cavern grid's TOP face sits at local y=0 (the
// region origin = the chamber floor) so the bowl's top is left OPEN (you
// descend into it); shaft/chamber keep the taller default box.
const GRIDS: Record<RegionKind, GridConfig> = {
  // x,z ∈ [-5,5]; y ∈ [-3,0] → floor captured, top (y=0) open.
  cavern: { min: [-5, -3, -5], cellSize: 0.5, dims: [20, 6, 20] },
  shaft: { min: [-8, -2, -8], cellSize: 0.5, dims: [32, 16, 32] },
  chamber: { min: [-8, -2, -8], cellSize: 0.5, dims: [32, 16, 32] },
};

type Pass = (model: RegionModel) => RegionModel;

/** The one pass 2.1 ships: choose a field by kind, roughen it with seeded noise. */
const geometryPass: Pass = (model) => {
  const r = model.rng.derive("geometry");
  const grid = GRIDS[model.params.kind];
  let base: Field;
  switch (model.params.kind) {
    case "shaft":
      base = field.shaft(0, 0, 2.5, -2, 6);
      break;
    case "chamber":
      base = field.boxCavern(0, 1.5, 0, 5, 2.5, 5);
      break;
    default:
      // "cavern": an open-top bowl you descend into. Center is above the grid's
      // top (y=0) so only the lower bowl is meshed; floor closes at world y≈-2.
      base = field.sphereCavern(0, 2, 0, 4);
      break;
  }
  return { ...model, grid, field: field.noiseDisplace(base, r, 0.6, 0.35) };
};

const PASSES: Pass[] = [geometryPass];

function seedModel(params: RegionParams): RegionModel {
  return {
    params,
    rng: rng.create(params.seed),
    field: null,
    grid: GRIDS.cavern,
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
