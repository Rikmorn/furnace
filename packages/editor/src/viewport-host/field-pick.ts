// CPU ray picking for the field host — pure, GPU-free (the field-ghost.ts /
// field-placements.ts sibling): two ray tests and the arbitration between them.
// The host builds the candidates (it owns the op log, the catalog and the flag
// store) and raycasts the field for the occluder; this module does the geometry
// and decides the winner.
//
// CPU, not a GPU id pass, and that is a measured choice rather than a fallback:
// the field host acquires its context at `sampleCount: 4`, `frame.renderToTexture`
// refuses any non-1 sample count, and the two things most worth picking — entity
// footprints and gizmo handles — have no meshes at all (they are `drawLines`
// batches and pure math).
//
// The whole per-click bill, not just this module's share of it: the ray tests
// here are ~32k scalar ops at this slice's scale (tens of entities, hundreds of
// props, hundreds of visible markers); the host's candidate BUILD around them
// walks the op log twice and derives the flag summary (which caches nothing);
// and one field DDA runs for the occluder — the same one the host already pays
// on every throttled pointermove. At the 100k-op scale the log walks dominate,
// not the arithmetic. All of it is per CLICK, which is what makes it affordable.
//
// Its consequence is written into the design and not just tolerated: a CPU pick
// is affordable per CLICK, not per pointermove, so there is no hover
// pre-highlight anywhere in the editor. Selection is click-driven.

type Vec3T = [number, number, number];

/** A world-space pick ray.
 *
 *  `dir` MUST be UNIT length: every `t` this module returns is then a distance
 *  in METRES, directly comparable with core's `raycastField` hit (which
 *  normalizes its own direction and measures the same way). The host's
 *  `cursorRay` satisfies this because `camera.screenToRay` returns a normalized
 *  direction. Feed it a scaled direction and every number here is in
 *  ray-lengths and agrees with nothing. */
export type PickRay = { origin: Vec3T; dir: Vec3T };

/** An axis-aligned pick volume in world metres. */
export type PickAabb = { min: Vec3T; max: Vec3T };

/** An ORIENTED pick volume: a box of `halfExtents` about `center`, rotated by a
 *  unit quaternion `[x, y, z, w]`.
 *
 *  This is the placement-record shape deliberately, not the 8 world corners the
 *  ghost wireframe draws (`field-placements.proxyCorners`): the corners cost a
 *  24-float allocation per record and would then have to be re-fitted to a box,
 *  while the record already carries the frame the test wants. */
export type PickObb = {
  center: Vec3T;
  halfExtents: Vec3T;
  quat: readonly [number, number, number, number];
};

/**
 * One thing a click could land on.
 *
 * A `prop` carries the entity that PLACED it, not an identity of its own: a
 * click on a prop selects its owning stamp, because a placement record is not
 * an independently editable object in this editor (per-prop selection is out).
 * The host resolves that ownership through `field-placements.placementOwners`,
 * which pairs each record with the entity whose op span claims it.
 */
export type PickCandidate =
  | { kind: "entity"; entityId: number; aabb: PickAabb }
  | { kind: "prop"; entityId: number; obb: PickObb }
  | { kind: "flag"; key: string; aabb: PickAabb };

/**
 * The slab test, in whatever frame the caller hands it: the ray's entry `t` into
 * the box, or null for a miss.
 *
 * `tmin` starts at 0, which is what gives the two boundary behaviours for free:
 * a box BEHIND the origin ends with `tmax < 0 <= tmin` and misses, and a box
 * CONTAINING the origin enters at 0. Both matter — the first keeps a click from
 * selecting what is behind the camera, the second is the editor's normal state
 * (the camera flies inside the space its entities carved).
 *
 * A zero direction component is handled as a degenerate slab that either rejects
 * outright (the origin is outside it) or imposes no bound — never a division
 * producing NaN, which would compare false against everything and silently drop
 * the candidate. Bounds are INCLUSIVE, so a ray grazing a face edge still hits:
 * a click on a prop's silhouette should not fall through it.
 */
const slabEntryT = (
  origin: Vec3T,
  dir: Vec3T,
  min: Vec3T,
  max: Vec3T,
): number | null => {
  let tmin = 0;
  let tmax = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis] as number;
    const d = dir[axis] as number;
    const lo = min[axis] as number;
    const hi = max[axis] as number;
    if (d === 0) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const ta = (lo - o) / d;
    const tb = (hi - o) / d;
    tmin = Math.max(tmin, Math.min(ta, tb));
    tmax = Math.min(tmax, Math.max(ta, tb));
    if (tmax < tmin) return null;
  }
  return tmin;
};

/** Rotate `(x, y, z)` by a unit quaternion `[x, y, z, w]` — the standard
 *  `v + 2·q_v × (q_v × v + w·v)` form. A twin of `field-placements.rotateByQuat`
 *  rather than a shared export: that one is private to the module that owns the
 *  proxy-corner layout, and this one is four lines of standard algebra whose
 *  wrong version fails every case below. */
const rotateByQuat = (
  q: readonly [number, number, number, number],
  x: number,
  y: number,
  z: number,
): Vec3T => {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx,
  ];
};

/** The ray's entry `t` into an axis-aligned box, or null for a miss. */
export const rayAabbT = (ray: PickRay, box: PickAabb): number | null =>
  slabEntryT(ray.origin, ray.dir, box.min, box.max);

