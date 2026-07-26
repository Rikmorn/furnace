// packages/dungeon/scripts/measure/explain.ts
// What IS this candidate? At the counts P-F4-3b reports, a bare number is not the deliverable —
// every remaining candidate can be read individually, so this prints the geometry that produced
// each one: the measured free width for `narrow`, the measured headroom for `low-clearance`,
// the region size (and, for a one-column region only, its shape) for `pit`.
//
// SELF-CHECKING WHERE IT CAN BE. The two PER-CELL kinds re-derive the analyzer's own predicate —
// including `TORSO_PROBE_M`, which is private to `analyze.ts` and copied here — and compare it
// against the fact that a flag exists: a disagreement prints `!! MISMATCH` rather than a
// plausible sentence. `pit` has no per-cell predicate to re-derive (that is the whole point of
// D-F4-18) and claims correspondingly less; see {@link explainPit}. The detector's own liveness
// evidence is the carved A/B in `pit-control.ts`, not anything here.
import type * as field from "@furnace/core/field";
import { airRun, isFloorAnchor, solidAt } from "./solidity.ts";
import type { Subject } from "./subjects.ts";

/** `analyze.ts` TORSO_PROBE_M — the height above the floor the `narrow` filter probes at. */
const TORSO_PROBE_M = 0.5;

/** Metres, at a fixed width — the one formatter this measurement's output uses, so a raw
 *  float like `0.6799999999999999` can never reach the artifact people quote. */
export const fmt = (m: number): string => `${m.toFixed(3)} m`;

/** `faceDistance`: anchor XZ centre to the near face of the nearest solid along one direction,
 *  or `undefined` if nothing solid stands within the scan bound. */
function faceDistance(
  subject: Subject,
  torsoY: number,
  x: number,
  z: number,
  dx: number,
  dz: number,
  scanCells: number,
): number | undefined {
  const cellSize = subject.store.cellSize;
  for (let d = 1; d <= scanCells; d++)
    if (solidAt(subject, x + dx * d, torsoY, z + dz * d))
      return (d - 0.5) * cellSize;
  return undefined;
}

/** Free width on one XZ axis at torso height, `undefined` when either side is open. */
function axisWidth(
  subject: Subject,
  torsoY: number,
  cell: readonly [number, number, number],
  dx: number,
  dz: number,
  scanCells: number,
): number | undefined {
  const pos = faceDistance(
    subject,
    torsoY,
    cell[0],
    cell[2],
    dx,
    dz,
    scanCells,
  );
  if (pos === undefined) return undefined;
  const neg = faceDistance(
    subject,
    torsoY,
    cell[0],
    cell[2],
    -dx,
    -dz,
    scanCells,
  );
  return neg === undefined ? undefined : pos + neg;
}

function explainNarrow(
  subject: Subject,
  profile: field.AgentProfile,
  cell: readonly [number, number, number],
): string {
  const cellSize = subject.store.cellSize;
  const bar = 2 * profile.capsule.radius + profile.skin;
  const scanCells = Math.ceil(bar / cellSize);
  const torsoY = cell[1] + Math.ceil(TORSO_PROBE_M / cellSize);
  const x = axisWidth(subject, torsoY, cell, 1, 0, scanCells);
  const z = axisWidth(subject, torsoY, cell, 0, 1, scanCells);
  const say = (w: number | undefined): string =>
    w === undefined ? "open" : fmt(w);
  const pinched = (x !== undefined && x < bar) || (z !== undefined && z < bar);
  const verdict = pinched ? "" : "  !! MISMATCH: re-derivation finds no pinch";
  return `free width X=${say(x)} Z=${say(z)} (bar ${fmt(bar)})${verdict}`;
}

