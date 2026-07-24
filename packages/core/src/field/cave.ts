// packages/core/src/field/cave.ts — the cave generator's SKELETON half (F3b Task 2).
//
// Pure data, no ops: chambers (floor-anchored blob clusters), a connected
// passage graph, and boundary mouths. The carve half (patch-op emission,
// themes, the `caveGenerator` def) lands in Task 3.
//
// Determinism is the contract (Pr-2): the whole skeleton is a pure function of
// (params, seed, extent) built on the integer RNG lineage (./rng.ts) — allowed
// float ops only (+ - * /, Math.sqrt/abs/min/max/floor/ceil/round, Math.imul).
// NO Math.hypot / sin / cos / pow / Math.random. Distances use
// Math.sqrt(dx*dx+dz*dz), never Math.hypot.
//
// Connectivity is INDUCTIVE (spec §3.1): the graph is a spanning tree plus
// explicit loop edges, and every mouth wires to its nearest chamber — a carved
// edge cannot fail to connect. Verticality is EXPLICIT edge types with a
// per-segment grade budget (D-F3-11 bias), never emergent worm pitch.

import {
  CHUNK_DIM,
  chunkKey,
  clampInt8,
  DEFAULT_CELL_SIZE,
  DENSITY_SCALE,
  SOLID,
  voxelChunk,
  worldToVoxel,
} from "./chunks.ts";
import { PATCH_MASK_BYTES } from "./ops.ts";
import { fnv1a, makeIntRng } from "./rng.ts";
import type {
  GeneratorDef,
  GeneratorResult,
  MergePolicy,
  PatchChunk,
  PatchOp,
} from "./types.ts";

// ─── tuning constants ───
// Exported for the test suite (imported via the relative source path) so the
// pinned geometry contract cannot drift; deliberately NOT re-exported from the
// field index — they are the cave generator's internal contract, not consumer
// API.

/** Floor-height quantum (m): every passage floorY is a multiple of this. */
export const RISER = 0.25;
/** Minimum flat run (m) between two risers — the tread depth of a step. */
export const MIN_TREAD = 0.5;
/** The steepest grade (rise/run) a quantized stepped floor achieves: one
 *  {@link RISER} over one {@link MIN_TREAD}. Every passage segment stays at or
 *  under this. */
export const MAX_GRADE = RISER / MIN_TREAD; // 0.5
/** Hard cap on switchback reversal legs (a search budget, never loop-until-fit):
 *  beyond this the passage clamps its own Δy — bias, not guarantee. */
export const MAX_SWITCHBACKS = 4;
/** Hard cap on dart-throwing attempts per chamber before accept-anyway (a
 *  search budget, never loop-until-fit). */
export const MAX_DART_ATTEMPTS = 32;

/** One-cell inset (m) the carver must respect — the skeleton keeps every blob
 *  and waypoint this far inside the extent so the carve never writes outside.
 *  Exported so the bounds test derives its margin from the same source. */
export const BOUNDS_MARGIN = DEFAULT_CELL_SIZE;
/** Max lateral waypoint jitter (m) on straight passages (clamped to the
 *  in-bounds room per waypoint, so it never pushes a waypoint outside). */
const JITTER = 0.4;
/** A switchback leg's perp swing as a multiple of its forward advance. Being
 *  > 1 guarantees consecutive legs point > 90° apart (the required reversal). */
const SWITCHBACK_AMP_FACTOR = 1.25;
/** A hair of extra leg run (m) beyond the exact tread boundary, so `floor(legLen
 *  / MIN_TREAD)` keeps full capacity instead of losing a riser to sqrt rounding
 *  at the boundary — negligible geometrically, only ever makes a step gentler. */
const TREAD_SLOP = 1e-6;
/** Target straight-passage segment length (m) — subdivides long passages so
 *  jitter reads as a winding tunnel, never below the grade-safe cap. */
const SEG_TARGET = 2.0;

// ─── param ranges + defaults (single-sourced here; Task 3's schema mirrors) ───
const CHAMBERS_RANGE = { min: 2, max: 6, def: 3 } as const;
const RADIUS_RANGE = { min: 3, max: 8, def: 5 } as const;
const VERTICALITY_RANGE = { min: 0, max: 1, def: 0.5 } as const;
const LOOPS_RANGE = { min: 0, max: 3, def: 1 } as const;
/** The `-1` auto-centre sentinel — mirrors the hall/maze door convention. */
const AUTO_CENTRE = -1;

// ─── exported skeleton types (re-exported from the field index) ───

/** A cave chamber: a floor-anchored blob cluster. All coords region-LOCAL
 *  metres. The floor plane sits at `center[1] - radii[1]`. */
export type CaveChamber = {
  /** Blob centroid (region-local metres). */
  center: [number, number, number];
  /** Ellipsoid-ish extents (rx, ry, rz) about the centre. */
  radii: [number, number, number];
  /** Sub-blobs composing the chamber (2–4), each an offset + radius that stays
   *  inside the chamber's `radii` box. */
  blobs: { offset: [number, number, number]; radius: number }[];
};

/** A passage's verticality class. EXPLICIT edge types with a per-segment grade
 *  budget — never emergent worm pitch (D-F3-11 bias). `switchback` carries the
 *  climb through direction-reversing legs when the straight run is too short. */
export type CavePassageKind = "level" | "stepped" | "switchback";

/** One graph edge, realized as a floor polyline. Floor heights are ALREADY
 *  quantized to {@link RISER} risers with `>= MIN_TREAD` run between risers, so
 *  the carver just protects them.
 *
 *  A passage's first waypoint always sits at its `from` chamber's floor. Its
 *  last waypoint reaches the `to` chamber's floor EXCEPT for a `switchback` (or
 *  the straight clamp fallback) in an extreme-aspect-ratio region where the Δy
 *  cannot fit the grade budget even at {@link MAX_SWITCHBACKS} legs: there the
 *  passage delivers a prefix of the climb and lands SHORT of the far chamber
 *  floor — a bias, not a guarantee (D-F3-11), never under-delivering by more
 *  than the intended Δy. See `docs/backlog/dungeon/cave-chamber-floor-
 *  reconciliation.md`. */
export type CavePassage = {
  /** Source chamber index, or `-1` for a mouth terminal. */
  from: number;
  /** Destination chamber index, or `-1` for a mouth terminal. */
  to: number;
  /** The verticality class of this edge. */
  kind: CavePassageKind;
  /** Polyline waypoints (region-local metres). */
  waypoints: [number, number, number][];
  /** Quantized floor Y at each waypoint (parallel to {@link waypoints}). */
  floorY: number[];
};

/** A boundary mouth: a walkable opening on one region face, authored per
 *  D-F3-13 (per-face booleans + lateral offsets). */
export type CaveMouth = {
  /** Which region face this mouth opens through. */
  face: "north" | "south" | "east" | "west";
  /** The mouth's region-local position (on its face, at floor height). */
  at: [number, number, number];
};

/** The macro skeleton: chambers, the connected passage graph, and the boundary
 *  mouths — pure data the carve stage (Task 3) compiles into patch ops. */
export type CaveSkeleton = {
  chambers: CaveChamber[];
  passages: CavePassage[];
  mouths: CaveMouth[];
};

// ─── internal types ───
type Vec2 = [number, number]; // an XZ point/vector
type Face = CaveMouth["face"];
const FACES: readonly Face[] = ["north", "south", "east", "west"];

