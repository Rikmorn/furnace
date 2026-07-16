// Pure dig-feel math for the field host. No engine imports — plain arithmetic on
// plain tuples so it unit-tests without a GPU. The host owns the raycast + the
// eye-in-rock probe (they need the field + camera); this module only turns those
// inputs into a brush centre, and snaps a kit-fill box to the lattice.

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
