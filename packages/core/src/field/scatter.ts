// packages/core/src/field/scatter.ts — the scatter generator (F3b Task 5).
//
// The FIRST `contextFree: false` generator: it READS the carved field through
// `ctx.store` to project prop instances onto surfaces, and emits explicit
// PLACEMENT records (no field-cell writes) — `{ ops: [], placements }`. Its
// recorded span replays as data (the placement op), but its own reconfigure
// re-cooks against the restored pre-span field (see reconfigure.ts), and its
// influence is bounded by its REGION (evaluate reads only inside it).
//
// Determinism is the contract (Pr-2): evaluate runs in the browser AND is the
// replay contract, so the ONLY float math is `+ - * /`, Math.sqrt,
// abs/min/max/floor/ceil/round, and the integer RNG (./rng.ts). NO Math.hypot,
// sin/cos/pow/exp/log, Math.random, or float-seeded tables. The orientation
// quaternions are built from sqrt-only half-angle and shortest-arc formulae, and
// the blend is nlerp (normalized lerp) — NEVER slerp/trig.

import { getDensity, worldToVoxel } from "./chunks.ts";
import { boolParam, intParam, numParam } from "./generator-params.ts";
import { fnv1a, makeIntRng } from "./rng.ts";
import type {
  FieldStore,
  GeneratorDef,
  GeneratorResult,
  PlacementRecord,
} from "./types.ts";

type Vec3 = [number, number, number];
type Region = { min: [number, number, number]; max: [number, number, number] };
type Quat = [number, number, number, number];

// ─── search budget (Pr: search systems get a ceiling on day one) ───
/** Hard cap on candidate lattice sites per evaluate. Setup-loud when the region
 *  × density wants more — robustness lives in the ceiling, not in an unbounded
 *  scan. */
const MAX_CANDIDATES = 4096;
/** Bounded attempts for the unit-disk rejection that draws a random yaw
 *  direction (per-candidate independent stream — a miss cannot leak across
 *  candidates); falls back to +X (identity yaw) if every attempt lands outside
 *  the disk. Accept rate ≈ π/4, so exhaustion is ~10⁻⁶. */
const MAX_YAW_ATTEMPTS = 8;
/** Lattice jitter as a fraction of the grid pitch (in samples) — enough to break
 *  the visible grid without letting a candidate leave the region inset. */
const JITTER_FRAC = 0.4;
/** Prop base-offset off the surface along the normal (m) — keeps the instance
 *  from z-fighting the crossing without visibly floating. */
const NORMAL_OFFSET = 0.02;
/** Below this gradient magnitude the surface is treated as flat/absent and the
 *  candidate is discarded (no meaningful normal). */
const MIN_GRADIENT = 1e-6;
/** Below this the shortest-arc denominator (1 + n·+Y) is degenerate (n ≈ −Y):
 *  fall back to a 180° turn about +X, which maps +Y → −Y. */
const ANTIPARALLEL_EPS = 1e-6;

// ─── integer-RNG float helpers (Pr-2: only the allowed ops) ───
/** A uint32 stream mapped to [0, 1) via an exact power-of-two division. */
const rand01 = (rng: () => number): number => (rng() >>> 8) / 0x1000000;
/** An integer in [lo, hiExclusive) from one stream draw. */
const randInt = (rng: () => number, lo: number, hiExclusive: number): number =>
  lo + (rng() % (hiExclusive - lo));

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

// ─── params ───
const ORIENTATIONS = ["gravity", "normal", "blend"] as const;
type Orientation = (typeof ORIENTATIONS)[number];
const isOrientation = (v: unknown): v is Orientation =>
  ORIENTATIONS.some((o) => o === v);
const HEMISPHERES = ["floor", "wall", "ceiling"] as const;
type Hemisphere = (typeof HEMISPHERES)[number];
const isHemisphere = (v: unknown): v is Hemisphere =>
  HEMISPHERES.some((h) => h === v);

const DENSITY_RANGE = { minimum: 0.05, maximum: 2 } as const;
const SPACING_RANGE = { minimum: 0.25, maximum: 8 } as const;
const SCALE_RANGE = { minimum: 0.05, maximum: 8 } as const;
const BLEND_RANGE = { minimum: 0, maximum: 1 } as const;
const VARIANTS_RANGE = { minimum: 1, maximum: 8 } as const;