type CaveParams = {
  chambers: number;
  chamberRadius: number;
  verticality: number;
  extraLoops: number;
  doors: { face: Face; offset: number | undefined }[];
};

// ─── integer-RNG float helpers (Pr-2: only the allowed ops) ───
/** A uint32 stream mapped to [0, 1) via an exact power-of-two division. */
const rand01 = (rng: () => number): number => (rng() >>> 8) / 0x1000000;
/** A float in [lo, hi) from one stream draw. */
const randRange = (rng: () => number, lo: number, hi: number): number =>
  lo + rand01(rng) * (hi - lo);
/** An integer in [lo, hiExclusive) from one stream draw. */
const randInt = (rng: () => number, lo: number, hiExclusive: number): number =>
  lo + (rng() % (hiExclusive - lo));

/** Read an array at a caller-proven-valid index, narrowing away the
 *  `noUncheckedIndexedAccess` widening the same way generators.ts narrows its
 *  proven-in-bounds reads. Every call site indexes with a value bounded by
 *  construction (a loop bound, an edge endpoint, an array length). */
const at = <T>(arr: readonly T[], i: number): T => arr[i] as T;

// ─── small geometry helpers (Pr-2-safe) ───
const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));
/** Horizontal (XZ) distance — Math.sqrt of the squared form, never hypot. */
const horizDist = (a: Vec2, b: Vec2): number => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  return Math.sqrt(dx * dx + dz * dz);
};
/** 3D distance — Math.sqrt of the squared form, never hypot. */
const dist3 = (
  a: [number, number, number],
  b: [number, number, number],
): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};
/** Unit XZ direction A→B, or +X for a degenerate (coincident) pair. */
const horizDir = (a: Vec2, b: Vec2): Vec2 => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-9) return [1, 0];
  return [dx / len, dz / len];
};
/** The right-hand perpendicular of an XZ unit vector. */
const perpOf = (d: Vec2): Vec2 => [d[1], -d[0]];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Snap a height to the nearest {@link RISER} multiple. */
const quantize = (y: number): number => Math.round(y / RISER) * RISER;
/** The chamber's representative radius (its largest extent). */
const repRadius = (c: CaveChamber): number =>
  Math.max(c.radii[0], c.radii[1], c.radii[2]);
/** A chamber's floor-plane centre point (XZ centre, floor height). */
const floorPoint = (c: CaveChamber): [number, number, number] => [
  c.center[0],
  c.center[1] - c.radii[1],
  c.center[2],
];
/** How far a point can travel from `p` in unit direction `dir` before leaving
 *  the in-bounds box `[MARGIN, extent - MARGIN]` on each axis. */
const boundaryRoom = (p: Vec2, dir: Vec2, extent: Vec2): number => {
  const room = (pc: number, dc: number, ext: number): number => {
    if (dc > 1e-9) return (ext - BOUNDS_MARGIN - pc) / dc;
    if (dc < -1e-9) return (BOUNDS_MARGIN - pc) / dc;
    return Number.POSITIVE_INFINITY;
  };
  return Math.max(
    0,
    Math.min(room(p[0], dir[0], extent[0]), room(p[1], dir[1], extent[1])),
  );
};

// ─── param reading (tolerant defaults; Task 3's generator does the strict,
//     setup-loud schema validation before it ever calls in) ───
const numOr = (v: unknown, def: number, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : def;
const intOr = (v: unknown, def: number, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v)
    ? clamp(Math.round(v), lo, hi)
    : def;
const boolOr = (v: unknown, def: boolean): boolean =>
  typeof v === "boolean" ? v : def;

const cap = (s: string): string => s[0]?.toUpperCase() + s.slice(1);

function readCaveParams(params: Record<string, unknown>): CaveParams {
  const doors: CaveParams["doors"] = [];
  for (const face of FACES) {
    const enabled = boolOr(params[`door${cap(face)}`], face === "north");
    if (!enabled) continue;
    const raw = params[`door${cap(face)}Offset`];
    const off =
      typeof raw === "number" && Number.isFinite(raw)
        ? Math.round(raw)
        : AUTO_CENTRE;
    doors.push({
      face,
      offset: off === AUTO_CENTRE ? undefined : Math.max(0, off),
    });
  }
  return {
    chambers: intOr(
      params["chambers"],
      CHAMBERS_RANGE.def,
      CHAMBERS_RANGE.min,
      CHAMBERS_RANGE.max,
    ),
    chamberRadius: numOr(
      params["chamberRadius"],
      RADIUS_RANGE.def,
      RADIUS_RANGE.min,
      RADIUS_RANGE.max,
    ),
    verticality: numOr(
      params["verticality"],
      VERTICALITY_RANGE.def,
      VERTICALITY_RANGE.min,
      VERTICALITY_RANGE.max,
    ),
    extraLoops: intOr(
      params["extraLoops"],
      LOOPS_RANGE.def,
      LOOPS_RANGE.min,
      LOOPS_RANGE.max,
    ),
    doors,
  };
}

// ─── chambers (per-chamber prefix-stable streams; budgeted dart-throwing) ───
function buildBlobs(
  rng: () => number,
  rx: number,
  ry: number,
  rz: number,
): CaveChamber["blobs"] {
  const minR = Math.min(rx, ry, rz);
  // A central core plus 1–3 offset sub-blobs; each stays inside the radii box
  // (|offset_axis| <= 0.4*radii_axis, radius <= 0.6*minR ⇒ offset+radius <= radii).
  const blobs: CaveChamber["blobs"] = [
    { offset: [0, 0, 0], radius: minR * 0.9 },
  ];
  const total = randInt(rng, 2, 5); // 2..4 blobs total
  for (let i = 1; i < total; i++) {
    blobs.push({
      offset: [
        randRange(rng, -rx * 0.4, rx * 0.4),
        randRange(rng, -ry * 0.4, ry * 0.4),
        randRange(rng, -rz * 0.4, rz * 0.4),
      ],
      radius: randRange(rng, minR * 0.4, minR * 0.6),
    });
  }
  return blobs;
}

/** Dart-throw an in-bounds centre that clears every placed chamber by the
 *  min-separation, budgeted at {@link MAX_DART_ATTEMPTS} then accept-anyway. */
function dartThrow(
  rng: () => number,
  extent: Vec2,
  rx: number,
  rz: number,
  centerY: number,
  rep: number,
  placed: CaveChamber[],
): [number, number, number] {
  const loX = BOUNDS_MARGIN + rx;
  const hiX = extent[0] - BOUNDS_MARGIN - rx;
  const loZ = BOUNDS_MARGIN + rz;
  const hiZ = extent[1] - BOUNDS_MARGIN - rz;
  const clears = (c: [number, number, number]): boolean =>
    placed.every((p) => dist3(c, p.center) >= (rep + repRadius(p)) * 0.8);
  let last: [number, number, number] = [
    hiX <= loX ? extent[0] / 2 : loX,
    centerY,
    hiZ <= loZ ? extent[1] / 2 : loZ,
  ];
  for (let attempt = 0; attempt < MAX_DART_ATTEMPTS; attempt++) {
    const c: [number, number, number] = [
      hiX <= loX ? extent[0] / 2 : randRange(rng, loX, hiX),
      centerY,
      hiZ <= loZ ? extent[1] / 2 : randRange(rng, loZ, hiZ),
    ];
    last = c;
    if (clears(c)) return c;
  }
  return last; // budgeted: accept the last candidate rather than loop forever
}

function buildChambers(
  p: CaveParams,
  seed: number,
  extent: [number, number, number],
): CaveChamber[] {
  const chambers: CaveChamber[] = [];
  // Radii fit the extent so a chamber never overhangs the in-bounds box — for
  // ALL extents (Task 3's carver relies on "never writes outside the region").
  // Floored at 0 (not a comfort minimum): a tiny extent yields a tiny chamber,
  // never one that spills past the margin.
  const maxRx = Math.max(0, extent[0] / 2 - BOUNDS_MARGIN);
  const maxRy = Math.max(0, extent[1] / 2 - BOUNDS_MARGIN);
  const maxRz = Math.max(0, extent[2] / 2 - BOUNDS_MARGIN);
  for (let i = 0; i < p.chambers; i++) {
    // Prefix-stable per-chamber stream (donor buildGraphN per-bore keying):
    // adding/removing a chamber never reshuffles an earlier one's geometry.
    const rng = makeIntRng(fnv1a(`${seed}:${i}`));
    const rx = Math.min(p.chamberRadius * randRange(rng, 0.7, 1.3), maxRx);
    const rz = Math.min(p.chamberRadius * randRange(rng, 0.7, 1.3), maxRz);
    const ry = Math.min(p.chamberRadius * randRange(rng, 0.4, 0.7), maxRy);
    // Floor heights spread across the usable Y range, scaled by verticality:
    // 0 → all near one level; 1 → the full range.
    const floorLo = BOUNDS_MARGIN;
    const floorHi = extent[1] - BOUNDS_MARGIN - 2 * ry;
    const spread = Math.max(0, floorHi - floorLo) * p.verticality;
    const floorY = quantize(floorLo + spread * rand01(rng));
    const centerY = floorY + ry;
    const rep = Math.max(rx, ry, rz);
    const center = dartThrow(
      rng,
      [extent[0], extent[2]],
      rx,
      rz,
      centerY,
      rep,
      chambers,
    );
    chambers.push({
      center,
      radii: [rx, ry, rz],
      blobs: buildBlobs(rng, rx, ry, rz),
    });
  }
  return chambers;
}

// ─── graph (deterministic Prim spanning tree + nearest extra loops) ───
type Edge = [number, number];
const edgeKey = (a: number, b: number): string =>
  a < b ? `${a}-${b}` : `${b}-${a}`;

function spanningTree(chambers: CaveChamber[]): Edge[] {
  const n = chambers.length;
  const edges: Edge[] = [];
  if (n <= 1) return edges;
  const connected = [0];
  const inTree = new Set([0]);
  while (inTree.size < n) {
    let best: { a: number; b: number; d: number } | null = null;
    for (const a of connected) {
      for (let b = 0; b < n; b++) {
        if (inTree.has(b)) continue;
        const d = dist3(at(chambers, a).center, at(chambers, b).center);
        if (best === null || d < best.d) best = { a, b, d }; // strict < ⇒ first-found wins ties
      }
    }
    if (best === null) break; // unreachable for n > 1
    edges.push([best.a, best.b]);
    inTree.add(best.b);
    connected.push(best.b);
  }
  return edges;
}

function extraLoopEdges(
  chambers: CaveChamber[],
  tree: Edge[],
  extraLoops: number,
): Edge[] {
  const n = chambers.length;
  const inTree = new Set(tree.map(([a, b]) => edgeKey(a, b)));
  const pairs: { a: number; b: number; d: number }[] = [];
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      if (inTree.has(edgeKey(a, b))) continue;
      pairs.push({
        a,
        b,
        d: dist3(at(chambers, a).center, at(chambers, b).center),
      });
    }
  pairs.sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b);
  return pairs.slice(0, extraLoops).map(({ a, b }): Edge => [a, b]);
}

