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

import { DEFAULT_CELL_SIZE } from "./chunks.ts";
import { fnv1a, makeIntRng } from "./rng.ts";

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

/** |Δfloor| at or below this makes a passage `level` (else `stepped` or
 *  `switchback`). */
const LEVEL_DY = MIN_TREAD;
/** One-cell inset (m) the carver must respect — the skeleton keeps every blob
 *  and waypoint this far inside the extent so the carve never writes outside. */
const BOUNDS_MARGIN = DEFAULT_CELL_SIZE;
/** Max lateral waypoint jitter (m) on straight passages (clamped to the
 *  in-bounds room per waypoint, so it never pushes a waypoint outside). */
const JITTER = 0.4;
/** A switchback leg's perp swing as a multiple of its forward advance. Being
 *  > 1 guarantees consecutive legs point > 90° apart (the required reversal). */
const SWITCHBACK_AMP_FACTOR = 1.25;
/** Target straight-passage segment length (m) — subdivides long passages so
 *  jitter reads as a winding tunnel, never below the grade-safe cap. */
const SEG_TARGET = 2.0;

// ─── param ranges + defaults (single-sourced here; Task 3's schema mirrors) ───
const CHAMBERS_RANGE = { min: 2, max: 6, def: 3 } as const;
const RADIUS_RANGE = { min: 3, max: 8, def: 5 } as const;
const UNIT_RANGE = { min: 0, max: 1 } as const;
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
 *  the carver just protects them. */
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
      0.5,
      UNIT_RANGE.min,
      UNIT_RANGE.max,
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
  // Radii fit the extent so a chamber never overhangs the in-bounds box.
  const maxRx = Math.max(0.5, extent[0] / 2 - BOUNDS_MARGIN);
  const maxRy = Math.max(0.5, extent[1] / 2 - BOUNDS_MARGIN);
  const maxRz = Math.max(0.5, extent[2] / 2 - BOUNDS_MARGIN);
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
  const kind: CavePassageKind = Math.abs(dy) <= LEVEL_DY ? "level" : "stepped";
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
  const legLen = Math.sqrt(fstep * fstep + amp * amp);
  const perLegCap = Math.max(1, Math.floor(legLen / MIN_TREAD));
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
  const needed = risers * MIN_TREAD; // total path run to fit the risers at MAX_GRADE
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
    const ampForRun = Math.sqrt(
      Math.max(0, (needed / legs) * (needed / legs) - fstep * fstep),
    );
    const ampWanted = Math.max(ampForRun, fstep * SWITCHBACK_AMP_FACTOR);
    const amp = Math.min(ampWanted, budget);
    if (amp <= fstep) continue; // no reversal possible at this leg count/budget
    const legLen = Math.sqrt(fstep * fstep + amp * amp);
    const fit = Math.min(risers, legs * Math.floor(legLen / MIN_TREAD));
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
 *  with floors quantized to {@link RISER} risers.
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
