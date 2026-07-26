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
import { warn } from "../log/internal.ts";
import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  parseChunkKey,
  sampleToWorld,
  voxelChunk,
  worldToVoxel,
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
/** Float slack on the clearance-vs-capsule consistency check (authored data). */
const CLEARANCE_EPS = 1e-9;
/** The 4 cardinal XZ neighbours. */
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
/** The 2 XZ axes, one direction each — the `narrow` scan mirrors them itself,
 *  because a pinch is a property of an axis and not of a side. */
const AXES = [
  [1, 0],
  [0, 1],
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

/** The rounding is asymmetric on purpose, and miss-safe in both directions:
 *  `ceil` on what the capsule REQUIRES (clearance, radius, probe heights)
 *  over-demands, and `floor` on what it is ALLOWED (step, climb) under-grants.
 *  Every threshold therefore lands strictly tighter than the real mover, which
 *  is the posture this pass wants — borderline geometry surfaces as a flag
 *  rather than being rounded away. Do not "fix" one of them into symmetry.
 *
 *  `climbCells` carries that same under-grant into {@link detectPits}, where it
 *  is an EDGE rule rather than a threshold: a rise the mover would just about
 *  make can read as one-way, which shrinks the return set and can only ADD pit
 *  regions. Over-reporting is the miss-safe direction for a trap hunt.
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
    climbCells: Math.floor(profile.climbCeiling / cellSize),
    cellSize,
    pinchWidth,
    pinchCells: Math.ceil(pinchWidth / cellSize),
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
    ["skin", profile.skin],
  ];
  for (const [name, value] of positive)
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(
        `analyze: agent profile ${name} must be a positive finite number, got ${value}`,
      );
  if (profile.skin >= profile.capsule.radius)
    throw new Error(
      `analyze: agent profile skin (${profile.skin}) must be below the capsule radius (${profile.capsule.radius}) — a contact margin that large would put the narrow pinch threshold past three radii`,
    );
  if (profile.climbCeiling <= profile.stepHeight)
    throw new Error(
      `analyze: agent profile climbCeiling (${profile.climbCeiling}) must exceed stepHeight (${profile.stepHeight}) — a mover that auto-steps higher than it can climb is not a profile any pass here can read`,
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

/** The shared entry gate of every pass here: validate setup-loud, then open a
 *  fresh solidity view (per call, so its chunk memo can never outlive the store
 *  state it was taken against). */
function validatedView(
  store: FieldStore,
  profile: AgentProfile,
  opts: AnalyzeOptions | undefined,
): SolidView {
  assertAgentProfileValid(profile);
  const extras = opts?.extraSolid;
  if (extras !== undefined) assertExtraSolidValid(extras);
  return {
    store,
    extras,
    cx: Number.NaN,
    cy: Number.NaN,
    cz: Number.NaN,
    density: undefined,
    extra: undefined,
  };
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

/** Global-cell identity in the reached set. Strings, as the flag dedupe above
 *  uses: the coords are unbounded ints in both directions, so no packed integer
 *  key is available without picking an arbitrary world bound. */
const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** The floor surface a seed STANDS on: its own cell if that is already a floor
 *  anchor, else the first one straight down — the mover falls, so descending is
 *  the only honest snap. A seed inside rock has no such surface and is refused.
 *
 *  The descent terminates on the data, like {@link ceilingAbove}: unallocated
 *  space reads SOLID, so a column falling out of the allocated region stops at
 *  its edge. */
function seedAnchor(
  v: SolidView,
  cellSize: number,
  seed: readonly [number, number, number],
): [number, number, number] | undefined {
  const x = worldToVoxel(seed[0], cellSize);
  const z = worldToVoxel(seed[2], cellSize);
  let y = worldToVoxel(seed[1], cellSize);
  if (isSolid(v, x, y, z)) return undefined;
  while (!isSolid(v, x, y - 1, z)) y--;
  return [x, y, z];
}

/** One node of both connectivity passes: a floor-anchor cell.
 *
 *  Nodes are {@link isFloorAnchor} cells — the SAME walkable notion the column
 *  pass anchors on, minus its headroom test. Dropping the headroom test is
 *  deliberate for {@link markUnreachable}: requiring clearance would cut the
 *  flood at every crawlspace and demote everything beyond it, whereas
 *  over-connecting only ever demotes LESS, and for a demote-only pass less is
 *  the miss-safe direction. {@link detectPits} inherits the same node set so the
 *  two passes cannot disagree about what a standable column is — but note the
 *  posture does NOT carry over as cleanly there (see its own remarks). */
type Column = [number, number, number];

/** Receives one neighbour column during an expansion. */
type VisitColumn = (x: number, y: number, z: number) => void;

/** An edge rule, as a function: offers a column's neighbours to `visit`.
 *
 *  The graph is deliberately NEVER materialized. Storing it — and a directed
 *  pass needs the TRANSPOSE too, which is the expensive half — would cost an
 *  edge list of up to `4 * (2 * climbCells + 2)` entries per node over a node
 *  set measured at ~1.1k columns on the F3b default cave and ~16.8k on the
 *  largest committed world (2026-07-26), and every pass here visits each node
 *  exactly once anyway. Re-enumerating per pass buys that memory back for one
 *  extra neighbourhood scan per node per pass, which the budget test prices. */
type Expand = (x: number, y: number, z: number, visit: VisitColumn) => void;

/** The CLIMB band, the one edge rule every pass here shares: floor anchors in
 *  the 4 XZ-adjacent columns within `climbCells` of (x,y,z). SYMMETRIC by
 *  construction — |Δy| ≤ climbCells reads the same from either end — so one
 *  enumeration serves the undirected flood and BOTH directions of the directed
 *  one. Steps are 4-connected, so a purely DIAGONAL step is not an edge. */
function climbNeighbours(
  v: SolidView,
  climbCells: number,
  x: number,
  y: number,
  z: number,
  visit: VisitColumn,
): void {
  for (const [dx, dz] of DIRS) {
    const nx = x + dx;
    const nz = z + dz;
    for (let ny = y - climbCells; ny <= y + climbCells; ny++)
      if (isFloorAnchor(v, nx, ny, nz)) visit(nx, ny, nz);
  }
}

/** Where walking off the edge LANDS (D-F4-18), per direction: the floor of the
 *  air pocket the neighbour column holds at OUR level, offered only when it
 *  sits more than `climbCells` below — a shallower drop is already a climb-band
 *  edge, and this one is DIRECTED (you fall in; you do not climb back out).
 *
 *  Rock at the neighbour's own level yields nothing: that is a wall to walk into,
 *  not an edge to walk off. There is no fall-distance limit and no fall-damage
 *  model in v1 — a 50 m drop is an edge exactly like a 1 m one. That matches the
 *  reference consumer's mover, which has no fall-damage concept either, and it
 *  is what makes a deep cavern floor ENTERABLE rather than merely unreachable.
 *  A consumer that adds fall damage has to revisit this rule.
 *
 *  The descent terminates on the data, as {@link seedAnchor}'s does: unallocated
 *  space reads SOLID, so a column falling out of the allocated region stops. */
function fallTargets(
  v: SolidView,
  climbCells: number,
  x: number,
  y: number,
  z: number,
  visit: VisitColumn,
): void {
  for (const [dx, dz] of DIRS) {
    const nx = x + dx;
    const nz = z + dz;
    if (isSolid(v, nx, y, nz)) continue;
    let ny = y;
    while (!isSolid(v, nx, ny - 1, nz)) ny--;
    if (ny < y - climbCells) visit(nx, ny, nz);
  }
}

/** The other end of {@link fallTargets}: every column that would LAND here.
 *
 *  The exact transpose, derived rather than approximated. `fallTargets` emits
 *  `u → v` iff v's column is air at u's level and the descent from there lands
 *  on v — which holds iff `y_v ≤ y_u < ceilingAbove(v)`, i.e. iff u's level is
 *  inside THIS cell's own air pocket — and iff the drop clears the climb band,
 *  `y_u > y_v + climbCells`. Intersecting those two gives the scanned range
 *  exactly: `[y + climbCells + 1, ceiling)`.
 *
 *  Two boundaries in that range are load-bearing, and both are tested:
 *  - The ceiling is EXCLUSIVE, so the pocket's topmost air cell is included. A
 *    scan stopping one short loses precisely the shelf that sits level with a
 *    roofed bay's top cell — and it is uncapped besides, the same
 *    data-terminated bound {@link ceilingAbove} supplies, because any cap
 *    silently drops every ledge above it (a false-negative cliff).
 *  - Starting past the climb band is an EFFICIENCY choice, not a correctness
 *    one: the levels it skips are exactly the ones {@link climbNeighbours}
 *    already offers, both ways.
 *
 *  Asymmetric in COUNT, though: a column falls into at most one pocket per
 *  direction, while a pocket can be fallen into from many ledges. */
function fallSources(
  v: SolidView,
  climbCells: number,
  x: number,
  y: number,
  z: number,
  visit: VisitColumn,
): void {
  const ceiling = ceilingAbove(v, x, y, z);
  for (const [dx, dz] of DIRS) {
    const nx = x + dx;
    const nz = z + dz;
    for (let ny = y + climbCells + 1; ny < ceiling; ny++)
      if (isFloorAnchor(v, nx, ny, nz)) visit(nx, ny, nz);
  }
}

/** Flood over floor-anchor columns from `starts`, following whatever `expand`
 *  offers, keyed by cell so callers can both test membership and iterate. Order
 *  is irrelevant to a reachable set, so the worklist is a plain stack.
 *
 *  Bounded by the data, with no artificial budget: a floor anchor needs an air
 *  cell, air exists only in allocated chunks, so the visited set can never
 *  exceed the store's allocated cells. */
function floodColumns(
  starts: readonly Column[],
  expand: Expand,
): Map<string, Column> {
  const seen = new Map<string, Column>();
  const pending: Column[] = [];
  const visit: VisitColumn = (x, y, z) => {
    const key = cellKey(x, y, z);
    if (seen.has(key)) return;
    const cell: Column = [x, y, z];
    seen.set(key, cell);
    pending.push(cell);
  };
  for (const s of starts) visit(s[0], s[1], s[2]);
  while (pending.length > 0) {
    const cur = pending.pop();
    if (cur === undefined) break;
    expand(cur[0], cur[1], cur[2], visit);
  }
  return seen;
}

/** Each seed's floor surface, dropping the ones with none. A buried or
 *  non-finite seed warns rather than throwing: seeds come from world data, and
 *  one stale spawn point must not veto the pass — {@link markUnreachable} would
 *  then demote an entire world on the strength of it. */
function seedColumns(
  v: SolidView,
  cellSize: number,
  seeds: readonly [number, number, number][],
  who: string,
): Column[] {
  const anchors: Column[] = [];
  for (const seed of seeds) {
    const anchor = seedAnchor(v, cellSize, seed);
    if (anchor === undefined)
      warn(
        "field",
        `${who}: seed has no floor surface below it (buried or non-finite) — ignored`,
        { seed },
      );
    else anchors.push(anchor);
  }
  return anchors;
}

/**
 * Marks every flag the agent cannot walk to from `seeds` as `unreachable`
 * (D-F4-8), WRITING THE VERDICT INTO the flags passed in — a triage demotion,
 * never a deletion. It removes no flag, changes no severity, and never touches
 * the store.
 *
 * The filter is a floor-connected flood from each seed's floor surface: four XZ
 * neighbours, any rise or drop within `climbCeiling` — the CLIMB BAND, the one
 * edge rule this module's two connectivity passes share, so "climbable" means
 * one thing here. Every flag anchors on a floor cell, so a flag is reachable
 * exactly when its anchor cell is in the flood.
 *
 * Miss-safety comes from demote-not-delete, NOT from the filter being sound —
 * which it is not, and deliberately so:
 * - **Falling is ignored.** A shelf the mover can only drop off, or reach by
 *   falling into, reads unreachable. {@link detectPits} models exactly that
 *   edge, and the two are deliberately NOT merged: this pass answers "can the
 *   agent get there at all", which stays the honest question for a demotion,
 *   and its undirected flood is what makes the answer conservative. One
 *   consequence follows directly and bites: this flood cannot enter a pit, so
 *   running it over `detectPits` output would demote every pit flag. Keep the
 *   two flag sets apart.
 * - Headroom is ignored, so the flood crosses gaps the capsule cannot fit
 *   through, and coarse cells (a `cellSize` COARSER than `climbCeiling`, which
 *   floors `climbCells` to 0 — an equal one still grants 1) strand everything
 *   off the seed's own level.
 * - **Steps are 4-connected in XZ.** A floor whose only route in is a DIAGONAL
 *   step reads unreachable, though the mover walks there fine.
 *
 * Every one of those errors is visible in the UI as a hidden-by-default filter,
 * never as a missing flag. Present the `unreachable` set; do not drop it.
 *
 * @param flags - The map {@link analyzeWorld} returns (or an equivalent set of
 * per-chunk arrays). MUTATED — this is the function's only output, and the only
 * thing it writes: every flag gets `unreachable` set, `false` when reached and
 * `true` when not, so a re-run after the world changes clears a stale demotion
 * as readily as it makes a new one. An unwritten (`undefined`) tag means this
 * never ran over that flag.
 *
 * That third state is not hypothetical: analysis is per-dirty-chunk while this
 * pass is whole-world, so a MIXED-VINTAGE map — freshly analysed flags that no
 * flood has visited yet, beside tagged ones — is the normal steady state.
 * Consumers must therefore filter on the POSITIVE: hide `unreachable === true`,
 * show everything else. Testing `=== false` for "reachable" silently hides every
 * not-yet-flooded flag, which is a false negative wearing a filter's clothes.
 * @param seeds - WORLD positions the agent starts from (`playerStart`, spawn
 * points). Each snaps to the floor surface at or below it; a seed buried in rock
 * is unusable and warns. An empty list — or a list where no seed is usable —
 * skips the pass entirely, leaving every tag as it was: with nothing known to be
 * reachable, tagging would demote the whole world.
 * @throws Error - setup-loud, as {@link analyzeChunk}: an inconsistent agent
 * profile, or an `extraSolid` buffer of the wrong length.
 */
export function markUnreachable(
  store: FieldStore,
  profile: AgentProfile,
  flags: ReadonlyMap<ChunkKey, readonly FieldFlag[]>,
  seeds: readonly [number, number, number][],
  opts?: AnalyzeOptions,
): void {
  const v = validatedView(store, profile, opts);
  if (seeds.length === 0) return;
  // A clean world is the common case in the edit loop; flooding it to tag
  // nothing is pure cost.
  if (![...flags.values()].some((list) => list.length > 0)) return;

  const anchors = seedColumns(v, store.cellSize, seeds, "markUnreachable");
  if (anchors.length === 0) {
    warn(
      "field",
      "markUnreachable: no usable seed — skipped, no flags demoted",
      { seeds: seeds.length },
    );
    return;
  }

  const { climbCells } = metricsFor(profile, store.cellSize);
  const reached = floodColumns(anchors, (x, y, z, visit) =>
    climbNeighbours(v, climbCells, x, y, z, visit),
  );
  for (const list of flags.values())
    for (const f of list)
      f.unreachable = !reached.has(cellKey(f.cell[0], f.cell[1], f.cell[2]));
}

/** One trap: the columns of a region, and the lowest of them. Tracked as the
 *  region is built, so the anchor never depends on flood order. */
type PitRegion = { anchor: Column; cells: Column[] };

/** Is `a` lower than `b` — Y first, then x, then z, so a flat-floored region
 *  picks the same anchor whatever order its columns were discovered in. */
function lowerColumn(a: Column, b: Column): boolean {
  if (a[1] !== b[1]) return a[1] < b[1];
  if (a[0] !== b[0]) return a[0] < b[0];
  return a[2] < b[2];
}

/** Splits the trapped columns into regions over the SAME edges the two floods
 *  walked, direction IGNORED: a shelf that drops into its own deeper floor is
 *  one trap and not two, because that is how the mover meets it. */
function pitRegions(
  v: SolidView,
  climbCells: number,
  trapped: ReadonlyMap<string, Column>,
): PitRegion[] {
  const claimed = new Set<string>();
  const regions: PitRegion[] = [];
  for (const [key, start] of trapped) {
    if (claimed.has(key)) continue;
    const region = floodColumns([start], (x, y, z, visit) => {
      const inside: VisitColumn = (nx, ny, nz) => {
        if (trapped.has(cellKey(nx, ny, nz))) visit(nx, ny, nz);
      };
      climbNeighbours(v, climbCells, x, y, z, inside);
      fallTargets(v, climbCells, x, y, z, inside);
      fallSources(v, climbCells, x, y, z, inside);
    });
    let anchor = start;
    for (const cell of region.values())
      if (lowerColumn(cell, anchor)) anchor = cell;
    for (const k of region.keys()) claimed.add(k);
    regions.push({ anchor, cells: [...region.values()] });
  }
  return regions;
}

/** The chunk holding a cell. */
const chunkOf = (cell: Column): ChunkKey =>
  chunkKey(voxelChunk(cell[0]), voxelChunk(cell[1]), voxelChunk(cell[2]));

/** One region as its flag: anchored at the bottom of the trap, carrying the
 *  region's size and every chunk it touches. */
function pitFlag(cellSize: number, region: PitRegion): FieldFlag {
  const [x, y, z] = region.anchor;
  const owners = new Set<ChunkKey>();
  for (const cell of region.cells) owners.add(chunkOf(cell));
  return {
    kind: "pit",
    severity: "candidate",
    cell: [x, y, z],
    world: floorSurfaceWorld(cellSize, x, y, z),
    chunk: chunkOf(region.anchor),
    chunks: [...owners].sort(),
    cells: region.cells.length,
  };
}

/**
 * Finds the regions the agent can get INTO and not back OUT of (D-F4-18) — the
 * connectivity half of the advisor, and the one finding no per-cell filter can
 * express. **ADVISORY ONLY**, like every pass here: it never mutates the store,
 * never blocks a verb, never auto-fixes.
 *
 * The graph is the standable columns {@link markUnreachable} floods, with a
 * directed edge rule between XZ-4-adjacent ones: within `climbCeiling` of each
 * other they connect BOTH ways; further apart the higher one connects to the
 * lower and not back — walking off an edge, which the mover does freely (no
 * fall-damage model here, and none in the reference consumer's mover either).
 * A pit is then ENTERABLE ∧ ¬CAN-RETURN:
 * the flood from the seeds MINUS the flood that reaches the seeds over reversed
 * edges. Those columns cluster into 4-connected regions and each region emits
 * ONE flag, anchored at its lowest column.
 *
 * This replaces what the `ledge` candidate band tried to say and could not:
 * measurement (P-F4-3) found a tall rise is simply what vertical cave terrain is
 * made of, while a trap is a property of the graph.
 *
 * @param seeds - WORLD positions the agent starts from (`playerStart`, spawn
 * points), each snapped DOWN to the floor surface at or below it; a seed buried
 * in rock warns and is dropped. An empty list — or one where no seed is usable —
 * returns NO flags: with no known starting point there is no "enterable", and
 * guessing a spawn would be the advisor inventing its own premise. Several seeds
 * are ONE set, not several runs: a region counts as returnable if it can reach
 * ANY of them, so a hollow with a spawn of its own in it is never a pit.
 * @returns One `candidate` flag per pit region, ordered by where the enterable
 * flood first met each region — a FLAT array,
 * not the per-chunk map {@link analyzeWorld} returns, because a pit is a global
 * property and this pass is world-cadence (run it on the idle tail, not per
 * dirty chunk: one dug cell can open or seal a trap anywhere in the world).
 * `cell`/`world` are the anchor column, `cells` is the region's size in columns,
 * and `chunks` is every chunk the region touches — `chunk` alone (the anchor's)
 * is NOT a complete owner, so pit flags must be replaced wholesale per run
 * rather than per owner chunk the way the column pass's flags are.
 * @throws Error - setup-loud, as {@link analyzeChunk}: an inconsistent agent
 * profile, or an `extraSolid` buffer of the wrong length. The gate runs BEFORE
 * the empty-seed return, so a bad profile throws even with nothing to do.
 * @remarks What this does NOT model, all of it inherited from the shared node
 * set and edge rule, and none of it one-directionally safe the way
 * {@link markUnreachable}'s unsoundness is — this pass reports rather than
 * demotes, so an error either way is a wrong finding:
 * - **Headroom is ignored** (the node set's own simplification), so both floods
 *   cross gaps the capsule cannot fit through. That can hide a pit whose only
 *   modelled exit is a crawlspace the mover cannot enter, and can invent one
 *   whose only modelled entrance is.
 * - **Steps are 4-connected in XZ**, so a region whose only way out is a
 *   DIAGONAL step reads as a pit though the mover walks out of it.
 * - **`climbCells` floors**, so a rise the mover would just about make can read
 *   one-way. That direction only ever ADDS regions. At a `cellSize` as coarse as
 *   `climbCeiling` it floors to 1, and coarser still to 0 — where every level
 *   change becomes a one-way drop and everything off the seed's own level reads
 *   as trapped. That is the same coarse-cell cliff {@link markUnreachable}
 *   documents, with a louder failure mode.
 * - **Falls have no distance limit**, so a 50 m drop is an entrance like any
 *   other. It matches the reference consumer's mover, which takes no fall
 *   damage, and it is what makes a deep cavern floor "enterable" rather than
 *   merely unreachable. A consumer that adds fall damage must revisit it.
 * - The **rim divergence** applies unchanged: unallocated chunks read SOLID, so
 *   a shelf at the outer rim of the allocated region can read as walled-in where
 *   the runtime has no collider at all.
 */
export function detectPits(
  store: FieldStore,
  profile: AgentProfile,
  seeds: readonly [number, number, number][],
  opts?: AnalyzeOptions,
): FieldFlag[] {
  const v = validatedView(store, profile, opts);
  if (seeds.length === 0) return [];

  const anchors = seedColumns(v, store.cellSize, seeds, "detectPits");
  if (anchors.length === 0) {
    warn("field", "detectPits: no usable seed — skipped, no pits reported", {
      seeds: seeds.length,
    });
    return [];
  }

  const { climbCells } = metricsFor(profile, store.cellSize);
  const enterable = floodColumns(anchors, (x, y, z, visit) => {
    climbNeighbours(v, climbCells, x, y, z, visit);
    fallTargets(v, climbCells, x, y, z, visit);
  });
  const canReturn = floodColumns(anchors, (x, y, z, visit) => {
    climbNeighbours(v, climbCells, x, y, z, visit);
    fallSources(v, climbCells, x, y, z, visit);
  });

  const trapped = new Map<string, Column>();
  for (const [key, cell] of enterable)
    if (!canReturn.has(key)) trapped.set(key, cell);
  return pitRegions(v, climbCells, trapped).map((region) =>
    pitFlag(store.cellSize, region),
  );
}