// ─── mouths (door convention; each wires to its nearest chamber's floor) ───
function nearestChamber(chambers: CaveChamber[], xz: Vec2): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < chambers.length; i++) {
    const c = at(chambers, i);
    const d = horizDist([c.center[0], c.center[2]], xz);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** A face mouth's XZ position from its lateral offset (metres from the min
 *  corner along the face, `-1`/undefined → the face midpoint), clamped to the
 *  in-bounds span. */
function mouthXZ(
  face: Face,
  offset: number | undefined,
  extent: [number, number, number],
): Vec2 {
  const lateral = (ext: number): number =>
    offset === undefined
      ? ext / 2
      : clamp(offset, BOUNDS_MARGIN, ext - BOUNDS_MARGIN);
  const near = BOUNDS_MARGIN;
  if (face === "north") return [lateral(extent[0]), extent[2] - near];
  if (face === "south") return [lateral(extent[0]), near];
  if (face === "east") return [extent[0] - near, lateral(extent[2])];
  return [near, lateral(extent[2])]; // west
}

function buildMouths(
  p: CaveParams,
  extent: [number, number, number],
  chambers: CaveChamber[],
): { mouths: CaveMouth[]; nearest: number[] } {
  const mouths: CaveMouth[] = [];
  const nearest: number[] = [];
  for (const door of p.doors) {
    const xz = mouthXZ(door.face, door.offset, extent);
    const ci = chambers.length > 0 ? nearestChamber(chambers, xz) : -1;
    // The mouth opens at its nearest chamber's floor height, so the mouth
    // passage is level (Δy 0) — verticality lives on inter-chamber edges.
    const y = ci >= 0 ? floorPoint(at(chambers, ci))[1] : BOUNDS_MARGIN;
    mouths.push({ face: door.face, at: [xz[0], y, xz[1]] });
    nearest.push(ci);
  }
  return { mouths, nearest };
}

// ─── passages ───

/** Assemble a straight (level/stepped) passage: evenly-spaced risers along the
 *  A→B floor line, each interior waypoint jittered laterally (clamped so it
 *  stays in bounds). Preconditions guarantee |Δy| <= MAX_GRADE * L, so every
 *  riser-bearing segment keeps run >= MIN_TREAD and grade <= MAX_GRADE. */
function straightPassage(
  from: number,
  to: number,
  a: [number, number, number],
  b: [number, number, number],
  extent: [number, number, number],
  rng: () => number,
): CavePassage {
  const A: Vec2 = [a[0], a[2]];
  const B: Vec2 = [b[0], b[2]];
  const L = horizDist(A, B);
  const dy = b[1] - a[1];
  const sign = dy >= 0 ? 1 : -1;
  const risers = Math.round(Math.abs(dy) / RISER);
  // `level` means genuinely flat (no risers); any climb is `stepped`.
  const kind: CavePassageKind = risers === 0 ? "level" : "stepped";
  // Segment count: enough to place every riser one-per-segment, subdivided
  // toward SEG_TARGET for winding, capped so each segment run stays >= MIN_TREAD.
  const capBySeg = Math.max(1, Math.floor(L / MIN_TREAD));
  const wanted = Math.max(risers, Math.ceil(L / SEG_TARGET), 1);
  const nSteps = Math.max(1, Math.min(wanted, capBySeg));
  const dir = horizDir(A, B);
  const perp = perpOf(dir);
  const waypoints: [number, number, number][] = [];
  const floorY: number[] = [];
  for (let k = 0; k <= nSteps; k++) {
    const t = k / nSteps;
    const base: Vec2 = [lerp(A[0], B[0], t), lerp(A[1], B[1], t)];
    let j = 0;
    if (k !== 0 && k !== nSteps) {
      const raw = randRange(rng, -JITTER, JITTER);
      // Clamp jitter to the in-bounds room on the side it points.
      const room = boundaryRoom(base, raw >= 0 ? perp : [-perp[0], -perp[1]], [
        extent[0],
        extent[2],
      ]);
      j = clamp(raw, -room, room);
    }
    const cum = Math.round((risers * k) / nSteps);
    const y = quantize(a[1] + sign * RISER * cum);
    waypoints.push([base[0] + perp[0] * j, y, base[1] + perp[1] * j]);
    floorY.push(y);
  }
  return { from, to, kind, waypoints, floorY };
}