/**
 * The ray's entry `t` into an ORIENTED box, or null for a miss.
 *
 * Done by moving the RAY into the box's local frame (rotate by the conjugate
 * quaternion about the centre) and running the same slab test there — a rigid
 * transform, so the `t` it returns is still the world-space distance and stays
 * comparable with every other candidate's.
 */
export const rayObbT = (ray: PickRay, obb: PickObb): number | null => {
  const [qx, qy, qz, qw] = obb.quat;
  const inverse: readonly [number, number, number, number] = [
    -qx,
    -qy,
    -qz,
    qw,
  ];
  const origin = rotateByQuat(
    inverse,
    ray.origin[0] - obb.center[0],
    ray.origin[1] - obb.center[1],
    ray.origin[2] - obb.center[2],
  );
  const dir = rotateByQuat(inverse, ray.dir[0], ray.dir[1], ray.dir[2]);
  const h = obb.halfExtents;
  return slabEntryT(origin, dir, [-h[0], -h[1], -h[2]], [h[0], h[1], h[2]]);
};

/** One candidate's entry distance, dispatched on its volume shape. */
const candidateT = (ray: PickRay, c: PickCandidate): number | null =>
  c.kind === "prop" ? rayObbT(ray, c.obb) : rayAabbT(ray, c.aabb);

/**
 * Whether a candidate is a bounding VOLUME rather than a real object — the
 * tier {@link pickNearest} resolves second.
 *
 * A positive predicate over an explicit kind list, deliberately, rather than
 * `kind !== "entity"` at the two call sites: a candidate kind added later (a
 * gizmo handle, say) would fall into the object tier by DEFAULT under negation,
 * silently, with nothing forcing its author to decide where it belongs. Written
 * this way the compiler leaves the new kind out of both tiers' positive list and
 * the choice has to be made here.
 */
const isVolume = (c: PickCandidate): boolean => c.kind === "entity";

/**
 * The nearest candidate the filter admits, within `maxT`.
 *
 * Ties go to the EARLIER candidate in the array (`t >= bestT` keeps the
 * incumbent), which makes the result deterministic for coincident volumes rather
 * than merely unspecified — the host builds candidates in log order, so the
 * older entity wins a tie. That is load-bearing for nested footprints, where two
 * enclosing boxes both enter at t = 0.
 *
 * `maxT` is INCLUSIVE: a candidate exactly at it is admitted (see
 * {@link pickNearest}).
 */
const nearestOf = (
  ray: PickRay,
  candidates: readonly PickCandidate[],
  maxT: number,
  admits: (c: PickCandidate) => boolean,
): PickCandidate | null => {
  let best: PickCandidate | null = null;
  let bestT = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (!admits(c)) continue;
    const t = candidateT(ray, c);
    if (t === null || t > maxT || t >= bestT) continue;
    best = c;
    bestT = t;
  }
  return best;
};

/**
 * What a click at this ray selects, or null for "nothing — deselect".
 *
 * `maxT` is how far the ray is KNOWN to be clear: the field raycast's hit
 * distance when it hit, and the probe's own range when it missed (nothing past
 * that range was tested, so nothing past it may be picked). Anything BEYOND it
 * is behind terrain — the user clicked rock, not the thing behind it.
 *
 * The bound is INCLUSIVE — a candidate at exactly `maxT` is still picked — and
 * that is the deliberate side of the boundary for two reasons. Occlusion means
 * strictly BEHIND: a candidate sitting exactly on the surface the ray hit is not
 * behind it, and a carve entity's footprint face lying on the rock face it
 * carved is the normal case, not a contrived one. And it matches the range
 * convention of the probe that produces the other `maxT`: `raycastField` bails
 * on `t > maxDist`, so its own reach is inclusive too, and a pick that stopped
 * half an epsilon short would disagree with the DDA it is paired with.
 *
 * OBJECTS BEFORE VOLUMES, which is a deviation from plain nearest-wins and the
 * reason is structural: an entity's candidate is its stamped FOOTPRINT — a
 * bounding volume, not its geometry — and the editor camera normally sits
 * INSIDE one (that is what carving a room and flying into it produces). Such a
 * footprint enters at t = 0 and would win every click in the room, making every
 * prop and marker inside it unpickable. So props and markers (real, specific
 * geometry) are resolved first and footprints are the fallback, which also
 * reads well as a rule: click a thing to get the thing, click the bare room to
 * get the room. Within each tier it IS plain nearest-wins.
 *
 * KNOWN GAP, recorded rather than papered over: the tier does not resolve
 * entity-vs-entity nesting. A scatter footprint inside a hall's also encloses
 * the camera, both enter at t = 0, and the tie falls to log order (see
 * {@link nearestOf}). Both answers are legitimate — both volumes really are
 * under the cursor — so picking a winner is a product decision, not a geometry
 * one, and it is left to the task that gives entities a manipulator.
 */
export const pickNearest = (
  ray: PickRay,
  candidates: readonly PickCandidate[],
  maxT: number,
): PickCandidate | null =>
  nearestOf(ray, candidates, maxT, (c) => !isVolume(c)) ??
  nearestOf(ray, candidates, maxT, isVolume);
