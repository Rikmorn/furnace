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
import {
  CHUNK_DIM,
  chunkKey,
  getDensity,
  localIndex,
  parseChunkKey,
  sampleToWorld,
  voxelChunk,
} from "./chunks.ts";
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
/** Sides (of the 4 cardinal) that must pinch before a cell reads `narrow`. */
const NARROW_MIN_SIDES = 2;
/** Float slack on the clearance-vs-capsule consistency check (authored data). */
const CLEARANCE_EPS = 1e-9;
/** Cap on the ceiling search, in capsule clearances. The field is unbounded, so
 *  a column open over a tall cavern would otherwise scan as far as the data
 *  reaches. Capping only ever TIGHTENS the air volume a rise is judged against
 *  (D-F4-6's bound is an upper limit), and 4 capsule heights is far past
 *  anything a mover could climb. */
const CEILING_SCAN_CLEARANCES = 4;

/** The 4 cardinal XZ neighbours. */
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Options shared by every analyzer entry point. */
export type AnalyzeOptions = {
  /** Extra solidity beyond the field itself (voxelized placement colliders),
   *  as one byte per sample in `localIndex` order — length `CHUNK_SAMPLES`,
   *  non-zero = solid. A missing chunk key means that chunk has no extras. */
  extraSolid?: ReadonlyMap<ChunkKey, Uint8Array>;
};

/** The store plus the caller's extra solidity: the one solidity truth every
 *  scan below reads, so field rock and placement colliders cannot diverge. */
type SolidView = {
  store: FieldStore;
  extras: ReadonlyMap<ChunkKey, Uint8Array> | undefined;
};

/** Agent thresholds resolved to CELLS at the store's cell size. */
type ColumnMetrics = {
  clearCells: number;
  wallCellsXZ: number;
  wallProbeUp: number;
  torsoCells: number;
  stepCells: number;
  climbCells: number;
  ceilingScanCells: number;
};

type PushFlag = (
  kind: FlagKind,
  severity: FlagSeverity,
  x: number,
  y: number,
  z: number,
) => void;

function metricsFor(profile: AgentProfile, cellSize: number): ColumnMetrics {
  const clearCells = Math.ceil(profile.clearance / cellSize);
  return {
    clearCells,
    wallCellsXZ: Math.ceil(profile.capsule.radius / cellSize),
    wallProbeUp: Math.ceil(WALL_PROBE_M / cellSize),
    torsoCells: Math.ceil(TORSO_PROBE_M / cellSize),
    stepCells: Math.floor(profile.stepHeight / cellSize),
    climbCells: Math.floor(profile.climbCeiling / cellSize),
    ceilingScanCells: CEILING_SCAN_CLEARANCES * clearCells,
  };
}

function assertAgentProfileValid(profile: AgentProfile): void {
  const positive: [string, number][] = [
    ["capsule.radius", profile.capsule.radius],
    ["capsule.halfHeight", profile.capsule.halfHeight],
    ["stepHeight", profile.stepHeight],
    ["climbCeiling", profile.climbCeiling],
    ["clearance", profile.clearance],
    ["slopeLimitDeg", profile.slopeLimitDeg],
  ];
  for (const [name, value] of positive)
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(
        `analyze: agent profile ${name} must be a positive finite number, got ${value}`,
      );
  if (profile.climbCeiling <= profile.stepHeight)
    throw new Error(
      `analyze: agent profile climbCeiling (${profile.climbCeiling}) must exceed stepHeight (${profile.stepHeight}) — the info band between them would be empty`,
    );
  const minClearance =
    2 * (profile.capsule.halfHeight + profile.capsule.radius);
  if (profile.clearance < minClearance - CLEARANCE_EPS)
    throw new Error(
      `analyze: agent profile clearance (${profile.clearance}) is below the capsule's own height (${minClearance})`,
    );
}

/** Rock at (x,y,z) — the `collider.ts` predicate (density < 0), widened by the
 *  caller's extra solidity. Unallocated chunks read SOLID, which `getDensity`
 *  implements directly and the collider derivation inherits. */
function isSolid(v: SolidView, x: number, y: number, z: number): boolean {
  if (getDensity(v.store, x, y, z) < 0) return true;
  if (v.extras === undefined) return false;
  const bits = v.extras.get(
    chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z)),
  );
  if (bits === undefined) return false;
  const bit = bits[localIndex(x, y, z)];
  return bit !== undefined && bit !== 0;
}

/** An air cell sitting directly on rock — a floor surface. */
const isFloorAnchor = (
  v: SolidView,
  x: number,
  y: number,
  z: number,
): boolean => !isSolid(v, x, y, z) && isSolid(v, x, y - 1, z);