const SCATTER_PROPERTIES = {
  archetypeId: { type: "string", default: "rock" },
  density: { type: "number", minimum: 0.05, maximum: 2, default: 0.3 },
  minSpacing: { type: "number", minimum: 0.25, maximum: 8, default: 1.0 },
  scaleMin: { type: "number", minimum: 0.05, maximum: 8, default: 0.6 },
  scaleMax: { type: "number", minimum: 0.05, maximum: 8, default: 1.6 },
  randomYaw: { type: "boolean", default: true },
  orientation: { enum: ORIENTATIONS, default: "gravity" },
  blend: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
  hemisphere: { enum: HEMISPHERES, default: "floor" },
  variants: { type: "number", minimum: 1, maximum: 8, default: 3 },
} as const;

const SCATTER_SCHEMA = {
  type: "object",
  description:
    "Scatter prop instances onto carved surfaces (floor / wall / ceiling) — reads the field to project onto rock↔air crossings, emitting explicit placements (no field-cell writes). Deterministic: same params + seed + carved field reproduce the same records.",
  properties: SCATTER_PROPERTIES,
  // Every key has been present since scatter's first release, so all are
  // REQUIRED — the standing rule (only params that POSTDATE persisted entities
  // are optional). GeneratorDef.defaults carries them all explicitly.
  required: Object.keys(SCATTER_PROPERTIES),
} as const;

/** The schema's per-property defaults, DERIVED (never restated) — the
 *  HALL_DEFAULTS pattern. */
const SCATTER_DEFAULTS: Record<string, unknown> = Object.fromEntries(
  Object.entries(SCATTER_SCHEMA.properties).map(([k, p]) => [k, p.default]),
);

type ScatterParams = {
  archetypeId: string;
  density: number;
  minSpacing: number;
  scaleMin: number;
  scaleMax: number;
  randomYaw: boolean;
  orientation: Orientation;
  blend: number;
  hemisphere: Hemisphere;
  variants: number;
};

/** Narrows + range-validates scatter params (ranges from SCATTER_SCHEMA),
 *  throwing setup-loud on a missing, mistyped, or out-of-range field — the
 *  hall/maze/cave stance. `scaleMax >= scaleMin` is enforced too (a reversed
 *  pair is a caller error, not silently swapped). */
function scatterParams(params: Record<string, unknown>): ScatterParams {
  const archetypeId = params["archetypeId"];
  if (typeof archetypeId !== "string" || archetypeId.length === 0)
    throw new Error(
      `scatter: archetypeId must be a non-empty string, got ${JSON.stringify(archetypeId)}`,
    );
  const orientation = params["orientation"];
  if (!isOrientation(orientation))
    throw new Error(
      `scatter: orientation must be one of ${ORIENTATIONS.map((o) => `"${o}"`).join(" | ")}, got ${JSON.stringify(orientation)}`,
    );
  const hemisphere = params["hemisphere"];
  if (!isHemisphere(hemisphere))
    throw new Error(
      `scatter: hemisphere must be one of ${HEMISPHERES.map((h) => `"${h}"`).join(" | ")}, got ${JSON.stringify(hemisphere)}`,
    );
  const scaleMin = numParam("scatter", params, "scaleMin", SCALE_RANGE);
  const scaleMax = numParam("scatter", params, "scaleMax", SCALE_RANGE);
  if (scaleMax < scaleMin)
    throw new Error(
      `scatter: scaleMax (${scaleMax}) must be >= scaleMin (${scaleMin})`,
    );
  return {
    archetypeId,
    density: numParam("scatter", params, "density", DENSITY_RANGE),
    minSpacing: numParam("scatter", params, "minSpacing", SPACING_RANGE),
    scaleMin,
    scaleMax,
    randomYaw: boolParam("scatter", params, "randomYaw"),
    orientation,
    blend: numParam("scatter", params, "blend", BLEND_RANGE),
    hemisphere,
    variants: intParam("scatter", params, "variants", VARIANTS_RANGE),
  };
}

// ─── region → sample bounds ───
type SampleBounds = {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
};

const sampleBounds = (region: Region, cell: number): SampleBounds => ({
  x0: worldToVoxel(region.min[0], cell),
  y0: worldToVoxel(region.min[1], cell),
  z0: worldToVoxel(region.min[2], cell),
  x1: worldToVoxel(region.max[0], cell),
  y1: worldToVoxel(region.max[1], cell),
  z1: worldToVoxel(region.max[2], cell),
});

