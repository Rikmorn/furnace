// Pure dig-feel + lattice math for the field host. No engine imports — plain
// arithmetic on plain tuples so it unit-tests without a GPU. The host owns the
// raycast + the eye-in-rock probe (they need the field + camera); this module
// turns those inputs into a brush centre, snaps a kit-fill box to the lattice,
// and owns the shared 0.5 m region snap (box-select spans, stamp regions), the
// lattice-step region nudge, and the region sample count.

/** How far a surface hit bites INTO the rock, as a fraction of the brush radius:
 *  the centre sits `BITE_FACTOR·radius` past the hit along the ray, so the sphere
 *  straddles the wall and removes material instead of grazing its face. */
export const BITE_FACTOR = 0.7;

/** Legacy virgin-world first-dig distance (metres): with no wall to hit and the
 *  eye in open air, the brush lands this far ahead of the eye. */
export const OPEN_SPACE_DIG_DISTANCE_M = 4;

/** Inputs to {@link computeBrushCenter}: the cursor ray, whether the eye sits
 *  inside rock, and the field raycast's hit point (`null` = miss or embedded). */
export type BrushTargetInput = {
  origin: [number, number, number];
  dir: [number, number, number]; // normalized
  eyeInRock: boolean;
  hit: [number, number, number] | null; // raycastField hit point (null = miss/embedded)
};

/**
 * Where the brush sphere/box centres for one cursor stroke (the dig-feel contract,
 * backlog `field-dig-tool-feel`). Three cases by depth along the ray:
 *
 * - **Embedded eye** (`eyeInRock`): mine `radius` deep straight ahead of the eye —
 *   carving forward, not stamping a sphere at some far plane.
 * - **Surface hit** (`hit` set): bite `BITE_FACTOR·radius` PAST the hit along the
 *   ray so the sphere straddles the wall and actually removes rock.
 * - **Open-space miss** (no hit, eye in air): land at the legacy
 *   {@link OPEN_SPACE_DIG_DISTANCE_M} metres ahead of the eye.
 *
 * @param t - The cursor ray, eye-in-rock flag, and raycast hit point.
 * @param radius - The active brush radius in metres.
 * @returns The world-space brush centre `[x, y, z]`.
 */
export function computeBrushCenter(
  t: BrushTargetInput,
  radius: number,
): [number, number, number] {
  const d = brushDepth(t, radius);
  const base = t.eyeInRock || !t.hit ? t.origin : t.hit;
  return [
    base[0] + t.dir[0] * d,
    base[1] + t.dir[1] * d,
    base[2] + t.dir[2] * d,
  ];
}

/** Distance along the ray from `base` to the brush centre: `radius` when mining
 *  from an embedded eye, `BITE_FACTOR·radius` past a surface hit, else the legacy
 *  open-space dig distance. */
function brushDepth(t: BrushTargetInput, radius: number): number {
  if (t.eyeInRock) return radius;
  if (t.hit) return BITE_FACTOR * radius;
  return OPEN_SPACE_DIG_DISTANCE_M;
}

const LATTICE = 0.5;

/**
 * One axis span of two world coords, snapped OUTWARD to the 0.5 m built-kit
 * lattice — the shared region snap for box-select spans and stamp regions. A
 * degenerate span (both points on the same lattice plane — e.g. two clicks on
 * one flat wall) would select nothing under the min-inclusive/max-exclusive
 * region test, so it widens to one lattice step.
 *
 * @param a - One endpoint of the span in metres (either order).
 * @param b - The other endpoint in metres.
 * @returns `[lo, hi]` on the lattice with `hi > lo` guaranteed.
 */
export function snapSpan(a: number, b: number): [number, number] {
  const lo = Math.floor(Math.min(a, b) / LATTICE) * LATTICE;
  let hi = Math.ceil(Math.max(a, b) / LATTICE) * LATTICE;
  if (hi === lo) hi = lo + LATTICE;
  return [lo, hi];
}

