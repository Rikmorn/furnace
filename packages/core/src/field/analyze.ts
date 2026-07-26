// Stage 1 of the walkability advisor (D-F4-3): Recast-style walkable-column
// filters over the field's own solidity, parameterized on the consuming
// project's capsule (D-F4-4). Ported from the F0 probe
// `packages/dungeon/scripts/analyzer-probe/column-pass.ts` — algorithms on
// merit, code shape rewritten for the sparse `FieldStore` (global voxel coords,
// ONE lattice, no dense occupancy grid and no per-body frames, D-F4-2).
//
// Resolution note: this pass reads the SAME solidity the runtime voxel collider
// derives from (`collider.ts`: density < 0 is rock, D-F4-5). The collider is
// what the capsule actually touches, so analysing at that resolution is exact
// w.r.t. the runtime geometry — the research's "cells << capsule radius"
// condition applies to analysing SMOOTH source geometry, which this is not.
//
// The solidity view, the coordinate helpers and the profile gate this shares
// with the connectivity passes live in `solidity.ts`; the passes themselves in
// `reachability.ts`. Only the PER-COLUMN filters are here.
import { CHUNK_DIM, parseChunkKey } from "./chunks.ts";
import {
  type AnalyzeOptions,
  assertAnalyzeInputs,
  ceilingAbove,
  climbCellsFor,
  DIRS,
  floorSurfaceWorld,
  isFloorAnchor,
  isSolid,
  type SolidView,
  validatedView,
} from "./solidity.ts";
import type {
  AgentProfile,
  ChunkKey,
  FieldFlag,
  FieldStore,
  FlagKind,
  FlagSeverity,
} from "./types.ts";

/** Height above the floor at which the `narrow` filter probes for walls. */
const TORSO_PROBE_M = 0.5;
/** A "wall" beside a lip = solid within this height above the lip's floor. */
const WALL_PROBE_M = 1.0;
/** The 2 XZ axes, one direction each — the `narrow` scan mirrors them itself,
 *  because a pinch is a property of an axis and not of a side. */
const AXES = [
  [1, 0],
  [0, 1],
] as const;

/** Agent thresholds resolved to CELLS at the store's cell size — except the
 *  `narrow` pinch, which stays in metres (see {@link pinchWidth}). */
type ColumnMetrics = {
  clearCells: number;
  wallCellsXZ: number;
  wallProbeUp: number;
  torsoCells: number;
  stepCells: number;
  climbCells: number;
  cellSize: number;
  /** Free width (m) below which an axis reads pinched: the capsule's diameter
   *  plus ONE mover contact margin. The bar has to clear `2 * radius` outright,
   *  because a lane exactly the diameter leaves the capsule at EXACT contact
   *  with both walls, and a shapecast whose start pose is already touching
   *  returns a zero-distance hit with an arbitrary normal — the stall the
   *  mover's own rest and lift margins exist to prevent. One `skin` is then a
   *  well-chosen agent-scale margin over that floor, not a derived quantity.
   *
   *  Below `cellSize` this filter is structurally silent: the smallest sum two
   *  opposing faces can produce is `cellSize` (both solids at `d = 1`), so a
   *  store whose cells are as coarse as the capsule reports NO pinch anywhere,
   *  the same coarse-cell cliff {@link markUnreachable} documents for climbs. */
  pinchWidth: number;
  /** How far out (cells) the pinch scan looks for the nearest solid. `ceil` is
   *  complete, not merely generous: the nearest possible solid past this bound
   *  sits at `(pinchCells + 0.5) * cellSize`, and the nearest possible solid on
   *  the other side at `0.5 * cellSize`, so a miss here already sums to at least
   *  `(pinchCells + 1) * cellSize > pinchWidth`. A side with nothing in range
   *  therefore cannot be half of a pinch, whatever stands beyond it. */
  pinchCells: number;
};

type PushFlag = (
  kind: FlagKind,
  severity: FlagSeverity,
  x: number,
  y: number,
  z: number,
) => void;