function explainLowClearance(
  subject: Subject,
  profile: field.AgentProfile,
  cell: readonly [number, number, number],
): string {
  const cellSize = subject.store.cellSize;
  const need = Math.ceil(profile.clearance / cellSize);
  const run = airRun(subject, cell[0], cell[1], cell[2], need);
  const anchored = isFloorAnchor(subject, cell[0], cell[1], cell[2]);
  // `airRun` stops on the first solid OR at the cap. Stopping SHORT of the cap therefore means
  // rock stopped it, and the headroom is EXACTLY that run; only a run that reached the cap is a
  // lower bound. (Getting this the wrong way round would print `<` on the one case that is
  // exact and `=` on the one that is not.)
  const parts = [
    `headroom ${run < need ? "=" : ">="} ${fmt(run * cellSize)}`,
    `(needs ${fmt(profile.clearance)})`,
  ];
  if (!anchored) parts.push("!! MISMATCH: not a floor anchor");
  else if (run >= need) parts.push("!! MISMATCH: headroom clears the bar");
  return parts.join(" ");
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** How high above the anchor the first XZ-neighbour floor anchor stands, scanned to a cap past
 *  which the number stops being informative (a trap either way). */
const RISE_SCAN_CELLS = 40;

function riseToNeighbourFloor(
  subject: Subject,
  cell: readonly [number, number, number],
): number | undefined {
  const [x, y, z] = cell;
  for (let dy = 1; dy <= RISE_SCAN_CELLS; dy++)
    for (const [dx, dz] of DIRS)
      if (isFloorAnchor(subject, x + dx, y + dy, z + dz))
        return dy * subject.store.cellSize;
  return undefined;
}

/** Is ANY XZ neighbour a floor anchor inside the climb band? For a ONE-column region that is a
 *  flat contradiction of the flag: a bidirectional climb edge to a column outside the region
 *  means the agent walks out, and if that column were itself trapped it would BE in the region. */
function neighbourInClimbBand(
  subject: Subject,
  cell: readonly [number, number, number],
  climbCells: number,
): boolean {
  const [x, y, z] = cell;
  for (let dy = -climbCells; dy <= climbCells; dy++)
    for (const [dx, dz] of DIRS)
      if (isFloorAnchor(subject, x + dx, y + dy, z + dz)) return true;
  return false;
}

/** A one-column region's four XZ neighbours at its OWN level. All four solid means a WELL
 *  exactly one cell across — which the capsule is too wide to fall into IF the cell is narrower
 *  than its diameter. That holds at the 0.25 m production lattice and not by definition:
 *  `cellSize` comes from the manifest, so the comparison is made rather than assumed. */
const wellWalls = (
  subject: Subject,
  cell: readonly [number, number, number],
): number =>
  DIRS.filter(([dx, dz]) =>
    solidAt(subject, cell[0] + dx, cell[1], cell[2] + dz),
  ).length;

/** A pit is a property of the connectivity GRAPH, so unlike `narrow` and `low-clearance` there
 *  is no per-cell predicate to re-derive — the region's membership is not carried on the flag.
 *  Two things are still checkable from the anchor alone, and only those are claimed:
 *  - For a region of ONE column, no XZ neighbour may be a floor anchor inside the climb band.
 *    Anything else is a contradiction, and is marked as one.
 *  - For a region of one column, the four neighbours at its own level say whether it is a WELL
 *    one cell across. That is a finding about the WORLD, not the detector: the node set has no
 *    width, so a 0.25 m well reads enterable to a 0.60 m capsule that cannot fit down it.
 *  For a multi-column region neither holds — a neighbour floor one cell up is very likely
 *  another column OF THE SAME REGION — so nothing is asserted and the line says so. */
function explainPit(
  subject: Subject,
  profile: field.AgentProfile,
  flag: field.FieldFlag,
): string {
  const cells = flag.cells ?? 0;
  const head = `${cells} column(s), ${flag.chunks?.length ?? 0} chunk(s)`;
  if (cells !== 1)
    return `${head}; escape height not derivable from the anchor alone (multi-column region)`;

  const climbCells = Math.floor(profile.climbCeiling / subject.store.cellSize);
  const rise = riseToNeighbourFloor(subject, flag.cell);
  const riseTxt =
    rise === undefined
      ? `no neighbour floor within ${fmt(RISE_SCAN_CELLS * subject.store.cellSize)} above`
      : `nearest neighbour floor ${fmt(rise)} up`;
  const walls = wellWalls(subject, flag.cell);
  const cellSize = subject.store.cellSize;
  const diameter = 2 * profile.capsule.radius;
  const shape =
    walls === 4
      ? `; a WELL ${fmt(cellSize)} across, capsule ${fmt(diameter)} — ${cellSize < diameter ? "too narrow to fall into" : "wide enough for the capsule"}`
      : `; ${walls}/4 sides walled at its own level`;
  const bad = neighbourInClimbBand(subject, flag.cell, climbCells)
    ? "  !! MISMATCH: a neighbour floor sits inside the climb band"
    : "";
  return `${head}; ${riseTxt} (climb ceiling ${fmt(profile.climbCeiling)})${shape}${bad}`;
}

/** One line of geometry behind a candidate flag — the evidence for calling it a true positive
 *  or not, read from the store rather than asserted. */
export function explain(
  subject: Subject,
  profile: field.AgentProfile,
  flag: field.FieldFlag,
): string {
  if (flag.kind === "narrow") return explainNarrow(subject, profile, flag.cell);
  if (flag.kind === "low-clearance")
    return explainLowClearance(subject, profile, flag.cell);
  if (flag.kind === "pit") return explainPit(subject, profile, flag);
  return "";
}
