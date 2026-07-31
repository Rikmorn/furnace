// Ghost target-marker math for the field host — pure, GPU-free, extracted from
// field-host.ts so the formulas are unit-testable (the F2a carry-over): the
// sphere-brush preview ring segments, the anchor cross, the box-ghost corner
// layout, and the committed-generator footprint behind the entity-highlight
// box. The host wraps these in segmentsToBatch / boxEdges and draws
// occlude:false.
//
// It also owns the two AFFORDANCE decisions that say WHICH of them to draw and
// what the canvas cursor should be (F4.5b Task 9). They live beside the geometry
// rather than inside `renderScene` for the reason every other pure module here
// exists: a decision table inside the frame path can only be asserted through a
// live GPU context, and these two are exactly the kind that go quietly wrong.
//
// `ViewportGesture` is a TYPE-ONLY import from `field-host.ts` — erased at
// build, so it adds no runtime edge back to the host. Re-spelling the union
// locally is the alternative, and a second vocabulary for one armed slot is how
// the two would come to disagree.
import type { FieldOp, GeneratorEntity } from "@furnace/core/field";
import { CHUNK_DIM, opBounds, parseChunkKey } from "@furnace/core/field";
import type { ViewportGesture } from "./field-host.ts";

type Vec3T = [number, number, number];

/** The ghost target ring/box preview colour — hologram-blue (research
 *  convention), drawn occlude:false so it reads through solid geometry. */
export const GHOST_COLOR: [number, number, number, number] = [0.4, 0.8, 1, 1];
// Ghost sphere preview: two great-circle rings (XZ + XY), this many segments each.
const GHOST_RING_SEGMENTS = 16;

// One point on a ring: centre + radius·(cosθ·u + sinθ·v) for orthonormal plane
// axes u, v.
const ringPoint = (
  center: Vec3T,
  radius: number,
  u: Vec3T,
  v: Vec3T,
  theta: number,
): Vec3T => {
  const cs = Math.cos(theta);
  const sn = Math.sin(theta);
  return [
    center[0] + radius * (cs * u[0] + sn * v[0]),
    center[1] + radius * (cs * u[1] + sn * v[1]),
    center[2] + radius * (cs * u[2] + sn * v[2]),
  ];
};

/** The sphere-brush ghost as line segments: two great-circle rings (XZ then XY
 *  plane), GHOST_RING_SEGMENTS (16) segments each. The host feeds the result
 *  to segmentsToBatch (same path as the grid / AABB highlight). */
export const sphereGhostSegments = (
  center: Vec3T,
  radius: number,
): [Vec3T, Vec3T][] => {
  const planes: [Vec3T, Vec3T][] = [
    [
      [1, 0, 0],
      [0, 0, 1],
    ], // XZ ring
    [
      [1, 0, 0],
      [0, 1, 0],
    ], // XY ring
  ];
  const segments: [Vec3T, Vec3T][] = [];
  for (const [u, v] of planes)
    for (let i = 0; i < GHOST_RING_SEGMENTS; i++) {
      const a = (2 * Math.PI * i) / GHOST_RING_SEGMENTS;
      const b = (2 * Math.PI * (i + 1)) / GHOST_RING_SEGMENTS;
      segments.push([
        ringPoint(center, radius, u, v, a),
        ringPoint(center, radius, u, v, b),
      ]);
    }
  return segments;
};

// The segment brush's capsule ghost: one ring per endcap plus this many rails
// joining them (evenly spaced around the ring, so the sweep reads as a tube
// from any angle without a fill).
const CAPSULE_RAILS = 4;

/** Unit vector least aligned with `axis` — the seed for an arbitrary
 *  perpendicular. Picking the SMALLEST |component| axis keeps the cross product
 *  well away from zero (worst case |cross| = √(2/3) ≈ 0.82), so a capsule drawn
 *  along any world axis gets a stable basis. */
const leastAlignedAxis = (axis: Vec3T): Vec3T => {
  const [ax, ay, az] = [
    Math.abs(axis[0]),
    Math.abs(axis[1]),
    Math.abs(axis[2]),
  ];
  if (ax <= ay && ax <= az) return [1, 0, 0];
  return ay <= az ? [0, 1, 0] : [0, 0, 1];
};

const cross = (u: Vec3T, v: Vec3T): Vec3T => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];

const normalize = (v: Vec3T): Vec3T => {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
};

/** The SEGMENT brush's capsule ghost as line segments: a GHOST_RING_SEGMENTS
 *  ring around each endpoint in the plane PERPENDICULAR to the axis, plus
 *  {@link CAPSULE_RAILS} rails joining matching ring points — the swept-sphere
 *  outline of the op the second click will build. The endcaps are drawn as flat
 *  rings, not hemispheres: the op's caps are round, so the wireframe under-draws
 *  the volume by up to `radius` at each end (a deliberate cheap outline, the
 *  same license the two-ring sphere ghost takes).
 *
 *  A DEGENERATE segment (`a` within a float of `b`) has no perpendicular plane
 *  to build a basis in, and the op it previews is exactly a sphere — so it
 *  returns {@link sphereGhostSegments} at `a` rather than a NaN batch.
 *
 *  Pure — the host wraps the result in `segmentsToBatch`, like every other
 *  overlay. NOTE: nothing in this module or its tests establishes that the
 *  result is VISIBLE on screen; drawLines has silently dropped whole overlays
 *  before (`docs/learnings/2026-07-21-invisible-line-overlays.md`). */
