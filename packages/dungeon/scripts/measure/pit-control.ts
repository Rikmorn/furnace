// packages/dungeon/scripts/measure/pit-control.ts
// The liveness control. A detector that reports 0 pits everywhere is worthless whether or not
// it is correct, so "0 pits in the default cave" is only evidence once the SAME detector, on
// the SAME world, fires on a trap that is definitely there.
//
// The A/B is one carve site and two floors. On the real generated cave, find a flat run of five
// standable columns whose first four have a SEALED box of rock under them ({@link isSealedSite}),
// then carve those four down:
//   FLAT   — all four at one depth, `SHAFT_DEPTH` cells below the rim. Sealed on five sides, so
//            the only way out is a rise of `SHAFT_DEPTH` cells, far past the climb band ⇒
//            exactly one NEW pit region of four columns.
//   STAIRS — the identical footprint, floored as a staircase of `STAIR_RISE`-cell risers up to
//            the untouched fifth column. Every step is inside the climb band ⇒ NO new region.
// Same site, same footprint; the only difference is whether a walk out exists. Both halves are
// checked against a stated expectation, because a control that can only fire one way proves half
// of what it claims — and the expectation is a SIZE, not merely "some region appeared".
import * as field from "@furnace/core/field";
import { AGENT } from "../../src/walkability.ts";
import { isFloorAnchor } from "./solidity.ts";
import type { Subject } from "./subjects.ts";
import {
  CAVE_SEED,
  carveCave,
  caveDefaults,
  chamberSeeds,
} from "./subjects.ts";

/** Carved columns, plus one untouched rim column at the top of the stairs. */
const CARVE_COLUMNS = 4;
/** Depth of the flat shaft, in cells: 8 × 0.25 m = 2.0 m, well past the 0.7 m climb ceiling. */
const SHAFT_DEPTH = 8;
/** Riser of the staircase variant, in cells: 2 × 0.25 m = 0.5 m, inside the climb ceiling. */
const STAIR_RISE = 2;

/** The three constants above are not independent: the staircase has to start at the flat
 *  shaft's own depth and land its top step exactly one riser below the rim, or the "same hole,
 *  different floor" claim is false and the negative half of the control proves nothing. Setup
 *  loud rather than a comment — a comment is what the other nine defects in this tranche were. */
function assertStaircaseReachesTheRim(): void {
  const topDepth = SHAFT_DEPTH - STAIR_RISE * (CARVE_COLUMNS - 1);
  if (topDepth !== STAIR_RISE)
    throw new Error(
      `pit-control: SHAFT_DEPTH ${SHAFT_DEPTH} / CARVE_COLUMNS ${CARVE_COLUMNS} / STAIR_RISE ${STAIR_RISE} leave the top step ${topDepth} cells below the rim, not ${STAIR_RISE} — the staircase does not reach it`,
    );
  const climbCells = Math.floor(AGENT.climbCeiling / field.DEFAULT_CELL_SIZE);
  if (STAIR_RISE > climbCells)
    throw new Error(
      `pit-control: STAIR_RISE ${STAIR_RISE} exceeds the climb band (${climbCells} cells) — the "staircase" is itself a trap`,
    );
  if (SHAFT_DEPTH <= climbCells)
    throw new Error(
      `pit-control: SHAFT_DEPTH ${SHAFT_DEPTH} is inside the climb band (${climbCells} cells) — the flat shaft is not a trap`,
    );
}

export type PitControl = {
  site: [number, number, number] | undefined;
  baseline: number;
  flat: { regions: number; added: field.FieldFlag[] };
  stairs: { regions: number; added: field.FieldFlag[] };
};

const key = (c: readonly [number, number, number]): string => c.join(",");

/** A run of `CARVE_COLUMNS + 1` floor anchors along +X at one Y whose first `CARVE_COLUMNS` sit
 *  over a SEALED box of rock. Returns the run's first column. */
function findSite(subject: Subject): [number, number, number] | undefined {
  for (const ck of subject.store.chunks.keys()) {
    const [cx, cy, cz] = field.parseChunkKey(ck);
    const bx = cx * field.CHUNK_DIM;
    const by = cy * field.CHUNK_DIM;
    const bz = cz * field.CHUNK_DIM;
    for (let z = bz; z < bz + field.CHUNK_DIM; z++)
      for (let y = by; y < by + field.CHUNK_DIM; y++)
        for (let x = bx; x < bx + field.CHUNK_DIM; x++)
          if (isSealedSite(subject, x, y, z)) return [x, y, z];
  }
  return undefined;
}