/** The rounding is asymmetric on purpose: `ceil` on what the capsule REQUIRES
 *  (clearance, radius, probe heights), `floor` on what it is ALLOWED (step,
 *  climb — the latter via {@link climbCellsFor}, which the connectivity passes
 *  share). Never "fix" one of them into symmetry — but be exact about what that
 *  buys, because the two halves differ and the difference is load-bearing.
 *
 *  **Against a lattice-quantized measurement the rounding is EXACT, not merely
 *  tight** — `clearCells`, `stepCells`, `climbCells`. Floor surfaces sit at
 *  whole multiples of `cellSize` ({@link sampleToWorld}) and the runtime
 *  collider is `cellSize` boxes anchored on the same lattice (`collider.ts`), so
 *  a rise between two anchors is exactly `Δy * cellSize` and a headroom is
 *  exactly `run * cellSize`. For integer `n`, `n <= floor(t / cellSize)` is
 *  equivalent to `n * cellSize <= t`, and `n >= ceil(t / cellSize)` to
 *  `n * cellSize >= t`: these ARE the mover's predicates, with no borderline
 *  band for the rounding to shave off in either direction. Do not reason from
 *  them as though they were conservative — {@link detectPits} reads `climbCells`
 *  as an EDGE rule, where no safe direction exists at all (see its remarks).
 *
 *  Against a continuous quantity it really is a bound, and there the `ceil`
 *  over-demands as intended: the PROBE REACHES (`wallCellsXZ`, `wallProbeUp`,
 *  `torsoCells`) round a metre distance up to a whole number of cells to search,
 *  so they look slightly further than the capsule does.
 *
 *  `pinchWidth` is the exception, and deliberately not a cell count at all: a
 *  rounded pinch is not "tighter", it is WRONG BY UP TO A CELL EITHER WAY, and
 *  measurement found that the rounding — not the geometry — produced most of the
 *  `narrow` flags in a real cave (P-F4-3). Its scan bound rounds up because a
 *  scan bound must not miss; the comparison itself is in metres.
 *
 *  `wallCellsXZ` still carries that same rounding, and still drives
 *  `lip-near-wall`: at the production 0.25 m lattice a 0.3 m radius rounds to a
 *  0.5 m wall probe. It was measured (341 `lip-near-wall` on the F3b default
 *  cave) and deliberately left — that filter is `info` severity, so it sits
 *  outside the candidate bar `narrow` was fixed for. Anything promoting it to
 *  `candidate` has to answer this first. */
function metricsFor(profile: AgentProfile, cellSize: number): ColumnMetrics {
  const clearCells = Math.ceil(profile.clearance / cellSize);
  const pinchWidth = 2 * profile.capsule.radius + profile.skin;
  return {
    clearCells,
    wallCellsXZ: Math.ceil(profile.capsule.radius / cellSize),
    wallProbeUp: Math.ceil(WALL_PROBE_M / cellSize),
    torsoCells: Math.ceil(TORSO_PROBE_M / cellSize),
    stepCells: Math.floor(profile.stepHeight / cellSize),
    climbCells: climbCellsFor(profile, cellSize),
    cellSize,
    pinchWidth,
    pinchCells: Math.ceil(pinchWidth / cellSize),
  };
}

/** Air cells from (x,y,z) upward, counted to at most `limit`. Stopping short of
 *  `limit` therefore always means rock stopped it — the sparse-store equivalent
 *  of the donor's "open to the top of the grid" escape hatch, which this field
 *  has no need of (there is no grid top; unallocated space is rock).
 *
 *  Capping is information-preserving HERE, unlike in {@link ceilingAbove}: every
 *  caller only asks "is the run at least `limit`?", and `min(run, limit) < limit`
 *  iff `run < limit`. Do not symmetrize the two. */
function airRun(
  v: SolidView,
  x: number,
  y: number,
  z: number,
  limit: number,
): number {
  let n = 0;
  while (n < limit && !isSolid(v, x, y + n, z)) n++;
  return n;
}

/** Does a wall stand within capsule radius of the lip whose top air cell is
 *  (ax, topY, az)? The wedge CONJUNCTION: a sub-step lip alone is harmless. */
function wallBeyondLip(
  v: SolidView,
  m: ColumnMetrics,
  ax: number,
  topY: number,
  az: number,
): boolean {
  for (let wx = -m.wallCellsXZ; wx <= m.wallCellsXZ; wx++)
    for (let wz = -m.wallCellsXZ; wz <= m.wallCellsXZ; wz++)
      for (let wy = 0; wy < m.wallProbeUp; wy++)
        if (isSolid(v, ax + wx, topY + wy, az + wz)) return true;
  return false;
}