export const segmentGhostSegments = (
  a: Vec3T,
  b: Vec3T,
  radius: number,
): [Vec3T, Vec3T][] => {
  const d: Vec3T = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  if (len < 1e-6) return sphereGhostSegments(a, radius);
  const axis: Vec3T = [d[0] / len, d[1] / len, d[2] / len];
  const u = normalize(cross(axis, leastAlignedAxis(axis)));
  const v = cross(axis, u); // unit by construction: axis ⟂ u, both unit
  const segments: [Vec3T, Vec3T][] = [];
  for (const center of [a, b])
    for (let i = 0; i < GHOST_RING_SEGMENTS; i++) {
      const t0 = (2 * Math.PI * i) / GHOST_RING_SEGMENTS;
      const t1 = (2 * Math.PI * (i + 1)) / GHOST_RING_SEGMENTS;
      segments.push([
        ringPoint(center, radius, u, v, t0),
        ringPoint(center, radius, u, v, t1),
      ]);
    }
  for (let i = 0; i < CAPSULE_RAILS; i++) {
    const t = (2 * Math.PI * i) / CAPSULE_RAILS;
    segments.push([
      ringPoint(a, radius, u, v, t),
      ringPoint(b, radius, u, v, t),
    ]);
  }
  return segments;
};

/** The three-axis anchor cross at `p`: one stroke per world axis in X, Y, Z order,
 *  each `2 × half` long and centred on the point.
 *
 *  Shared by the three things that mark a point rather than a volume — the pending
 *  box-select corner, the pending segment start, and the armed-but-unanchored cursor
 *  affordance below, which is a preview of the mark the next click will leave. Three
 *  call sites is what earned the extraction; two hand-rolled copies is how the cross
 *  would come to be a different size in the preview than in the thing it previews. */
export const crossSegments = (p: Vec3T, half: number): [Vec3T, Vec3T][] => {
  const [x, y, z] = p;
  return [
    [
      [x - half, y, z],
      [x + half, y, z],
    ],
    [
      [x, y - half, z],
      [x, y + half, z],
    ],
    [
      [x, y, z - half],
      [x, y, z + half],
    ],
  ];
};

/** What a two-click gesture draws at the cursor BEFORE its first click (f2b item 10 /
 *  D-F4.5-7's "armed-but-unanchored always shows a cursor affordance").
 *
 *  - `ring` — the segment brush alone. Its sweep is `digRadius` thick, so the brush
 *    ring IS the width of what the first click starts: the radius is a fact about the
 *    gesture, not a leftover from the brush.
 *  - `cross` — the box corner and the pending stamp's region corner. Neither has a
 *    radius, so a radius-sized ring there would advertise a brush width that decides
 *    nothing about what the click does. The cross is a preview of the ANCHOR MARK
 *    itself ({@link crossSegments}), which is the only thing that is true before the
 *    click lands.
 *  - `null` — everything else. An ANCHORED gesture has its own live preview (the amber
 *    region box, the capsule), `pointer` has the pick, the brush has its sphere ghost,
 *    and a one-click flood has no pending state to preview at all.
 *
 *  A pending stamp SHADOWS whatever gesture is armed underneath it (the host routes LMB
 *  to region-draw first), so it decides before `gesture` does. */
export type CursorAffordance = "ring" | "cross" | null;
export const cursorAffordance = (s: {
  gesture: ViewportGesture | null;
  pendingStamp: boolean;
  anchored: boolean;
}): CursorAffordance => {
  if (s.anchored) return null;
  if (s.pendingStamp) return "cross";
  if (s.gesture === "segment") return "ring";
  if (s.gesture === "box") return "cross";
  return null;
};

/** The canvas `cursor` for what the viewport is armed to do — D-F4.5-8's per-family
 *  cursor glyph, the third of its four arming channels (the rail's pressed state and
 *  the status keymap are two of the others).
 *
 *  A live entity move wins over every arm, because during one the pointer is doing
 *  exactly one thing: `grabbing` while a button holds it, `grab` for a `G` grab, where
 *  the ghost follows a cursor with no button held at all. Otherwise `pointer` — which
 *  selects and drags rather than marking a point — keeps the plain arrow, and every
 *  other arm is a crosshair, because every one of them commits AT a point. */