/** Is the rock under this run solid on all FIVE closed sides of the shaft-to-be — the floor
 *  below it, both Z walls, and the two X ends? Without that the carve can breach an existing
 *  cavity, and a shaft that opens sideways is not the trap the control claims to have built.
 *  Checked here rather than inferred from the outcome, so a CONTROL FAILED line means the
 *  DETECTOR disagreed, not that the site was unlucky. */
function isSealedSite(
  subject: Subject,
  x: number,
  y: number,
  z: number,
): boolean {
  for (let i = 0; i <= CARVE_COLUMNS; i++)
    if (!isFloorAnchor(subject, x + i, y, z)) return false;
  const rock = (px: number, py: number, pz: number): boolean =>
    field.getDensity(subject.store, px, py, pz) < 0;
  for (let k = 1; k <= SHAFT_DEPTH + 1; k++) {
    // Both X ends of the shaft, at every carved level.
    if (!rock(x - 1, y - k, z) || !rock(x + CARVE_COLUMNS, y - k, z))
      return false;
    for (let i = 0; i < CARVE_COLUMNS; i++)
      if (
        !rock(x + i, y - k, z) ||
        !rock(x + i, y - k, z - 1) ||
        !rock(x + i, y - k, z + 1)
      )
        return false;
  }
  return true;
}

/** Carve column `i` of the site down to `floorY`, leaving the cell at `floorY - 1` as rock. */
function carveColumn(
  store: field.FieldStore,
  site: readonly [number, number, number],
  i: number,
  floorY: number,
): void {
  for (let y = site[1] - 1; y >= floorY; y--)
    field.setDensity(store, site[0] + i, y, site[2], field.AIR);
}

/** Depth (in cells below the rim) of column `i`'s floor in the staircase variant. The flat
 *  variant is {@link SHAFT_DEPTH} for every column. With the constants above, the top carved
 *  column lands exactly one riser below the rim: `8 - 2*3 = 2`. */
const stairDepth = (i: number): number => SHAFT_DEPTH - STAIR_RISE * i;

function pitsAfter(
  carve: (store: field.FieldStore, site: [number, number, number]) => void,
  site: [number, number, number],
  baseline: ReadonlySet<string>,
): { regions: number; added: field.FieldFlag[] } {
  const params = caveDefaults();
  const store = carveCave(params, CAVE_SEED);
  carve(store, site);
  const flags = field.detectPits(
    store,
    AGENT,
    chamberSeeds(params, CAVE_SEED),
    {},
  );
  return {
    regions: flags.length,
    added: flags.filter((f) => !baseline.has(key(f.cell))),
  };
}

/** Run the A/B against a freshly carved default cave. `site` is `undefined` when no flat run
 *  with rock beneath it exists — which is itself a reportable outcome, not a silent pass. */
export function runPitControl(): PitControl {
  assertStaircaseReachesTheRim();
  const params = caveDefaults();
  const seeds = chamberSeeds(params, CAVE_SEED);
  const store = carveCave(params, CAVE_SEED);
  const subject: Subject = {
    label: "pit control",
    note: "",
    store,
    extraSolid: undefined,
    seeds,
    props: 0,
  };
  const baselineFlags = field.detectPits(store, AGENT, seeds, {});
  const baseline = new Set(baselineFlags.map((f) => key(f.cell)));

  const site = findSite(subject);
  if (site === undefined)
    return {
      site,
      baseline: baselineFlags.length,
      flat: { regions: 0, added: [] },
      stairs: { regions: 0, added: [] },
    };

  return {
    site,
    baseline: baselineFlags.length,
    flat: pitsAfter(
      (s, at) => {
        for (let i = 0; i < CARVE_COLUMNS; i++)
          carveColumn(s, at, i, at[1] - SHAFT_DEPTH);
      },
      site,
      baseline,
    ),
    stairs: pitsAfter(
      (s, at) => {
        for (let i = 0; i < CARVE_COLUMNS; i++)
          carveColumn(s, at, i, at[1] - stairDepth(i));
      },
      site,
      baseline,
    ),
  };
}

/** The control's own expectations, as prose the report prints beside the numbers. */
export const CONTROL_EXPECTATION = {
  flat: `exactly 1 NEW region of ${CARVE_COLUMNS} columns (a ${(SHAFT_DEPTH * field.DEFAULT_CELL_SIZE).toFixed(2)} m flat-floored shaft)`,
  stairs: `0 NEW regions (the same shaft floored as ${(STAIR_RISE * field.DEFAULT_CELL_SIZE).toFixed(2)} m risers — a walk-out)`,
  columns: CARVE_COLUMNS,
};