/** Distance (m) from the anchor cell's XZ CENTRE to the near face of the nearest
 *  solid along one direction, or `undefined` if nothing solid stands within
 *  `pinchCells`.
 *
 *  The anchor stands at its own cell's centre, so the cell `d` steps away spans
 *  `[d - 0.5, d + 0.5]` cells from that centre and its NEAR face is at `d - 0.5`
 *  — half a cell of the anchor's own footprint, plus the `d - 1` whole cells of
 *  air between them. Faces, not centres: two opposing faces bound exactly the
 *  air a capsule has to fit into, whereas two centres would over-count it by a
 *  full cell.
 *
 *  Outward from `d = 1` and stopping at the FIRST hit, so an intermediate solid
 *  can never be stepped over (the donor probe's "scan every offset" rule) and
 *  the distance returned is the tightest one on that side. */
function faceDistance(
  v: SolidView,
  m: ColumnMetrics,
  torsoY: number,
  x: number,
  z: number,
  dx: number,
  dz: number,
): number | undefined {
  for (let d = 1; d <= m.pinchCells; d++)
    if (isSolid(v, x + dx * d, torsoY, z + dz * d))
      return (d - 0.5) * m.cellSize;
  return undefined;
}

/** Is the anchor pinched at torso height — solid on BOTH sides of one XZ axis,
 *  with less than `pinchWidth` of free width between their faces?
 *
 *  Opposing is the whole predicate. Counting sides independently (the F0 shape
 *  this replaces) flags every inside CORNER, where the capsule is not pinched at
 *  all: it walks out along either open axis. On deliberately vertical cave
 *  terrain that is not a rare miss — "walls nearby" describes the terrain, so
 *  the count reads 2 almost everywhere and the filter says nothing (P-F4-3).
 *
 *  Two axes, so what a DIAGONAL lane gets measured on is its axis-aligned air
 *  span, which is strictly wider than the lane. The `/√2` an ideal 45° line
 *  suggests is the OPTIMISTIC bound, and the lattice makes it worse rather than
 *  better: a 45° staircase of step `k` has an axis span of `(2k-1)` cells while
 *  its true corner-to-corner clearance is only `√2·(k-1)`, which is exactly
 *  `1/√2` of a cell BELOW the ideal line's `(2k-1)/√2` — at every `k`. So the
 *  miss band extends under `pinchWidth / √2`, not just up to it.
 *  Measured at `cellSize` 0.25 with a 0.68 m bar: `k = 2` spans 0.750 on the
 *  axis (clear) at a true clearance of 0.354, which a 0.60 m capsule cannot
 *  enter at all. This filter does not see that class; stage 2 owns all of it. */
function pinchedAtTorso(
  v: SolidView,
  m: ColumnMetrics,
  x: number,
  y: number,
  z: number,
): boolean {
  const torsoY = y + m.torsoCells;
  for (const [dx, dz] of AXES) {
    const pos = faceDistance(v, m, torsoY, x, z, dx, dz);
    if (pos === undefined) continue;
    const neg = faceDistance(v, m, torsoY, x, z, -dx, -dz);
    if (neg !== undefined && pos + neg < m.pinchWidth) return true;
  }
  return false;
}

/** The neighbour column's FIRST floor surface above ours, searched up to our own
 *  ceiling, classified by how far above it sits.
 *
 *  Every rise is `info` (D-F4-18). The candidate band this once carried — rises
 *  past `climbCeiling` — was refuted by measurement: on deliberately vertical
 *  cave terrain a tall rise IS the terrain (P-F4-3 counted 787 such candidates
 *  in the largest committed world, and 323 in a default cave). What a trap
 *  actually is — getting in and not back out — is a CONNECTIVITY property that
 *  no per-cell predicate here can express, so it moved to {@link detectPits},
 *  where `climbCeiling` lives on as the edge rule.
 *
 *  The bound is load-bearing in BOTH directions (D-F4-6, F0-proven):
 *  - An earlier cap of `stepCells + 2` made every rise TALLER than ~0.75 m
 *    invisible — a 1.0 m or 1.5 m rim stalls the capsule and emitted no flag at
 *    all. False negatives are the one class this pass exists to catch.
 *  - Uncapped is equally wrong. Collider derivation is shell-only, so a wall is
 *    HOLLOW: solid where it borders air, nothing above. Scanning past our
 *    ceiling reads that shell's top as reachable floor metres up and flags a
 *    ledge on every wall-adjacent cell in the map (182 phantoms in the F0 run).
 *    A rise only concerns us if it stands in the air volume we stand in. */
