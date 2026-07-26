// The substrate the walkability advisor's three passes share (D-F4-3): one
// read-only view over the field's rock plus the caller's extra colliders, the
// cell/world helpers every pass keys and reports on, and the setup-loud
// validation of the agent profile they are all parameterized by.
//
// Extracted when the third pass landed — `analyze.ts` owns the column pass,
// `reachability.ts` the two connectivity floods — precisely so neither can
// re-derive what is here. They have to agree on what rock is, what a standable
// column is, and how far the agent may climb, or their findings contradict each
// other. Nothing in this file knows about flags, filters or floods.
//
// Resolution note: the solidity below is the SAME one the runtime voxel collider
// derives from (`collider.ts`: density < 0 is rock, D-F4-5). The collider is what
// the capsule actually touches, so analysing at that resolution is exact w.r.t.
// the runtime geometry.
import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  sampleToWorld,
  voxelChunk,
} from "./chunks.ts";
import type { AgentProfile, ChunkKey, FieldStore } from "./types.ts";

/** Float slack on the clearance-vs-capsule consistency check (authored data). */
const CLEARANCE_EPS = 1e-9;

/** The 4 cardinal XZ neighbours. */
export const DIRS = [
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
 *  pass reads, so field rock and placement colliders cannot diverge. */
export type SolidView = {
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

/** The setup-loud gate EVERY analyzer entry point runs first: the agent profile,
 *  and the extra-solidity encoding when one is given.
 *
 *  Separate from {@link validatedView} because one entry point validates without
 *  opening a view of its own. `analyzeWorld` delegates all scanning to per-chunk
 *  calls, and a store with no allocated chunks makes none of them — so a gate
 *  reached only through those calls would let a bad profile pass silently
 *  exactly when there is nothing to analyse. "Throws only if there is work to
 *  do" is not a rule worth having; the gate is about rejecting bad input. */
export function assertAnalyzeInputs(
  profile: AgentProfile,
  opts: AnalyzeOptions | undefined,
): void {
  assertAgentProfileValid(profile);
  const extras = opts?.extraSolid;
  if (extras !== undefined) assertExtraSolidValid(extras);
}

/** The shared entry gate of every analyzer PASS: validate setup-loud, then open
 *  a fresh solidity view (per call, so its chunk memo can never outlive the
 *  store state it was taken against). */
export function validatedView(
  store: FieldStore,
  profile: AgentProfile,
  opts: AnalyzeOptions | undefined,
): SolidView {
  assertAnalyzeInputs(profile, opts);
  return {
    store,
    extras: opts?.extraSolid,
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
export function isSolid(
  v: SolidView,
  x: number,
  y: number,
  z: number,
): boolean {
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
export const isFloorAnchor = (
  v: SolidView,
  x: number,
  y: number,
  z: number,
): boolean => !isSolid(v, x, y, z) && isSolid(v, x, y - 1, z);

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
export function ceilingAbove(
  v: SolidView,
  x: number,
  y: number,
  z: number,
): number {
  let cy = y + 1;
  while (!isSolid(v, x, cy, z)) cy++;
  return cy;
}

/** Global-cell identity in a visited/reached set. Strings, as the column pass's
 *  flag dedupe uses: the coords are unbounded ints in both directions, so no
 *  packed integer key is available without picking an arbitrary world bound. */
export const cellKey = (x: number, y: number, z: number): string =>
  `${x},${y},${z}`;

/** World centre of the floor surface under an anchor cell: the cell's XZ centre
 *  and the Y of its bottom face (= the top of the rock below). */
export const floorSurfaceWorld = (
  cellSize: number,
  x: number,
  y: number,
  z: number,
): [number, number, number] => [
  sampleToWorld(x + 0.5, cellSize),
  sampleToWorld(y, cellSize),
  sampleToWorld(z + 0.5, cellSize),
];

/** The chunk holding a cell. */
export const chunkOf = (cell: readonly [number, number, number]): ChunkKey =>
  chunkKey(voxelChunk(cell[0]), voxelChunk(cell[1]), voxelChunk(cell[2]));

/** The CLIMB BAND in cells: how far the agent may rise or drop between adjacent
 *  floor anchors. `floor`, because this bounds what the mover is ALLOWED rather
 *  than what it requires — and the rounding is EXACT against the lattice rather
 *  than conservative, which `metricsFor` (the column pass, which folds this same
 *  helper into its own metrics) spells out in full.
 *
 *  Single-sourced here because all three passes read it and a disagreement about
 *  what "climbable" means would make their findings contradict: the column pass
 *  via `metricsFor`, and both connectivity floods directly. */
export const climbCellsFor = (
  profile: AgentProfile,
  cellSize: number,
): number => Math.floor(profile.climbCeiling / cellSize);