// ─── surface normal (central-difference density gradient) ───
/** Unit outward surface normal at an air sample: normalize(∇density). Density is
 *  air-positive, so ∇density points from rock INTO air — the direction a prop's
 *  local +Y should align to. `null` when the gradient is degenerate (no surface)
 *  or the ±1 stencil would read outside the region (kept in-region by contract).
 *  Six {@link getDensity} reads, `Math.sqrt` only. */
function surfaceNormal(
  store: FieldStore,
  x: number,
  y: number,
  z: number,
  sb: SampleBounds,
): Vec3 | null {
  if (
    x <= sb.x0 ||
    x >= sb.x1 ||
    y <= sb.y0 ||
    y >= sb.y1 ||
    z <= sb.z0 ||
    z >= sb.z1
  )
    return null;
  const gx = getDensity(store, x + 1, y, z) - getDensity(store, x - 1, y, z);
  const gy = getDensity(store, x, y + 1, z) - getDensity(store, x, y - 1, z);
  const gz = getDensity(store, x, y, z + 1) - getDensity(store, x, y, z - 1);
  const len = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (len < MIN_GRADIENT) return null;
  return [gx / len, gy / len, gz / len];
}

/** Sub-sample world coordinate of the zero-crossing between sample `s` (density
 *  `d0`) and `s + 1` (density `d1`), of opposite sign — the linear interpolant
 *  `s + d0/(d0 − d1)`, in metres. */
const crossingWorld = (
  s: number,
  d0: number,
  d1: number,
  cell: number,
): number => (s + d0 / (d0 - d1)) * cell;

// ─── vertical column scan (floor / ceiling) ───
/** The air-side sample of the target vertical crossing at column (x, z), or null
 *  if none. `floor` = the TOPMOST rising crossing (rock below → air above): the
 *  air sample is the crossing's upper cell. `ceiling` = the LOWEST falling
 *  crossing scanned upward (air below → rock above): the air sample is the lower
 *  cell. The scan is restricted so the returned air sample's normal stencil
 *  stays in-region. Returns `{ air, surfaceY }` in sample / world units. */
function columnSurface(
  store: FieldStore,
  x: number,
  z: number,
  sb: SampleBounds,
  cell: number,
  hemisphere: "floor" | "ceiling",
): { airY: number; surfaceY: number } | null {
  if (hemisphere === "floor") {
    // topmost rising crossing: scan from the top down; air sample = y + 1.
    for (let y = sb.y1 - 2; y >= sb.y0; y--) {
      const d0 = getDensity(store, x, y, z);
      const d1 = getDensity(store, x, y + 1, z);
      if (d0 < 0 && d1 > 0)
        return { airY: y + 1, surfaceY: crossingWorld(y, d0, d1, cell) };
    }
    return null;
  }
  // ceiling: lowest falling crossing scanned upward; air sample = y (below).
  for (let y = sb.y0 + 1; y <= sb.y1 - 1; y++) {
    const d0 = getDensity(store, x, y, z);
    const d1 = getDensity(store, x, y + 1, z);
    if (d0 > 0 && d1 < 0)
      return { airY: y, surfaceY: crossingWorld(y, d0, d1, cell) };
  }
  return null;
}

// ─── horizontal scan (wall) ───
const HORIZONTAL_DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** The nearest vertical wall face at air sample (x, y, z): scans the four
 *  cardinal horizontal directions up to `limit` samples for the closest air→rock
 *  crossing, returning its air sample and sub-sample world XZ. Null if the start
 *  is not air, or no crossing is within `limit`. The normal filter (|n.y| < 0.4)
 *  is applied by the caller. */
function wallSurface(
  store: FieldStore,
  x: number,
  y: number,
  z: number,
  limit: number,
  sb: SampleBounds,
  cell: number,
): { air: Vec3; wx: number; wz: number } | null {
  if (getDensity(store, x, y, z) <= 0) return null;
  let best: { air: Vec3; wx: number; wz: number; k: number } | null = null;
  for (const [dx, dz] of HORIZONTAL_DIRS) {
    let prevX = x;
    let prevZ = z;
    let prevD = getDensity(store, x, y, z);
    for (let k = 1; k <= limit; k++) {
      const cx = x + dx * k;
      const cz = z + dz * k;
      if (cx < sb.x0 || cx > sb.x1 || cz < sb.z0 || cz > sb.z1) break;
      const d = getDensity(store, cx, y, cz);
      if (d < 0) {
        if (best === null || k < best.k)
          best = {
            air: [prevX, y, prevZ],
            wx: dx === 0 ? prevX * cell : crossingWorld(prevX, prevD, d, cell),
            wz: dz === 0 ? prevZ * cell : crossingWorld(prevZ, prevD, d, cell),
            k,
          };
        break;
      }
      if (d === 0) break;
      prevX = cx;
      prevZ = cz;
      prevD = d;
    }
  }
  return best;
}

