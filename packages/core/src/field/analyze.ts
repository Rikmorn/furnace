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
  CHUNK_SAMPLES,
  chunkKey,
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
   *  as one BYTE per sample in `localIndex` order — length exactly
   *  `CHUNK_SAMPLES`, non-zero = solid. NOT a packed bitset; a packed producer
   *  would read as plausible partial garbage rather than failing, so the length
   *  is checked setup-loud. A missing chunk key means that chunk has no extras. */
  extraSolid?: ReadonlyMap<ChunkKey, Uint8Array>;
};

/** The store plus the caller's extra solidity: the one solidity truth every
 *  scan below reads, so field rock and placement colliders cannot diverge. */
type SolidView = {
  store: FieldStore;
  extras: ReadonlyMap<ChunkKey, Uint8Array> | undefined;
  /** Memo of the last chunk resolved. Every scan here walks a column, so 16
   *  consecutive probes hit the same chunk; without this each one rebuilt a
   *  `"cx,cy,cz"` key and re-hit the Map. NaN never equals itself, so the first
   *  probe always misses. */
  cx: number;
  cy: number;
  cz: number;
  density: Int8Array | undefined;
  extra: Uint8Array | undefined;
};

/** Agent thresholds resolved to CELLS at the store's cell size. */
type ColumnMetrics = {
  clearCells: number;
  wallCellsXZ: number;
  wallProbeUp: number;
  torsoCells: number;
  stepCells: number;
  climbCells: number;
};

type PushFlag = (
  kind: FlagKind,
  severity: FlagSeverity,
  x: number,
  y: number,
  z: number,
) => void;

/** The rounding is asymmetric on purpose, and miss-safe in both directions:
 *  `ceil` on what the capsule REQUIRES (clearance, radius, probe heights)
 *  over-demands, and `floor` on what it is ALLOWED (step, climb) under-grants.
 *  Every threshold therefore lands strictly tighter than the real mover, which
 *  is the posture this pass wants — borderline geometry surfaces as a flag
 *  rather than being rounded away. Do not "fix" one of them into symmetry. */