/** How many risers one switchback leg can carry at `>= MIN_TREAD` per riser —
 *  the grade-legal cap. Shared by the fit decision and the assembly so they
 *  cannot disagree. */
const legCapacity = (fstep: number, amp: number): number =>
  Math.floor(Math.sqrt(fstep * fstep + amp * amp) / MIN_TREAD);

/** Spread `total` risers across `legs` legs, at most `perLegCap` each, extras
 *  on the earliest legs — deterministic. */
function distributeRisers(
  total: number,
  legs: number,
  perLegCap: number,
): number[] {
  const out = new Array<number>(legs).fill(0);
  let remaining = total;
  for (let j = 0; j < legs && remaining > 0; j++) {
    const take = Math.min(perLegCap, Math.ceil(remaining / (legs - j)));
    out[j] = take;
    remaining -= take;
  }
  return out;
}

/** Build the switchback polyline: `legs` legs, each advancing `fstep` forward
 *  and swinging `amp` to alternating perp sides (so consecutive legs reverse),
 *  climbing `risers` risers total. `amp > fstep` guarantees the reversal. */
function assembleSwitchback(
  from: number,
  to: number,
  a: [number, number, number],
  sign: number,
  risers: number,
  legs: number,
  fwd: Vec2,
  perp: Vec2,
  side: number,
  fstep: number,
  amp: number,
): CavePassage {
  const perLegCap = Math.max(1, legCapacity(fstep, amp));
  const per = distributeRisers(risers, legs, perLegCap);
  const waypoints: [number, number, number][] = [[a[0], a[1], a[2]]];
  const floorY: number[] = [a[1]];
  let px = a[0];
  let pz = a[2];
  let climbed = 0;
  for (let j = 0; j < legs; j++) {
    const legRisers = at(per, j);
    const subN = Math.max(1, legRisers);
    const legSide = side * (j % 2 === 0 ? 1 : -1);
    const df = fstep / subN;
    const dp = amp / subN;
    for (let s = 1; s <= subN; s++) {
      px += fwd[0] * df + perp[0] * legSide * dp;
      pz += fwd[1] * df + perp[1] * legSide * dp;
      if (s <= legRisers) climbed++;
      const y = quantize(a[1] + sign * RISER * climbed);
      waypoints.push([px, y, pz]);
      floorY.push(y);
    }
  }
  return { from, to, kind: "switchback", waypoints, floorY };
}

/** Attempt a bounds-fitting switchback; null if even 4 legs cannot fit a
 *  reversal within the region (caller then clamps to a straight passage). */
function trySwitchback(
  from: number,
  to: number,
  a: [number, number, number],
  b: [number, number, number],
  extent: [number, number, number],
): CavePassage | null {
  const A: Vec2 = [a[0], a[2]];
  const B: Vec2 = [b[0], b[2]];
  const L = horizDist(A, B);
  const dy = b[1] - a[1];
  const sign = dy >= 0 ? 1 : -1;
  const risers = Math.round(Math.abs(dy) / RISER);
  const fwd = horizDir(A, B);
  const perp = perpOf(fwd);
  // Pick the perp side with more room (measured at the endpoints — the min of a
  // concave boundary-room function over the segment lands at an endpoint).
  const roomOn = (dir: Vec2): number =>
    Math.min(
      boundaryRoom(A, dir, [extent[0], extent[2]]),
      boundaryRoom(B, dir, [extent[0], extent[2]]),
    );
  const side = roomOn(perp) >= roomOn([-perp[0], -perp[1]]) ? 1 : -1;
  const budget = roomOn([perp[0] * side, perp[1] * side]);
  for (const legs of [2, 4]) {
    if (legs - 1 > MAX_SWITCHBACKS) continue;
    const fstep = L / legs;
    // Size legs to carry EVERY riser: the busiest leg holds ceil(risers/legs)
    // risers, needing that many treads of run. Solve for the perp swing that
    // reaches that leg length (the +TREAD_SLOP keeps floor() off the boundary).
    const maxPerLeg = Math.ceil(risers / legs);
    const legLenForRisers = maxPerLeg * MIN_TREAD + TREAD_SLOP;
    const ampForRisers = Math.sqrt(
      Math.max(0, legLenForRisers * legLenForRisers - fstep * fstep),
    );
    const ampWanted = Math.max(ampForRisers, fstep * SWITCHBACK_AMP_FACTOR);
    const amp = Math.min(ampWanted, budget);
    if (amp <= fstep) continue; // no reversal possible at this leg count/budget
    const fit = Math.min(risers, legs * legCapacity(fstep, amp));
    if (fit < 1) continue;
    return assembleSwitchback(
      from,
      to,
      a,
      sign,
      fit,
      legs,
      fwd,
      perp,
      side,
      fstep,
      amp,
    );
  }
  return null;
}

/** One passage between two floor points. Kind is chosen by |Δfloor| against the
 *  straight run; too steep for a straight climb becomes a switchback, or (last
 *  resort, no lateral room) a straight passage that clamps its own Δy — bias,
 *  not guarantee (D-F3-11). */
function buildPassage(
  from: number,
  to: number,
  a: [number, number, number],
  b: [number, number, number],
  extent: [number, number, number],
  rng: () => number,
): CavePassage {
  const L = horizDist([a[0], a[2]], [b[0], b[2]]);
  const dy = b[1] - a[1];
  if (Math.abs(dy) <= MAX_GRADE * L)
    return straightPassage(from, to, a, b, extent, rng);
  const swb = trySwitchback(from, to, a, b, extent);
  if (swb !== null) return swb;
  // Clamp: shrink Δy to what a straight stepped passage can carry over L.
  const sign = dy >= 0 ? 1 : -1;
  const risers = Math.floor((MAX_GRADE * L) / RISER);
  const clampedB: [number, number, number] = [
    b[0],
    quantize(a[1] + sign * risers * RISER),
    b[2],
  ];
  return straightPassage(from, to, a, clampedB, extent, rng);
}

// ─── the skeleton ───