export type ViewportCursor = "default" | "crosshair" | "grab" | "grabbing";
export const viewportCursor = (s: {
  /** `drag` = a button is holding the move, `grab` = a free-hand `G` grab, `null` =
   *  no move in flight. */
  move: "drag" | "grab" | null;
  pendingStamp: boolean;
  gesture: ViewportGesture | null;
}): ViewportCursor => {
  if (s.move !== null) return s.move === "drag" ? "grabbing" : "grab";
  if (s.pendingStamp) return "crosshair";
  return s.gesture === "pointer" ? "default" : "crosshair";
};

/** The 8 world corners of a centre+halfExtents box in boxEdges' bit-layout order
 *  (bit0=x, bit1=y, bit2=z), as a length-24 Float32Array. */
export const boxCorners = (center: Vec3T, half: Vec3T): Float32Array => {
  const out = new Float32Array(24);
  for (let i = 0; i < 8; i++) {
    out[i * 3] = (i & 1) === 0 ? center[0] - half[0] : center[0] + half[0];
    out[i * 3 + 1] = (i & 2) === 0 ? center[1] - half[1] : center[1] + half[1];
    out[i * 3 + 2] = (i & 4) === 0 ? center[2] - half[2] : center[2] + half[2];
  }
  return out;
};

/** The stamped FOOTPRINT of a committed generator: the union AABB of everything
 *  its span PUT IN THE WORLD, read from the live log. The recorded `region` is
 *  the SELECTION the user drew — a stamp anchors at the region's snapped min
 *  corner with its size from params, so an oversized region can badly
 *  over-draw the actual content (the F3a gate finding: the highlight boxed
 *  mostly-empty space).
 *
 *  Brush ops contribute their declared bounds; patch ops contribute their
 *  chunks' extents; PLACEMENT ops contribute each record's `position ± scale/2`
 *  world AABB (core's own placement-bounds convention — it assumes a unit
 *  primitive and ignores the quat, which is right for an outline). A placement
 *  writes no field cells, so without it a pure reader like scatter would have no
 *  footprint at all. Null only when the span holds NOTHING that contributes
 *  bounds — the caller falls back to the region.
 *
 *  NOTE — a placement contributes its RECORD SCALE alone, while the prop layer
 *  DRAWS that record at the catalog primitive's extents × the same scale
 *  (`field-placements.proxyScale`). The two sizing conventions are deliberate
 *  and differently sourced: this one follows core, which has no catalog and must
 *  stay catalog-free (a highlight box must not change size because a project
 *  edited `entities.json`), while the drawn proxy has to match the collider the
 *  game derives. So a highlight box can read slightly tighter or looser than the
 *  props inside it; that is expected, not drift. */
export const generatorFootprint = (
  ops: readonly FieldOp[],
  entity: GeneratorEntity,
  cellSize: number,
): { min: Vec3T; max: Vec3T } | null => {
  let box: { min: Vec3T; max: Vec3T } | null = null;
  const grow = (lo: Vec3T, hi: Vec3T): void => {
    if (box === null) {
      box = { min: [...lo], max: [...hi] };
      return;
    }
    box.min[0] = Math.min(box.min[0], lo[0]);
    box.min[1] = Math.min(box.min[1], lo[1]);
    box.min[2] = Math.min(box.min[2], lo[2]);
    box.max[0] = Math.max(box.max[0], hi[0]);
    box.max[1] = Math.max(box.max[1], hi[1]);
    box.max[2] = Math.max(box.max[2], hi[2]);
  };
  const [spanFirst, spanLast] = entity.opSpan;
  for (const op of ops) {
    if (op.kind === "entity") continue;
    if (op.id < spanFirst || op.id > spanLast) continue;
    if (op.kind === "brush") {
      const b = opBounds(op);
      grow(b.min, b.max);
      continue;
    }
    if (op.kind === "placement") {
      // A placement writes no field cells, so it has no op bounds — its
      // footprint is its records' world AABBs. `position ± scale/2` is core's
      // own placement-bounds convention (`recordChunks` in reconfigure.ts): it
      // assumes a UNIT primitive and ignores the quat, which is exactly right
      // for a highlight box (a jump-to-here outline, not an exact cover). This
      // is the ONLY footprint a pure reader like scatter has — without it a
      // scatter entity falls back to its recorded selection region.
      for (const r of op.records)
        grow(
          [
            r.position[0] - Math.abs(r.scale[0]) / 2,
            r.position[1] - Math.abs(r.scale[1]) / 2,
            r.position[2] - Math.abs(r.scale[2]) / 2,
          ],
          [
            r.position[0] + Math.abs(r.scale[0]) / 2,
            r.position[1] + Math.abs(r.scale[1]) / 2,
            r.position[2] + Math.abs(r.scale[2]) / 2,
          ],
        );
      continue;
    }
    for (const chunk of op.chunks) {
      const [cx, cy, cz] = parseChunkKey(chunk.key);
      const extent = CHUNK_DIM * cellSize;
      grow(
        [cx * extent, cy * extent, cz * extent],
        [(cx + 1) * extent, (cy + 1) * extent, (cz + 1) * extent],
      );
    }
  }
  return box;
};