function scanRise(
  v: SolidView,
  m: ColumnMetrics,
  anchor: readonly [number, number, number],
  ax: number,
  az: number,
  ceiling: number,
  push: PushFlag,
): void {
  const [x, y, z] = anchor;
  for (let ry = 1; y + ry < ceiling; ry++) {
    if (!isSolid(v, ax, y + ry - 1, az) || isSolid(v, ax, y + ry, az)) continue;
    if (ry > m.stepCells) push("ledge", "info", x, y, z);
    else if (wallBeyondLip(v, m, ax, y + ry, az))
      push("lip-near-wall", "info", x, y, z);
    return;
  }
}

/** The four filters, run against one walkable cell. */
function scanAnchor(
  v: SolidView,
  m: ColumnMetrics,
  anchor: readonly [number, number, number],
  push: PushFlag,
): void {
  const [x, y, z] = anchor;
  const ceiling = ceilingAbove(v, x, y, z);
  for (const [dx, dz] of DIRS) {
    const ax = x + dx;
    const az = z + dz;
    // A floor beside ours whose own headroom is below the capsule is flagged
    // from HERE: it failed the walkable test, so its own column never scans.
    if (
      isFloorAnchor(v, ax, y, az) &&
      airRun(v, ax, y, az, m.clearCells) < m.clearCells
    )
      push("low-clearance", "candidate", ax, y, az);
    scanRise(v, m, anchor, ax, az, ceiling, push);
  }
  if (pinchedAtTorso(v, m, x, y, z)) push("narrow", "candidate", x, y, z);
}

/**
 * Stage-1 walkability flags for one chunk: the capsule-column pass over the
 * field's solidity (D-F4-3). ADVISORY ONLY — it never mutates the store, never
 * blocks a verb, and never auto-fixes anything (D-F4-1).
 *
 * Filters, all strictly tighter than the mover's own limits so borderline
 * geometry surfaces: headroom below `clearance` (`low-clearance`); a neighbour
 * floor above `stepHeight` (`ledge`, always `info` — D-F4-18: a rise on its own
 * is terrain, and being TRAPPED by one is a connectivity property this pass
 * cannot see, so {@link detectPits} owns it); a sub-step lip with a wall within
 * capsule radius beyond it (`lip-near-wall`, the wedge conjunction); and less
 * than `2 * radius + skin` of free width between OPPOSING solids at torso height
 * on one XZ axis (`narrow`), measured in metres from face to face rather than
 * rounded to cells.
 *
 * @param key - The chunk whose own 16³ cells are the ANCHORS. Neighbour reads
 * cross chunk borders freely, so the caller must have the surrounding chunks
 * present; absent neighbours read as rock, which is exactly what the runtime
 * collider derives from. That requirement is NOT a one-chunk ring: reads are
 * unbounded upward in Y, because the ceiling search runs until it finds rock.
 * A mirror (or bake) missing a chunk overhead manufactures a false ceiling at
 * its own edge, which drops every rise above it — the exact cliff a capped scan
 * used to cause. Hold the whole vertical column above the analysed chunk, or
 * accept clipped ceilings there and say so downstream. An unallocated key is
 * legal and yields no flags — air, and therefore every anchor, only exists in
 * allocated chunks.
 * @returns Flags in scan order, deduplicated by (kind, cell): the rise checks
 * run per direction but key the centre cell, and a flag carries no direction.
 * Every flag is owned by `key` even when its anchor cell lies in a neighbouring
 * chunk (`low-clearance` anchors on the offending neighbour), so re-analysing a
 * chunk can wholesale replace exactly what its own pass produced. One
 * consequence, deliberate: a `low-clearance` cell straddling a chunk border can
 * be emitted by BOTH neighbouring passes, under different owners. Suppressing
 * the copy whose cell is outside the analysed chunk would LOSE the flag
 * whenever its only walkable neighbour sits across that border, so the pass
 * over-emits instead; a presentation layer that cares should dedupe by cell.
 * @throws Error - setup-loud, on an agent profile that is not internally
 * consistent (non-positive or non-finite fields, `climbCeiling` not above
 * `stepHeight`, `clearance` below the capsule's own height, `skin` at or above
 * the capsule radius), or on an `extraSolid` buffer whose length is not
 * `CHUNK_SAMPLES`.
 * @remarks Unallocated space being rock is the field's own rule and the one
 * this pass wants, but note where it differs from the runtime: an unallocated
 * chunk emits no collider at all, so a mover moves through it freely. At the
 * OUTER rim of the allocated region — and only there — the two disagree, in
 * BOTH directions. Under-flagging: a floor within `clearance` of the rim reads
 * as headroom limited, or as no anchor at all, where the runtime would let the
 * capsule stand. Over-flagging: the rim reads as walls, so a sub-step lip beside
 * one earns a `lip-near-wall` against rock that does not exist at runtime. What
 * this is NOT any more is a `narrow` fringe along the whole edge — that was the
 * side-counting predicate, for which a rim corner counted as a pinch; the
 * opposing-face measurement only fires at a rim if the allocated region is
 * itself narrower than the capsule. Both remaining halves are artifacts of where
 * the allocated data stops, not of the world, and both feed the false-positive
 * counts any triage bar is calibrated against. Interior chunk borders are
 * unaffected as long as the caller keeps the neighbouring chunks present.
 */