/** Build the deterministic macro skeleton for a cave region: chambers, a
 *  connected passage graph, and boundary mouths.
 *
 *  Pure in `(params, seed, extent)` — same inputs reproduce a deep-equal
 *  skeleton (Pr-2); the integer RNG lineage is consumed in a fixed order
 *  (chambers → graph → passages → mouths) with prefix-stable per-chamber
 *  streams. Connectivity is inductive: the graph is a spanning tree plus
 *  `extraLoops` near-pair edges, and every mouth wires to its nearest chamber,
 *  so every chamber is reachable from every mouth. Verticality is delivered as
 *  explicit passage kinds under a per-segment grade budget ({@link MAX_GRADE}),
 *  with floors quantized to {@link RISER} risers. Bounds hold for ALL extents:
 *  every blob and waypoint stays a {@link BOUNDS_MARGIN} inset inside the extent.
 *  In an extreme-aspect-ratio region a steep passage may land short of its far
 *  chamber floor — see {@link CavePassage} (bias, not guarantee — D-F3-11).
 *
 *  Params are read tolerantly with defaults (the `caveGenerator` def does the
 *  strict, setup-loud schema validation before calling in): `chambers` (2–6),
 *  `chamberRadius` (3–8 m), `verticality` (0–1), `extraLoops` (0–3), and the
 *  per-face door booleans + offsets (`doorNorth`/`doorNorthOffset`/… with `-1`
 *  or an absent offset meaning auto-centre — the hall/maze convention).
 *
 *  @param params - The cave generator's params (partial; missing keys default).
 *  @param seed - The generator seed (hashed via the integer RNG lineage).
 *  @param extent - Region size in metres `[x, y, z]`.
 *  @returns The chambers, passages, and mouths — all region-local metres. */
export function buildCaveSkeleton(
  params: Record<string, unknown>,
  seed: number,
  extent: [number, number, number],
): CaveSkeleton {
  const p = readCaveParams(params);
  const chambers = buildChambers(p, seed, extent);
  const tree = spanningTree(chambers);
  const loops = extraLoopEdges(chambers, tree, p.extraLoops);
  const { mouths, nearest } = buildMouths(p, extent, chambers);
  // Passage jitter consumes ONE shared integer stream in a fixed order: tree
  // edges, then loop edges, then mouth passages.
  const rng = makeIntRng(fnv1a(String(seed)));
  const passages: CavePassage[] = [];
  for (const [a, b] of [...tree, ...loops]) {
    passages.push(
      buildPassage(
        a,
        b,
        floorPoint(at(chambers, a)),
        floorPoint(at(chambers, b)),
        extent,
        rng,
      ),
    );
  }
  for (let m = 0; m < mouths.length; m++) {
    const ci = at(nearest, m);
    if (ci < 0) continue; // no chambers → no mouth passage
    passages.push(
      buildPassage(
        ci,
        -1,
        floorPoint(at(chambers, ci)),
        at(mouths, m).at,
        extent,
        rng,
      ),
    );
  }
  return { chambers, passages, mouths };
}

// ─────────────────────────────────────────────────────────────────────────────
// CARVE (Task 3): compile the skeleton into ABSOLUTE patch ops. Pr-2 discipline
// governs everything below — this runs in the browser AND is the replay
// contract, so the ONLY float math is `+ - * /`, sqrt, abs/min/max/floor/round,
// and Math.imul. The donor `packages/dungeon/src/field.ts` is PORTED (not
// imported — core cannot depend on the dungeon): its `smax` polynomial is
// mined verbatim; its float-SEEDED 256-entry noise perm table (field.ts:74) is
// REWRITTEN to an integer-hash-direct value lookup (no table, no transcendental).
// ─────────────────────────────────────────────────────────────────────────────

/** The store cell size the patch cells are indexed at. A {@link PatchOp} lives
 *  in SAMPLE coordinates (`world = sample · cellSize`), so it bakes a cell size
 *  — the field is 0.25 m everywhere (createFieldStore's default, the proven
 *  collision resolution), and {@link RISER} == this is what lands every
 *  quantized floor exactly on a sample plane. */
const CARVE_CELL = DEFAULT_CELL_SIZE;

// ─── carve tuning (metres) ───
/** Half-width of a passage cross-section — a 2.0 m walkway (the door-width
 *  standard the hall/maze also carry). */
const PASSAGE_HALF_WIDTH = 1.0;
/** Passage ceiling height above its floor — 3.0 m of headroom (the door-height
 *  standard), so the floorY+0.5..+2.5 m walk band always clears. */
const PASSAGE_HEIGHT = 3.0;
/** Organic (round) passage tube radius; its flat floor is clamped separately. */
const PASSAGE_ROUND_R = 1.5;
/** Smooth-union blend thickness for a chamber's blobs (>= cell size, or the
 *  fillet degrades to a hard max — the donor `smoothUnion` contract). */
const CHAMBER_SMOOTH_K = 1.0;
/** Height above a floor within which wall/ceiling noise is fully SUPPRESSED —
 *  the protected floor band (the research "structure-then-paint, protected
 *  floor" shape). Noise ramps in over {@link NOISE_FADE} above this. */
const FLOOR_BAND = 1.0;
/** Ramp distance (m) over which noise fades from 0 (at the band top) to full. */
const NOISE_FADE = 0.5;
/** Peak organic chamber wall/ceiling displacement (m) at `roughness = 1`.
 *  Exported (with {@link PASSAGE_NOISE_AMP}) so the test suite pins the
 *  {@link INFLUENCE_MARGIN} derivation against a future amp bump. */
export const CHAMBER_NOISE_AMP = 0.6;
/** Peak organic passage displacement (m) at `roughness = 1`. */
export const PASSAGE_NOISE_AMP = 0.3;
/** Value-noise spatial frequency (cycles per metre). */
const NOISE_FREQ = 0.6;
/** How far (m) a feature's influence reaches before its density saturates to
 *  {@link SOLID}, DERIVED so it can never fall behind the constants it guards:
 *  the SOLID-saturation distance (`-SOLID / DENSITY_SCALE` m of signed distance)
 *  + the peak noise displacement a wall/ceiling can reach outward + one cell of
 *  discretization slack. A chunk no feature's influence box reaches is ALL solid
 *  — the fast path skips its per-cell SDF and writes {@link SOLID} directly, which
 *  is byte-exact ONLY while every cell outside the box truly saturates. Raising a
 *  noise amp past this margin would otherwise silently clip displaced walls to
 *  rock at chunk seams; deriving it keeps the invariant true by construction (and
 *  `field-cave.test.ts` pins it). */
export const INFLUENCE_MARGIN =
  -SOLID / DENSITY_SCALE +
  Math.max(CHAMBER_NOISE_AMP, PASSAGE_NOISE_AMP) +
  CARVE_CELL;

/** Smoothstep, clamped to [0,1] — the Hermite `3t²−2t³`. Pure polynomial (Pr-2
 *  safe); reused for the noise floor-taper and the value-noise interpolation. */
const smoothstep01 = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/** Quilez smooth-max (air-positive smooth-union): mined VERBATIM from the donor
 *  `smax` (`packages/dungeon/src/field.ts`). `k > 0` always here
 *  ({@link CHAMBER_SMOOTH_K}), so the `/(4k)` never divides by zero. */
const smax = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0);
  return Math.max(a, b) + (h * h) / (4 * k);
};

// ─── integer-hash value noise (Pr-2 rewrite of the donor's float-seeded table) ─
/** Avalanche multiplier for the lattice hash mixer. */
const NOISE_MIX = 0x2545f491;

/** A deterministic value in [-1, 1] at integer lattice point (xi,yi,zi), folded
 *  with `seed`. INTEGER-ONLY until the final normalize: the donor's lattice hash
 *  `(xi·73856093) ^ (yi·19349663) ^ (zi·83492791)` (field.ts:74) is kept, but
 *  `Math.imul` replaces the float `*` (exact int32, no precision loss for large
 *  coords), and the float-seeded 256-entry perm table is REPLACED by hashing
 *  straight to the value — no table, no `rng.float()`, so it is byte-identical
 *  across engines (Pr-2). */