// ─── orientation quaternions (Pr-2: sqrt + the four ops only) ───
/** A random unit XZ direction (cosθ, sinθ) via bounded unit-disk rejection —
 *  no trig. Falls back to +X after {@link MAX_YAW_ATTEMPTS} misses. */
function randomDir(rng: () => number): [number, number] {
  for (let a = 0; a < MAX_YAW_ATTEMPTS; a++) {
    const x = rand01(rng) * 2 - 1;
    const y = rand01(rng) * 2 - 1;
    const r2 = x * x + y * y;
    if (r2 > MIN_GRADIENT && r2 <= 1) {
      const r = Math.sqrt(r2);
      return [x / r, y / r];
    }
  }
  return [1, 0];
}

/** Yaw quaternion about +Y from a unit direction (c, s) = (cosθ, sinθ), via the
 *  sqrt-only half-angle identities `cos(θ/2) = √((1+c)/2)`,
 *  `sin(θ/2) = sign(s)·√((1−c)/2)`. Unit by construction. */
function yawQuat(dir: [number, number]): Quat {
  const c = dir[0];
  const ch = Math.sqrt((1 + c) / 2);
  const shMag = Math.sqrt(Math.max(0, (1 - c) / 2));
  const sh = dir[1] >= 0 ? shMag : -shMag;
  return [0, sh, 0, ch];
}

/** Shortest-arc quaternion rotating +Y onto unit `n`: `[cross(+Y, n), 1 + n·+Y]`
 *  normalized. `n ≈ −Y` (denominator degenerate) falls back to a 180° turn about
 *  +X. sqrt + the four ops only. */
function alignYToNormal(n: Vec3): Quat {
  const w = 1 + n[1];
  if (w < ANTIPARALLEL_EPS) return [1, 0, 0, 0];
  return normalizeQuat([n[2], 0, -n[0], w]);
}