/** A region AABB in world metres — the shape {@link snapSpan} builds and
 *  {@link nudgeRegion} moves (structurally the stamp session's `StampRegion`,
 *  spelled locally so this module keeps its zero imports). */
export type RegionBox = {
  min: [number, number, number];
  max: [number, number, number];
};

/**
 * Translate a region AABB by whole 0.5 m lattice steps — the stamp's nudge
 * (arrow keys / the inspector's buttons). BOTH corners move, so the region
 * keeps its size and stays on the lattice {@link snapSpan} put it on. Steps
 * are rounded to whole numbers to hold that invariant.
 *
 * What an off-lattice `min` would actually cost is CORRESPONDENCE, not
 * determinism: generators floor their own anchor (core's `snapDown`), and
 * preview and commit run the same evaluate, so an off-lattice region still
 * builds reproducibly — it just builds up to 0.5 m from where the region box
 * says it will, silently.
 *
 * Exactness: 0.5 is representable, so an already-snapped corner plus `n·0.5`
 * is exact for every magnitude a world reaches.
 *
 * @param region - The region to move, in metres (not mutated).
 * @param steps - Whole lattice steps per WORLD axis `[x, y, z]`; negative moves toward −axis.
 * @returns A new region translated by `steps · 0.5 m`.
 */
export function nudgeRegion(
  region: RegionBox,
  steps: [number, number, number],
): RegionBox {
  const d: [number, number, number] = [
    Math.round(steps[0]) * LATTICE,
    Math.round(steps[1]) * LATTICE,
    Math.round(steps[2]) * LATTICE,
  ];
  return {
    min: [region.min[0] + d[0], region.min[1] + d[1], region.min[2] + d[2]],
    max: [region.max[0] + d[0], region.max[1] + d[1], region.max[2] + d[2]],
  };
}

/**
 * Sample lattice points inside a region AABB — min-inclusive/max-exclusive per
 * axis, the exact set core's `selectionHas` region test admits (sample i sits
 * at world `i·cellSize`).
 *
 * @param min - The region's min corner in metres.
 * @param max - The region's max corner in metres (exclusive).
 * @param cellSize - The field's sample spacing in metres.
 * @returns The number of admitted sample points (0 for an empty/inverted span).
 */
export function regionSampleCount(
  min: [number, number, number],
  max: [number, number, number],
  cellSize: number,
): number {
  const axis = (lo: number, hi: number): number =>
    Math.max(0, Math.ceil(hi / cellSize) - Math.ceil(lo / cellSize));
  return axis(min[0], max[0]) * axis(min[1], max[1]) * axis(min[2], max[2]);
}

/**
 * A kit-fill box snapped to the 0.5 m built-kit lattice so the field's op
 * validator accepts it. The side is the brush diameter rounded to the lattice
 * (never below one cell), and the min corner is rounded onto the lattice so both
 * opposing faces land on grid lines.
 *
 * @param center - The un-snapped brush centre `[x, y, z]` in metres.
 * @param radius - The active brush radius in metres (box side ≈ `2·radius`).
 * @returns A box brush shape with lattice-aligned faces.
 */
export function snappedKitBox(
  center: [number, number, number],
  radius: number,
): {
  kind: "box";
  center: [number, number, number];
  halfExtents: [number, number, number];
} {
  const size = Math.max(LATTICE, Math.round((2 * radius) / LATTICE) * LATTICE);
  const half = size / 2;
  // Round the min-corner coord onto the lattice, then re-derive the centre so both
  // opposing faces land on grid lines. Literal indices avoid a variable-index read.
  const snap = (coord: number): number =>
    Math.round((coord - half) / LATTICE) * LATTICE + half;
  return {
    kind: "box",
    center: [snap(center[0]), snap(center[1]), snap(center[2])],
    halfExtents: [half, half, half],
  };
}