const latticeValue = (
  xi: number,
  yi: number,
  zi: number,
  seed: number,
): number => {
  let h =
    (Math.imul(xi, 73856093) ^
      Math.imul(yi, 19349663) ^
      Math.imul(zi, 83492791) ^
      (seed | 0)) |
    0;
  h = Math.imul(h ^ (h >>> 15), NOISE_MIX) | 0;
  h = (h ^ (h >>> 13)) | 0;
  return ((h >>> 9) / 0x7fffff) * 2 - 1; // 23-bit → [0,1] → [-1,1]
};

/** Trilinear value noise in [-1, 1] — the donor `makeValueNoise` shape with the
 *  integer-hash lookup above in place of the perm table. */
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = smoothstep01(x - xi);
  const ty = smoothstep01(y - yi);
  const tz = smoothstep01(z - zi);
  const c = (dx: number, dy: number, dz: number): number =>
    latticeValue(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), tx);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), tx);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), tx);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

// ─── themes ───
const CAVE_THEMES = ["mined", "organic", "mixed"] as const;
type CaveTheme = (typeof CAVE_THEMES)[number];
/** A feature's carve style: `mined` = crisp (square passages / no chamber
 *  noise); `organic` = round passages / displaced chamber walls. */
type CaveStyle = "mined" | "organic";

/** Per-feature styles a theme selects. `mixed` is the user's image: mined
 *  passages threading organic chambers. */
function stylesFor(theme: CaveTheme): {
  passage: CaveStyle;
  chamber: CaveStyle;
} {
  if (theme === "mined") return { passage: "mined", chamber: "mined" };
  if (theme === "organic") return { passage: "organic", chamber: "organic" };
  return { passage: "mined", chamber: "organic" };
}

// ─── per-feature air SDF (air-positive: > 0 = carved space) ───
/** Noise floor-taper: 0 within {@link FLOOR_BAND} of `floorY`, ramping to 1 over
 *  {@link NOISE_FADE} above it — so displacement never touches the walked floor. */
const floorTaper = (y: number, floorY: number): number =>
  smoothstep01((y - floorY - FLOOR_BAND) / NOISE_FADE);

/** Chamber air SDF: smooth-union of its blob spheres, optional wall/ceiling
 *  noise ABOVE the floor band, then a flat protected floor clamp at the
 *  chamber's quantized floor plane. */
function chamberAir(
  px: number,
  py: number,
  pz: number,
  c: CaveChamber,
  style: CaveStyle,
  roughness: number,
  seed: number,
): number {
  let a = Number.NEGATIVE_INFINITY;
  for (const b of c.blobs) {
    const s =
      b.radius -
      dist3(
        [px, py, pz],
        [
          c.center[0] + b.offset[0],
          c.center[1] + b.offset[1],
          c.center[2] + b.offset[2],
        ],
      );
    a = smax(a, s, CHAMBER_SMOOTH_K);
  }
  const floorY = c.center[1] - c.radii[1];
  if (style === "organic" && roughness > 0)
    a +=
      CHAMBER_NOISE_AMP *
      roughness *
      floorTaper(py, floorY) *
      valueNoise(px * NOISE_FREQ, py * NOISE_FREQ, pz * NOISE_FREQ, seed);
  return Math.min(a, py - floorY); // flat protected floor at floorY
}

/** Passage air SDF: sweep a flat-floored profile along the polyline. Mined =
 *  square cross-section (Chebyshev-style box of walls/floor/ceiling); organic =
 *  round tube with a flat floor and light tapered noise. The floor CLAMPS at the
 *  stepped, quantized local floor (cells below it stay solid — the tread is flat
 *  by construction). */
function passageAir(
  px: number,
  py: number,
  pz: number,
  p: CavePassage,
  style: CaveStyle,
  roughness: number,
  seed: number,
): number {
  let best = Number.NEGATIVE_INFINITY;
  const wps = p.waypoints;
  for (let i = 0; i + 1 < wps.length; i++) {
    const A = at(wps, i);
    const B = at(wps, i + 1);
    const dx = B[0] - A[0];
    const dz = B[2] - A[2];
    const len2 = dx * dx + dz * dz;
    const t =
      len2 > 1e-9
        ? clamp(((px - A[0]) * dx + (pz - A[2]) * dz) / len2, 0, 1)
        : 0;
    const hd = horizDist([px, pz], [A[0] + t * dx, A[2] + t * dz]);
    const floorY = quantize(lerp(A[1], B[1], t)); // stepped 0.25 m tread
    const dFloor = py - floorY;
    let air: number;
    if (style === "mined") {
      air = Math.min(PASSAGE_HALF_WIDTH - hd, dFloor, PASSAGE_HEIGHT - dFloor);
    } else {
      const vy = py - (floorY + PASSAGE_ROUND_R);
      air = Math.min(PASSAGE_ROUND_R - Math.sqrt(hd * hd + vy * vy), dFloor);
      if (roughness > 0) {
        air +=
          PASSAGE_NOISE_AMP *
          roughness *
          floorTaper(py, floorY) *
          valueNoise(px * NOISE_FREQ, py * NOISE_FREQ, pz * NOISE_FREQ, seed);
        air = Math.min(air, dFloor); // re-protect the floor after displacement
      }
    }
    best = Math.max(best, air);
  }
  return best;
}

/** The region-local air SDF at a point: the hard union (max) of every RELEVANT
 *  chamber and passage. Flat floors survive a plain max (each feature protects
 *  its own floor); smooth-union lives INSIDE a chamber's blobs only. */
function caveSdf(
  px: number,
  py: number,
  pz: number,
  chambers: CaveChamber[],
  passages: CavePassage[],
  styles: { passage: CaveStyle; chamber: CaveStyle },
  roughness: number,
  seed: number,
): number {
  let sdf = Number.NEGATIVE_INFINITY;
  for (const c of chambers)
    sdf = Math.max(
      sdf,
      chamberAir(px, py, pz, c, styles.chamber, roughness, seed),
    );
  for (const p of passages)
    sdf = Math.max(
      sdf,
      passageAir(px, py, pz, p, styles.passage, roughness, seed),
    );
  return sdf;
}

// ─── emission (walk region cells → ascending-bit-order patch chunks) ───
type Box = { lo: [number, number, number]; hi: [number, number, number] };

const boxesOverlap = (a: Box, b: Box): boolean =>
  a.lo[0] <= b.hi[0] &&
  a.hi[0] >= b.lo[0] &&
  a.lo[1] <= b.hi[1] &&
  a.hi[1] >= b.lo[1] &&
  a.lo[2] <= b.hi[2] &&
  a.hi[2] >= b.lo[2];

/** A chamber's influence AABB (local coords): all blobs stay within ±radii by
 *  construction, expanded by the saturation margin. */
const chamberBox = (c: CaveChamber): Box => ({
  lo: [
    c.center[0] - c.radii[0] - INFLUENCE_MARGIN,
    c.center[1] - c.radii[1] - INFLUENCE_MARGIN,
    c.center[2] - c.radii[2] - INFLUENCE_MARGIN,
  ],
  hi: [
    c.center[0] + c.radii[0] + INFLUENCE_MARGIN,
    c.center[1] + c.radii[1] + INFLUENCE_MARGIN,
    c.center[2] + c.radii[2] + INFLUENCE_MARGIN,
  ],
});