/** Hamilton product a∘b (rotate by b first, then a). */
function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function normalizeQuat(q: Quat): Quat {
  const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (len < MIN_GRADIENT) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Normalized lerp of two quaternions (nlerp — NEVER slerp/trig): sign-aligns
 *  `b` into `a`'s hemisphere (so the short way is taken), lerps, normalizes.
 *  sqrt + the four ops only. */
function nlerpQuat(a: Quat, b: Quat, t: number): Quat {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  return normalizeQuat([
    a[0] + (s * b[0] - a[0]) * t,
    a[1] + (s * b[1] - a[1]) * t,
    a[2] + (s * b[2] - a[2]) * t,
    a[3] + (s * b[3] - a[3]) * t,
  ]);
}

/** The record's orientation: `gravity` = yaw-only; `normal` = align +Y→n
 *  composed with yaw; `blend` = nlerp between the two by `blend`. */
function orientationQuat(p: ScatterParams, n: Vec3, yaw: Quat): Quat {
  if (p.orientation === "gravity") return yaw;
  const aligned = quatMul(alignYToNormal(n), yaw);
  if (p.orientation === "normal") return aligned;
  return nlerpQuat(yaw, aligned, p.blend);
}

// ─── the scatter core ───
/** Grid pitch in samples: `max(minSpacing, 1/√density)` metres, rounded UP to a
 *  whole sample so the effective pitch is never below the requested spacing. */
function latticePitch(p: ScatterParams, cell: number): number {
  const pitchM = Math.max(p.minSpacing, 1 / Math.sqrt(p.density));
  return Math.max(1, Math.ceil(pitchM / cell));
}

/** Lattice anchor samples along one axis: `[lo, hi]` inset, stepped by `pitch`.
 *  Empty when the inset span is empty (a sub-lattice region). */
function axisAnchors(lo: number, hi: number, pitch: number): number[] {
  const out: number[] = [];
  for (let s = lo; s <= hi; s += pitch) out.push(s);
  return out;
}

/** One accepted record's horizontal position, for the greedy spacing filter. */
type Accepted = { x: number; z: number };

/** True when `(x, z)` clears every accepted position by `minSpacing`
 *  (horizontal distance, `Math.sqrt` of the squared form — never hypot). */
function clearsSpacing(
  x: number,
  z: number,
  accepted: readonly Accepted[],
  minSpacing: number,
): boolean {
  for (const a of accepted) {
    const dx = x - a.x;
    const dz = z - a.z;
    if (Math.sqrt(dx * dx + dz * dz) < minSpacing) return false;
  }
  return true;
}

/** Builds one record at a resolved surface point + normal, consuming the
 *  candidate's per-site RNG for yaw, scale and variant in fixed order. */
function makeRecord(
  p: ScatterParams,
  rng: () => number,
  pos: Vec3,
  n: Vec3,
): PlacementRecord {
  const yaw = yawQuat(p.randomYaw ? randomDir(rng) : [1, 0]);
  const scale = p.scaleMin + rand01(rng) * (p.scaleMax - p.scaleMin);
  const variantIndex = rng() % p.variants;
  return {
    archetypeId: p.archetypeId,
    position: [
      pos[0] + n[0] * NORMAL_OFFSET,
      pos[1] + n[1] * NORMAL_OFFSET,
      pos[2] + n[2] * NORMAL_OFFSET,
    ],
    quat: orientationQuat(p, n, yaw),
    scale: [scale, scale, scale],
    variantIndex,
  };
}

/** Clamps a world position into the region AABB — a hard guarantee that no
 *  record lands outside the region (the tiny normal offset can only push
 *  sub-cell, so this never visibly moves a prop). */
const clampToRegion = (pos: Vec3, region: Region): Vec3 => [
  clampInt(pos[0], region.min[0], region.max[0]),
  clampInt(pos[1], region.min[1], region.max[1]),
  clampInt(pos[2], region.min[2], region.max[2]),
];

/** The hemisphere's normal filter: floor points up, ceiling down, wall sideways. */
function passesHemisphere(hemisphere: Hemisphere, n: Vec3): boolean {
  if (hemisphere === "floor") return n[1] > 0.6;
  if (hemisphere === "ceiling") return n[1] < -0.6;
  return Math.abs(n[1]) < 0.4;
}

/** Resolves one candidate anchor to a surface point + in-region normal, or null
 *  (no crossing, degenerate normal, or wrong hemisphere). `jx/jy/jz` are the
 *  per-site integer jitter offsets already applied to the read anchor. */
function resolveSurface(
  store: FieldStore,
  p: ScatterParams,
  anchor: Vec3,
  sb: SampleBounds,
  cell: number,
  pitch: number,
): { pos: Vec3; n: Vec3 } | null {
  if (p.hemisphere === "wall") {
    const hit = wallSurface(
      store,
      anchor[0],
      anchor[1],
      anchor[2],
      pitch,
      sb,
      cell,
    );
    if (hit === null) return null;
    const n = surfaceNormal(store, hit.air[0], hit.air[1], hit.air[2], sb);
    if (n === null || !passesHemisphere("wall", n)) return null;
    return { pos: [hit.wx, hit.air[1] * cell, hit.wz], n };
  }
  const col = columnSurface(
    store,
    anchor[0],
    anchor[2],
    sb,
    cell,
    p.hemisphere,
  );
  if (col === null) return null;
  const n = surfaceNormal(store, anchor[0], col.airY, anchor[2], sb);
  if (n === null || !passesHemisphere(p.hemisphere, n)) return null;
  return { pos: [anchor[0] * cell, col.surfaceY, anchor[2] * cell], n };
}

/** Enumerates the candidate anchor sites (deterministic lattice order) with
 *  per-site jitter, and their count for the budget check. Floor/ceiling walk an
 *  XZ lattice; wall walks an XYZ lattice (walls span the volume). Each site keys
 *  a PREFIX-STABLE per-site RNG stream (the cave's per-chamber keying), so adding
 *  a site never reshuffles another's draws and same-input-twice is exact. */
function candidateSites(
  p: ScatterParams,
  seed: number,
  sb: SampleBounds,
  pitch: number,
): { anchor: Vec3; rng: () => number }[] {
  const xs = axisAnchors(sb.x0 + 1, sb.x1 - 1, pitch);
  const zs = axisAnchors(sb.z0 + 1, sb.z1 - 1, pitch);
  const ys =
    p.hemisphere === "wall" ? axisAnchors(sb.y0 + 1, sb.y1 - 1, pitch) : [0];
  const sites: { anchor: Vec3; rng: () => number }[] = [];
  let index = 0;
  for (const az of zs)
    for (const ay of ys)
      for (const ax of xs) {
        const rng = makeIntRng(fnv1a(`${seed}:scatter:${index}`));
        index++;
        const halfJ = Math.max(1, Math.floor(pitch * JITTER_FRAC));
        const jx = randInt(rng, -halfJ, halfJ + 1);
        const jz = randInt(rng, -halfJ, halfJ + 1);
        const jy =
          p.hemisphere === "wall" ? randInt(rng, -halfJ, halfJ + 1) : 0;
        const rx = clampInt(ax + jx, sb.x0 + 1, sb.x1 - 1);
        const rz = clampInt(az + jz, sb.z0 + 1, sb.z1 - 1);
        const ry =
          p.hemisphere === "wall" ? clampInt(ay + jy, sb.y0 + 1, sb.y1 - 1) : 0;
        sites.push({ anchor: [rx, ry, rz], rng });
      }
  return sites;
}

/** The deterministic surface-projection scatter: enumerate candidate sites,
 *  resolve each to a surface point + normal, greedily accept in lattice order
 *  under the `minSpacing` filter, and build a placement record per accepted site.
 *
 *  @throws {@link Error} if the candidate lattice exceeds {@link MAX_CANDIDATES}
 *    (setup-loud — shrink the region or lower density). */
function scatter(
  store: FieldStore,
  p: ScatterParams,
  seed: number,
  region: Region,
  sb: SampleBounds,
  cell: number,
): PlacementRecord[] {
  const pitch = latticePitch(p, cell);
  const sites = candidateSites(p, seed, sb, pitch);
  if (sites.length > MAX_CANDIDATES)
    throw new Error(
      `scatter: candidate lattice is ${sites.length} sites (cap ${MAX_CANDIDATES}) — shrink the region or lower density`,
    );
  const placements: PlacementRecord[] = [];
  const accepted: Accepted[] = [];
  for (const site of sites) {
    const surface = resolveSurface(store, p, site.anchor, sb, cell, pitch);
    if (surface === null) continue;
    if (!clearsSpacing(surface.pos[0], surface.pos[2], accepted, p.minSpacing))
      continue;
    accepted.push({ x: surface.pos[0], z: surface.pos[2] });
    const record = makeRecord(p, site.rng, surface.pos, surface.n);
    record.position = clampToRegion(record.position, region);
    placements.push(record);
  }
  return placements;
}

/** The scatter generator: deterministic surface projection of prop instances
 *  onto carved surfaces (D-F3-8). The FIRST `contextFree: false` generator — it
 *  READS the field through `ctx.store` and emits `{ ops: [], placements }` (no
 *  field-cell writes), so its recorded span is a pure placement op that replays
 *  as data, while its own reconfigure re-cooks against the restored pre-span
 *  field.
 *
 *  A jittered candidate lattice (pitch `max(minSpacing, 1/√density)`) is
 *  projected onto the hemisphere's surface: `floor` (topmost rock→air crossing,
 *  normal up), `ceiling` (rock-above-air, normal down), or `wall` (horizontal
 *  crossing, normal sideways). Each accepted site gets a record whose `quat`
 *  bakes in the orientation (`gravity` yaw-only, `normal` aligned to the surface,
 *  `blend` an nlerp of the two — never slerp/trig), a uniform `scale` in
 *  `[scaleMin, scaleMax]`, and `variantIndex = rng % variants`. Greedy spacing
 *  keeps accepted props `>= minSpacing` apart.
 *
 *  Pr-2-exact: integer RNG, `Math.sqrt` and the four ops only — no
 *  transcendentals, so the browser evaluate and the replay contract agree.
 *
 *  @throws {@link Error} if any param is missing, mistyped, or out of its schema
 *    range (setup-loud); if `scaleMax < scaleMin`; or if the candidate lattice
 *    exceeds {@link MAX_CANDIDATES} (shrink the region or lower density). */
export const scatterGenerator: GeneratorDef = {
  id: "scatter",
  name: "Scatter",
  paramSchema: SCATTER_SCHEMA,
  defaults: SCATTER_DEFAULTS,
  contextFree: false, // reads the field to project onto surfaces
  evaluate(params, seed, region, table, policy, ctx): GeneratorResult {
    void table; // scatter writes no cells and needs no material catalog
    void policy; // scatter emits placements, not merge-policied field ops
    if (ctx === undefined)
      throw new Error(
        "scatter: evaluate requires an EvaluateContext (field access)",
      );
    const p = scatterParams(params); // narrow + range-validate, setup-loud
    const cell = ctx.store.cellSize;
    const sb = sampleBounds(region, cell);
    const placements = scatter(ctx.store, p, seed, region, sb, cell);
    return { ops: [], placements };
  },
};