export function analyzeChunk(
  store: FieldStore,
  key: ChunkKey,
  profile: AgentProfile,
  opts?: AnalyzeOptions,
): FieldFlag[] {
  const v = validatedView(store, profile, opts);
  const m = metricsFor(profile, store.cellSize);
  const [cx, cy, cz] = parseChunkKey(key);
  const bx = cx * CHUNK_DIM;
  const by = cy * CHUNK_DIM;
  const bz = cz * CHUNK_DIM;

  const flags: FieldFlag[] = [];
  const seen = new Set<string>();
  const push: PushFlag = (kind, severity, x, y, z) => {
    const id = `${kind}@${x},${y},${z}`;
    if (seen.has(id)) return;
    seen.add(id);
    flags.push({
      kind,
      severity,
      cell: [x, y, z],
      world: floorSurfaceWorld(store.cellSize, x, y, z),
      chunk: key,
    });
  };

  for (let z = bz; z < bz + CHUNK_DIM; z++)
    for (let x = bx; x < bx + CHUNK_DIM; x++)
      for (let y = by; y < by + CHUNK_DIM; y++) {
        // Walkable = a floor surface with a capsule-height air run above it.
        if (!isFloorAnchor(v, x, y, z)) continue;
        if (airRun(v, x, y, z, m.clearCells) < m.clearCells) continue;
        scanAnchor(v, m, [x, y, z], push);
      }
  return flags;
}

/**
 * {@link analyzeChunk} over every allocated chunk — the whole-world convenience
 * for scripts, bakes, and tests; live editing analyses the dirty chunks only.
 *
 * Allocated chunks are the complete anchor set: an anchor needs an air cell, and
 * air only exists where a chunk has been written, so unallocated space (uniform
 * rock) can hold no flags — not even with `extraSolid`, which only ADDS
 * solidity.
 *
 * @returns One entry per allocated chunk, empty array included, keyed by the
 * owning chunk — the shape a flag store replaces wholesale per chunk.
 * @throws Error - as {@link analyzeChunk}, on an inconsistent agent profile or a
 * wrongly-encoded `extraSolid` buffer. Checked HERE and not only through the
 * per-chunk calls below, so an empty store rejects a bad profile too.
 */
export function analyzeWorld(
  store: FieldStore,
  profile: AgentProfile,
  opts?: AnalyzeOptions,
): Map<ChunkKey, FieldFlag[]> {
  // A store with no allocated chunks makes no per-chunk call, so the gate those
  // calls carry would never run — and setup-loud is about rejecting bad input,
  // not about rejecting it only when there is work to do.
  assertAnalyzeInputs(profile, opts);
  const out = new Map<ChunkKey, FieldFlag[]>();
  for (const key of store.chunks.keys())
    out.set(key, analyzeChunk(store, key, profile, opts));
  return out;
}