/** A passage's influence AABB: its waypoint bbox, expanded by the profile reach
 *  horizontally, the ceiling height up, and the saturation margin all round. */
function passageBox(p: CavePassage): Box {
  const lo: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const hi: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const w of p.waypoints)
    for (const ax of [0, 1, 2] as const) {
      lo[ax] = Math.min(lo[ax], w[ax]);
      hi[ax] = Math.max(hi[ax], w[ax]);
    }
  const reach =
    Math.max(PASSAGE_HALF_WIDTH, PASSAGE_ROUND_R) + INFLUENCE_MARGIN;
  return {
    lo: [lo[0] - reach, lo[1] - INFLUENCE_MARGIN, lo[2] - reach],
    hi: [
      hi[0] + reach,
      hi[1] + PASSAGE_HEIGHT + INFLUENCE_MARGIN,
      hi[2] + reach,
    ],
  };
}

type SampleBounds = {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
};

/** One chunk's slice, or null when it masks nothing (its cells all fall outside
 *  the region, or under keep-existing-air none are carved). Cells are visited in
 *  ascending bit order (`lx + 16·ly + 256·lz`) so `density` matches the
 *  `applyPatchOp` contract without a later sort. */
function emitChunk(
  ccx: number,
  ccy: number,
  ccz: number,
  sb: SampleBounds,
  min: [number, number, number],
  chambers: CaveChamber[],
  passages: CavePassage[],
  styles: { passage: CaveStyle; chamber: CaveStyle },
  roughness: number,
  seed: number,
  policy: MergePolicy,
): PatchChunk | null {
  const allSolid = chambers.length === 0 && passages.length === 0;
  // No feature reaches this chunk: every cell is deep rock. keep-existing-air
  // masks only carved cells, so it writes nothing here; replace overwrites the
  // region cells with SOLID (the point of "replace" — clear pre-existing air).
  if (allSolid && policy === "keep-existing-air") return null;
  const mask = new Uint8Array(PATCH_MASK_BYTES);
  const density: number[] = [];
  const bx = ccx * CHUNK_DIM;
  const by = ccy * CHUNK_DIM;
  const bz = ccz * CHUNK_DIM;
  let bit = 0;
  for (let lz = 0; lz < CHUNK_DIM; lz++)
    for (let ly = 0; ly < CHUNK_DIM; ly++)
      for (let lx = 0; lx < CHUNK_DIM; lx++, bit++) {
        const sx = bx + lx;
        const sy = by + ly;
        const sz = bz + lz;
        if (
          sx < sb.x0 ||
          sx > sb.x1 ||
          sy < sb.y0 ||
          sy > sb.y1 ||
          sz < sb.z0 ||
          sz > sb.z1
        )
          continue; // outside the region
        let d: number;
        if (allSolid) {
          d = SOLID;
        } else {
          const sdf = caveSdf(
            sx * CARVE_CELL - min[0],
            sy * CARVE_CELL - min[1],
            sz * CARVE_CELL - min[2],
            chambers,
            passages,
            styles,
            roughness,
            seed,
          );
          if (policy === "keep-existing-air" && !(sdf > 0)) continue;
          d = clampInt8(sdf * DENSITY_SCALE);
        }
        const byteIdx = bit >> 3;
        mask[byteIdx] = (mask[byteIdx] ?? 0) | (1 << (bit & 7));
        density.push(d);
      }
  if (density.length === 0) return null;
  return {
    key: chunkKey(ccx, ccy, ccz),
    densityMask: mask,
    density: Int8Array.from(density),
    materialMask: null, // v1: rock default renders; a theme material param is a backlog item
    materials: null,
  };
}

/** Compile a skeleton into ONE patch op over the region. Per chunk, pre-filters
 *  the chambers/passages whose influence reaches it (deep-rock chunks take the
 *  constant-SOLID fast path), then walks the chunk's region cells. */
function emitCave(
  sk: CaveSkeleton,
  region: { min: [number, number, number]; max: [number, number, number] },
  seed: number,
  theme: CaveTheme,
  roughness: number,
  policy: MergePolicy,
): PatchOp {
  const { min } = region;
  const sb: SampleBounds = {
    x0: worldToVoxel(region.min[0], CARVE_CELL),
    y0: worldToVoxel(region.min[1], CARVE_CELL),
    z0: worldToVoxel(region.min[2], CARVE_CELL),
    x1: worldToVoxel(region.max[0], CARVE_CELL),
    y1: worldToVoxel(region.max[1], CARVE_CELL),
    z1: worldToVoxel(region.max[2], CARVE_CELL),
  };
  const styles = stylesFor(theme);
  const chamberBoxes = sk.chambers.map(chamberBox);
  const passageBoxes = sk.passages.map(passageBox);
  const chunks: PatchChunk[] = [];
  for (let ccz = voxelChunk(sb.z0); ccz <= voxelChunk(sb.z1); ccz++)
    for (let ccy = voxelChunk(sb.y0); ccy <= voxelChunk(sb.y1); ccy++)
      for (let ccx = voxelChunk(sb.x0); ccx <= voxelChunk(sb.x1); ccx++) {
        const cbox: Box = {
          lo: [
            ccx * CHUNK_DIM * CARVE_CELL - min[0],
            ccy * CHUNK_DIM * CARVE_CELL - min[1],
            ccz * CHUNK_DIM * CARVE_CELL - min[2],
          ],
          hi: [
            (ccx * CHUNK_DIM + CHUNK_DIM - 1) * CARVE_CELL - min[0],
            (ccy * CHUNK_DIM + CHUNK_DIM - 1) * CARVE_CELL - min[1],
            (ccz * CHUNK_DIM + CHUNK_DIM - 1) * CARVE_CELL - min[2],
          ],
        };
        const chambers = sk.chambers.filter((_, i) =>
          boxesOverlap(cbox, at(chamberBoxes, i)),
        );
        const passages = sk.passages.filter((_, i) =>
          boxesOverlap(cbox, at(passageBoxes, i)),
        );
        const slice = emitChunk(
          ccx,
          ccy,
          ccz,
          sb,
          min,
          chambers,
          passages,
          styles,
          roughness,
          seed,
          policy,
        );
        if (slice !== null) chunks.push(slice);
      }
  return { id: 0, kind: "patch", chunks };
}

// ─── the caveGenerator def (strict, setup-loud param validation) ───

/** Static supremum for a mouth's lateral offset (metres). The real per-region
 *  bound is the skeleton's internal clamp (`mouthXZ`), so this is a schema
 *  supremum like the hall/maze offset ranges — generous enough for the regions
 *  the editor's selection produces. */
const CAVE_OFFSET_RANGE = {
  type: "number",
  minimum: AUTO_CENTRE,
  maximum: 62,
  default: AUTO_CENTRE,
} as const;

/** The per-wall param spellings — the door-authoring convention the skeleton's
 *  `readCaveParams` already parses, restated here for the schema/validator. */
const CAVE_WALLS = [
  { enable: "doorNorth", offsetKey: "doorNorthOffset" },
  { enable: "doorSouth", offsetKey: "doorSouthOffset" },
  { enable: "doorEast", offsetKey: "doorEastOffset" },
  { enable: "doorWest", offsetKey: "doorWestOffset" },
] as const;