/** Air cells from (x,y,z) upward, counted to at most `limit`. Stopping short of
 *  `limit` therefore always means rock stopped it — the sparse-store equivalent
 *  of the donor's "open to the top of the grid" escape hatch, which this field
 *  has no need of (there is no grid top; unallocated space is rock). */
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

/** The CEILING of the air volume a capsule at (x,y,z) stands in: the first rock
 *  cell above it, or `y + limit` when the column is open past the cap. */
function ceilingAbove(
  v: SolidView,
  x: number,
  y: number,
  z: number,
  limit: number,
): number {
  const stop = y + limit;
  let cy = y + 1;
  while (cy < stop && !isSolid(v, x, cy, z)) cy++;
  return cy;
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

/** How many of the 4 cardinal sides have rock within capsule radius at torso
 *  height. Scans EVERY offset out to the radius rather than only the cell at
 *  exactly that distance: at fine cell sizes an intermediate solid would
 *  otherwise be stepped over, and a missed pinch is the failure mode this
 *  filter exists to rule out. */
function narrowSides(
  v: SolidView,
  m: ColumnMetrics,
  x: number,
  y: number,
  z: number,
): number {
  const torsoY = y + m.torsoCells;
  let sides = 0;
  for (const [dx, dz] of DIRS)
    for (let d = 1; d <= m.wallCellsXZ; d++)
      if (isSolid(v, x + dx * d, torsoY, z + dz * d)) {
        sides++;
        break;
      }
  return sides;
}

/** The neighbour column's FIRST floor surface above ours, searched up to our own
 *  ceiling, classified by how far above it sits.
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
    if (ry > m.climbCells) push("ledge", "candidate", x, y, z);
    else if (ry > m.stepCells) push("ledge", "info", x, y, z);
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
  const ceiling = ceilingAbove(v, x, y, z, m.ceilingScanCells);
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
  if (narrowSides(v, m, x, y, z) >= NARROW_MIN_SIDES)
    push("narrow", "candidate", x, y, z);
}

/** World centre of the floor surface under an anchor cell: the cell's XZ centre
 *  and the Y of its bottom face (= the top of the rock below). */
const floorSurfaceWorld = (
  cellSize: number,
  x: number,
  y: number,
  z: number,
): [number, number, number] => [
  sampleToWorld(x + 0.5, cellSize),
  sampleToWorld(y, cellSize),
  sampleToWorld(z + 0.5, cellSize),
];

/**
 * Stage-1 walkability flags for one chunk: the capsule-column pass over the
 * field's solidity (D-F4-3). ADVISORY ONLY — it never mutates the store, never
 * blocks a verb, and never auto-fixes anything (D-F4-1).
 *
 * Filters, all strictly tighter than the mover's own limits so borderline
 * geometry surfaces: headroom below `clearance` (`low-clearance`); a neighbour
 * floor above `stepHeight` (`ledge`, `info` while within `climbCeiling`,
 * `candidate` past it — D-F4-7); a sub-step lip with a wall within capsule
 * radius beyond it (`lip-near-wall`, the wedge conjunction); rock within
 * capsule radius at torso height on two or more sides (`narrow`).
 *
 * @param key - The chunk whose own 16³ cells are the ANCHORS. Neighbour reads
 * cross chunk borders freely, so the caller must have the surrounding chunks
 * present (a worker mirror sends the halo); absent neighbours read as rock,
 * which is exactly what the runtime collider derives from. An unallocated key
 * is legal and yields no flags — air, and therefore every anchor, only exists
 * in allocated chunks.
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
 * `stepHeight`, `clearance` below the capsule's own height).
 * @remarks Unallocated space being rock is the field's own rule and the one
 * this pass wants, but note where it differs from the runtime: an unallocated
 * chunk emits no collider at all, so a mover moves through it freely. At the
 * OUTER rim of the allocated region — and only there — the two disagree: the
 * pass sees rock, so a floor within `clearance` of the rim reads as headroom
 * limited (or as no anchor at all) where the runtime would let the capsule
 * stand. Interior chunk borders are unaffected as long as the caller keeps the
 * neighbouring chunks present.
 */
export function analyzeChunk(
  store: FieldStore,
  key: ChunkKey,
  profile: AgentProfile,
  opts?: AnalyzeOptions,
): FieldFlag[] {
  assertAgentProfileValid(profile);
  const v: SolidView = { store, extras: opts?.extraSolid };
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
 * @throws Error - as {@link analyzeChunk}, on an inconsistent agent profile.
 */
export function analyzeWorld(
  store: FieldStore,
  profile: AgentProfile,
  opts?: AnalyzeOptions,
): Map<ChunkKey, FieldFlag[]> {
  const out = new Map<ChunkKey, FieldFlag[]>();
  for (const key of store.chunks.keys())
    out.set(key, analyzeChunk(store, key, profile, opts));
  return out;
}