function metricsFor(profile: AgentProfile, cellSize: number): ColumnMetrics {
  const clearCells = Math.ceil(profile.clearance / cellSize);
  return {
    clearCells,
    wallCellsXZ: Math.ceil(profile.capsule.radius / cellSize),
    wallProbeUp: Math.ceil(WALL_PROBE_M / cellSize),
    torsoCells: Math.ceil(TORSO_PROBE_M / cellSize),
    stepCells: Math.floor(profile.stepHeight / cellSize),
    climbCells: Math.floor(profile.climbCeiling / cellSize),
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

/** Setup-loud check that every extra-solidity buffer uses the encoding the
 *  probe assumes. Length is the only tell a packed bitset gives: it reads
 *  without error and returns a plausible SUBSET of the true flags, which is a
 *  false-negative class arriving through the back door. Checked once here, not
 *  per probe — `isSolid` is the hot path. */
function assertExtraSolidValid(
  extras: ReadonlyMap<ChunkKey, Uint8Array>,
): void {
  for (const [key, bits] of extras)
    if (bits.length !== CHUNK_SAMPLES)
      throw new Error(
        `analyze: extraSolid["${key}"] has length ${bits.length}, expected ${CHUNK_SAMPLES} — one BYTE per sample in localIndex order, non-zero = solid (a packed bitset is not the encoding)`,
      );
}

/** Rock at (x,y,z) — the `collider.ts` predicate (density < 0), widened by the
 *  caller's extra solidity. Unallocated chunks read SOLID, the rule
 *  `chunks.ts`'s `getDensity` states and the collider derivation inherits.
 *
 *  This INLINES `getDensity` + `localIndex` rather than calling them, to hang a
 *  last-chunk memo off the resolution: a column scan probes the same chunk 16
 *  times running, and each call otherwise rebuilt a `"cx,cy,cz"` string and
 *  re-hit the Map. Measured 5x on the cave fixture and 7x on a 16 m open column
 *  — a constant-factor win only; cost stays O(headroom). The memo is safe
 *  because the pass never writes to the store (D-F4-1), so nothing it caches can
 *  go stale mid-call, and the view is per-call. The cost is a second copy of the
 *  store's layout rules: if the chunk elision rule or the sample index formula
 *  in `chunks.ts` ever changes, this function must change with it. */
function isSolid(v: SolidView, x: number, y: number, z: number): boolean {
  const cx = voxelChunk(x);
  const cy = voxelChunk(y);
  const cz = voxelChunk(z);
  if (cx !== v.cx || cy !== v.cy || cz !== v.cz) {
    const key = chunkKey(cx, cy, cz);
    v.cx = cx;
    v.cy = cy;
    v.cz = cz;
    v.density = v.store.chunks.get(key);
    v.extra = v.extras === undefined ? undefined : v.extras.get(key);
  }
  const density = v.density;
  if (density === undefined) return true; // unallocated chunk = uniform rock
  const i =
    x -
    cx * CHUNK_DIM +
    CHUNK_DIM * (y - cy * CHUNK_DIM + CHUNK_DIM * (z - cz * CHUNK_DIM));
  const d = density[i];
  if (d !== undefined && d < 0) return true;
  const extra = v.extra;
  if (extra === undefined) return false;
  // In range by construction — the buffer's length was checked at setup.
  const bit = extra[i];
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

/** The CEILING of the air volume a capsule at (x,y,z) stands in: the first rock
 *  cell above it, searched with NO cap.
 *
 *  A cap here is not a cheap safety net — it is the `stepCells + 2` mistake in
 *  disguise. Any ceiling lower than the true one silently drops every rise above
 *  it that stands in the volume the mover occupies, so a plateau in a tall
 *  cavern reads clean: a hard false-negative cliff at exactly the cap, which is
 *  the class D-F4-6 exists to forbid. (Measured: a 4-clearance cap lost a 8.00 m
 *  rise entirely while flagging 7.75 m, and bought no measurable time.)
 *
 *  The scan terminates on the data, not on a counter: unallocated chunks read
 *  SOLID and a store holds finitely many chunks, so any column runs out of air
 *  at the top of its topmost allocated chunk. */
function ceilingAbove(v: SolidView, x: number, y: number, z: number): number {
  let cy = y + 1;
  while (!isSolid(v, x, cy, z)) cy++;
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
 * `stepHeight`, `clearance` below the capsule's own height), or on an
 * `extraSolid` buffer whose length is not `CHUNK_SAMPLES`.
 * @remarks Unallocated space being rock is the field's own rule and the one
 * this pass wants, but note where it differs from the runtime: an unallocated
 * chunk emits no collider at all, so a mover moves through it freely. At the
 * OUTER rim of the allocated region — and only there — the two disagree, in
 * BOTH directions. Under-flagging: a floor within `clearance` of the rim reads
 * as headroom limited, or as no anchor at all, where the runtime would let the
 * capsule stand. Over-flagging, which is the half a user actually sees: the rim
 * reads as walls, so cells near a boundary corner pinch on two sides and the
 * region's edge grows a rim of `narrow` markers with no geometry under them.
 * Both are artifacts of where the allocated data stops, not of the world, and
 * both feed the false-positive counts any triage bar is calibrated against.
 * Interior chunk borders are unaffected as long as the caller keeps the
 * neighbouring chunks present.
 */
export function analyzeChunk(
  store: FieldStore,
  key: ChunkKey,
  profile: AgentProfile,
  opts?: AnalyzeOptions,
): FieldFlag[] {
  assertAgentProfileValid(profile);
  const extras = opts?.extraSolid;
  if (extras !== undefined) assertExtraSolidValid(extras);
  const v: SolidView = {
    store,
    extras,
    cx: Number.NaN,
    cy: Number.NaN,
    cz: Number.NaN,
    density: undefined,
    extra: undefined,
  };
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