const CAVE_PROPERTIES = {
  theme: { enum: CAVE_THEMES, default: "mixed" },
  chambers: { type: "number", minimum: 2, maximum: 6, default: 3 },
  chamberRadius: { type: "number", minimum: 3, maximum: 8, default: 5 },
  verticality: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
  roughness: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
  extraLoops: { type: "number", minimum: 0, maximum: 3, default: 1 },
  doorNorth: { type: "boolean", default: true },
  doorSouth: { type: "boolean", default: false },
  doorEast: { type: "boolean", default: false },
  doorWest: { type: "boolean", default: false },
  doorNorthOffset: CAVE_OFFSET_RANGE,
  doorSouthOffset: CAVE_OFFSET_RANGE,
  doorEastOffset: CAVE_OFFSET_RANGE,
  doorWestOffset: CAVE_OFFSET_RANGE,
} as const;

/** The params that POSTDATE persisted data (optional on input) — the four door
 *  offsets. The cave has NO `rotation` param (mirrored from the hall/maze
 *  optional list, minus rotation): its skeleton is seeded isotropically in the
 *  region, with no lattice grid to quarter-turn (stated in the schema
 *  description so the absence reads as a decision). */
const CAVE_OPTIONAL_KEYS: readonly string[] = CAVE_WALLS.map(
  (w) => w.offsetKey,
);

const CAVE_SCHEMA = {
  type: "object",
  description:
    "An organic cave — floor-anchored chambers joined by winding passages with quantized, stepped floors. Seeded isotropically in the region: there is deliberately NO rotation param (unlike the hall/maze, the cave has no lattice grid to quarter-turn).",
  properties: CAVE_PROPERTIES,
  required: Object.keys(CAVE_PROPERTIES).filter(
    (k) => !CAVE_OPTIONAL_KEYS.includes(k),
  ),
} as const;

/** The schema's per-property defaults, DERIVED (never restated) — the
 *  HALL_DEFAULTS pattern. */
const CAVE_DEFAULTS: Record<string, unknown> = Object.fromEntries(
  Object.entries(CAVE_SCHEMA.properties).map(([k, p]) => [k, p.default]),
);

/** Setup-loud number param in `[minimum, maximum]` (admits fractional). */
function numParam(
  params: Record<string, unknown>,
  key: string,
  range: { minimum: number; maximum: number },
): number {
  const v = params[key];
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < range.minimum ||
    v > range.maximum
  )
    throw new Error(
      `cave: ${key} must be a number in [${range.minimum}, ${range.maximum}], got ${JSON.stringify(v)}`,
    );
  return v;
}

/** Setup-loud integer param in `[minimum, maximum]`. */
function intParam(
  params: Record<string, unknown>,
  key: string,
  range: { minimum: number; maximum: number },
): number {
  const v = params[key];
  if (
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    v < range.minimum ||
    v > range.maximum
  )
    throw new Error(
      `cave: ${key} must be an integer in [${range.minimum}, ${range.maximum}], got ${JSON.stringify(v)}`,
    );
  return v;
}

/** Setup-loud boolean param. */
function assertBoolParam(params: Record<string, unknown>, key: string): void {
  if (typeof params[key] !== "boolean")
    throw new Error(
      `cave: ${key} must be a boolean, got ${JSON.stringify(params[key])}`,
    );
}

/** Setup-loud door offset: absent (auto-centre) or an integer in range. Every
 *  wall's offset is validated, enabled or not — the hall/maze stance (a bad
 *  offset on a disabled door must not lurk in persisted params). */
function assertOffsetParam(params: Record<string, unknown>, key: string): void {
  const v = params[key];
  if (v === undefined) return;
  if (
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    v < CAVE_OFFSET_RANGE.minimum ||
    v > CAVE_OFFSET_RANGE.maximum
  )
    throw new Error(
      `cave: ${key} must be an integer in [${CAVE_OFFSET_RANGE.minimum}, ${CAVE_OFFSET_RANGE.maximum}] or absent, got ${JSON.stringify(v)}`,
    );
}

/** Narrows + range-validates the cave's carve params setup-loud (mirrors
 *  hall/maze). Returns the two the carver needs beyond the skeleton (`theme`,
 *  `roughness`); the skeleton params are validated here and re-read tolerantly
 *  by {@link buildCaveSkeleton}. */
function caveParams(params: Record<string, unknown>): {
  theme: CaveTheme;
  roughness: number;
} {
  const P = CAVE_SCHEMA.properties;
  const theme = params["theme"];
  if (!CAVE_THEMES.some((t) => t === theme))
    throw new Error(
      `cave: theme must be one of ${CAVE_THEMES.map((t) => `"${t}"`).join(" | ")}, got ${JSON.stringify(theme)}`,
    );
  intParam(params, "chambers", P.chambers);
  numParam(params, "chamberRadius", P.chamberRadius);
  numParam(params, "verticality", P.verticality);
  const roughness = numParam(params, "roughness", P.roughness);
  intParam(params, "extraLoops", P.extraLoops);
  for (const w of CAVE_WALLS) {
    assertBoolParam(params, w.enable);
    assertOffsetParam(params, w.offsetKey);
  }
  return { theme: theme as CaveTheme, roughness };
}

/** The cave generator: build the deterministic macro skeleton (chambers,
 *  connected passages, mouths), then STAMP it into ONE absolute patch op —
 *  smooth-union chamber blobs, swept flat-floored passage profiles, protected
 *  quantized floors, and (organic) integer-hash value-noise wall/ceiling
 *  displacement above a floor band. Three themes dial the passage/chamber
 *  styles: `mined` (crisp), `organic` (rough), `mixed` (mined passages threading
 *  organic chambers — the default). `contextFree`: the carve is pure in
 *  `(params, seed, region, policy)` and reads no field state.
 *
 *  Emission is Pr-2-exact: only `+ - * /`, sqrt, abs/min/max/floor/round and
 *  `Math.imul` — no transcendentals, no float-seeded tables — so the browser
 *  carve and the replay contract produce byte-identical patches. Under
 *  `replace` every region cell is written (air = the signed distance, elsewhere
 *  rock), overwriting pre-existing air; under `keep-existing-air` ONLY carved
 *  (air) cells enter the mask, so pre-existing air survives.
 *
 *  There is NO `rotation` param — the skeleton is seeded isotropically in the
 *  region (see the schema description).
 *
 *  @throws {@link Error} if any param is missing, mistyped, or out of its schema
 *    range (setup-loud, before any emission). */
export const caveGenerator: GeneratorDef = {
  id: "cave",
  name: "Cave",
  paramSchema: CAVE_SCHEMA,
  defaults: CAVE_DEFAULTS,
  contextFree: true, // seeded-but-pure; no field reads
  evaluate(params, seed, region, table, policy): GeneratorResult {
    void table; // the cave emits rock (materialMask null) — no kit class needed
    const { theme, roughness } = caveParams(params); // narrow + validate, setup-loud
    const extent: [number, number, number] = [
      region.max[0] - region.min[0],
      region.max[1] - region.min[1],
      region.max[2] - region.min[2],
    ];
    const sk = buildCaveSkeleton(params, seed, extent);
    const patch = emitCave(sk, region, seed, theme, roughness, policy);
    // A degenerate (sub-cell) region can carve nothing under keep-existing-air;
    // hand back an empty result so commitGenerator gives the clean "empty"
    // error rather than assertPatchValid's "op writes no chunks".
    return { ops: patch.chunks.length > 0 ? [patch] : [], placements: [] };
  },
};
