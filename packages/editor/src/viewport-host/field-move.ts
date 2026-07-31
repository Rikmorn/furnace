// The entity move's pure arithmetic: what a cursor ray means under each mapping,
// and how that turns into whole lattice steps for the live session's region
// (D-9). No engine imports, no camera, no GPU — the `field-pick.ts` /
// `field-brush.ts` shape, and for the same reason: the anchored-not-incremental
// rule is the part a bug would make silently wrong, so it has to be assertable
// with synthetic points and exact step counts rather than only through a drag on
// a real context.
//
// MUTATION CONTRACT — none. Every transition here RETURNS a new {@link MoveDrag}
// and never writes to its argument, which is `field-stamp.ts`'s contract for the
// session this drag rides ("plain transitions on plain data"). The host holds
// exactly one `MoveDrag | null` and replaces it wholesale, so a caller that
// ignores a return value has changed nothing — which is the failure mode worth
// having, versus a half-applied in-place mutation.
//
// The host keeps only what needs the world: the two `cursorRay` calls, the
// session, and `nudgeStampRegion`.
import { LATTICE } from "../frontend/lib/field-brush.ts";
import { boxCentre } from "./box-edges.ts";
import {
  AXIS_DIR,
  type Axis,
  closestPointParamOnAxis,
  isViewParallel,
} from "./gizmo.ts";

type Vec3T = [number, number, number];

/** A world-space cursor ray, tuple-shaped (the host marshals `camera.screenToRay`
 *  into this). `dir` must be UNIT — {@link isViewParallel} reads a dot product as
 *  a cosine. */
export type MoveRay = { origin: Vec3T; dir: Vec3T };

/** What a live move maps the cursor onto: the horizontal `plane` through the
 *  footprint's floor (the free drag), or one world {@link Axis} — a gizmo handle,
 *  or ⇧'s vertical promotion of a free drag. */
export type MoveMapping = "plane" | Axis;

/**
 * A move in progress — the state that turns cursor motion into whole lattice
 * steps on the live session's region.
 *
 * The arithmetic is ANCHORED rather than incremental: every reading asks "where
 * is the cursor relative to where this mapping was last anchored, and how many
 * steps is that", then applies the DIFFERENCE against what has already gone to
 * the region. Accumulating per-event deltas instead would let rounding compound
 * over a drag, so a cursor returned to the press point would not return the
 * region to where it started.
 *
 * The entity is deliberately NOT here. The session (`StampSession.entityId`) is
 * the authority on what is being moved, and a second copy is a second thing that
 * can be stale.
 */
export type MoveDrag = {
  mapping: MoveMapping;
  /** A GIZMO drag: the handle already named the axis, so ⇧ must not re-map it. */
  fixedAxis: boolean;
  /** World Y of the horizontal plane the free mapping intersects — the selected
   *  footprint's floor, fixed for the whole move. Fixed and not re-derived,
   *  because the footprint stays where the LOG has it until the drop: a plane
   *  that chased the ghost would feed back on itself. */
  planeY: number;
  /** Where the axis mappings measure from — the footprint's centre, i.e. the
   *  gizmo's own origin. */
  origin: Vec3T;
  /** Where the move was grabbed, in client pixels. The FIRST anchor is taken
   *  here rather than at the event that opens the move, so the region follows
   *  the cursor from the point the user actually grabbed and the travel that
   *  crossed the drag threshold is not silently lost. Null when there is no
   *  meaningful press pixel — a `G` grab with the pointer off-canvas, or after
   *  {@link unanchored} has retired a pixel the camera made stale. */
  press: { x: number; y: number } | null;
  /** The mapped world point at the last (re-)anchor; null until one is taken. */
  anchorPoint: Vec3T | null;
  /** {@link applied} as of that anchor — the base this mapping counts from, so a
   *  re-anchor keeps what came before and moves nothing by itself. */
  anchorSteps: Vec3T;
  /** Total lattice steps handed to the region since the move began. */
  applied: Vec3T;
  /** A pointer DRAG (a button is down, and a release drops it) rather than a
   *  `G` grab (free-hand; LMB or Enter drops it). */
  grabbed: boolean;
};

/** Opens a move over `box` (the selected entity's footprint). `axis` non-null =
 *  a gizmo drag, constrained for its whole life; null = the free ground drag ⇧
 *  can promote. Nothing is anchored yet — the first reading does that. */
export function startMove(opts: {
  box: { min: Vec3T; max: Vec3T };
  axis: Axis | null;
  grabbed: boolean;
  press: { x: number; y: number } | null;
}): MoveDrag {
  const { box } = opts;
  return {
    mapping: opts.axis ?? "plane",
    fixedAxis: opts.axis !== null,
    planeY: box.min[1],
    origin: boxCentre(box),
    press: opts.press,
    anchorPoint: null,
    anchorSteps: [0, 0, 0],
    applied: [0, 0, 0],
    grabbed: opts.grabbed,
  };
}

/** Which mapping this reading uses. ⇧ promotes a FREE move to the vertical axis
 *  — the arrow pad's own rule (`input-map.arrowNudgeSteps`), for the same reason:
 *  a ground-plane drag has no way to express height. A gizmo drag ignores it. */
export const resolveMapping = (d: MoveDrag, shiftKey: boolean): MoveMapping =>
  d.fixedAxis ? d.mapping : shiftKey ? "y" : "plane";

/**
 * The world point `ray` means under `mapping` — or null when this view cannot
 * answer: edge-on to the ground plane, behind it, or within ~8° of the axis,
 * where the parameter runs away or is undefined.
 *
 * Null means HOLD STILL at the call site. A move that lurched to a garbage
 * reading would be worse than one that ignored a frame.
 */
export function movePoint(
  d: MoveDrag,
  mapping: MoveMapping,
  ray: MoveRay,
): Vec3T | null {
  if (mapping === "plane") {
    const dy = ray.dir[1];
    // Below this the ray is effectively parallel to the plane — gizmo.ts's
    // PARALLEL_EPS discipline, applied to the horizontal one.
    if (Math.abs(dy) < 1e-6) return null;
    const t = (d.planeY - ray.origin[1]) / dy;
    if (t <= 0) return null; // the plane is at or behind the eye
    return [
      ray.origin[0] + t * ray.dir[0],
      d.planeY,
      ray.origin[2] + t * ray.dir[2],
    ];
  }
  const dir = AXIS_DIR[mapping];
  if (isViewParallel(dir, ray)) return null;
  const t = closestPointParamOnAxis(d.origin, dir, ray);
  return [
    d.origin[0] + t * dir[0],
    d.origin[1] + t * dir[1],
    d.origin[2] + t * dir[2],
  ];
}

/** Re-anchor onto `mapping` at world point `at`: that reading becomes this
 *  mapping's zero and the steps already applied become its base — so both the
 *  first reading of a move and a ⇧ pressed mid-drag move nothing by themselves. */
export const reanchored = (
  d: MoveDrag,
  mapping: MoveMapping,
  at: Vec3T,
): MoveDrag => ({
  ...d,
  mapping,
  anchorPoint: at,
  anchorSteps: [...d.applied],
});

/**
 * Retire the anchor AND the press pixel, so the next reading re-anchors.
 *
 * For a CAMERA change mid-move. `anchorPoint` is a world point captured under
 * the old view and `press` is a pixel that mapped to it; after the camera turns,
 * the same pixel means somewhere else and `point − anchor` jumps by metres the
 * user never dragged. Both go, or {@link advanceMove}'s caller would re-anchor
 * off the equally-stale press. Because {@link reanchored} carries `applied`
 * forward, re-anchoring costs nothing — the camera change moves the region by
 * exactly zero.
 */
export const unanchored = (d: MoveDrag): MoveDrag => ({
  ...d,
  anchorPoint: null,
  press: null,
});

/**
 * One reading's worth of move: the whole-lattice-step DELTA to hand the region,
 * and the drag as it stands afterwards.
 *
 * `step` is `[0, 0, 0]` whenever the cursor has not crossed into a new step,
 * which the caller uses to skip the region nudge entirely — a sub-step twitch
 * must not bump the session's run and re-fire a preview.
 *
 * Returns the drag UNCHANGED (`applied` untouched) in that case, so the two
 * halves cannot disagree about what has been applied.
 */
export function advanceMove(
  d: MoveDrag,
  point: Vec3T,
): { drag: MoveDrag; step: Vec3T } {
  const anchor = d.anchorPoint;
  if (anchor === null) return { drag: d, step: [0, 0, 0] };
  const wantOn = (i: 0 | 1 | 2): number =>
    d.anchorSteps[i] + Math.round((point[i] - anchor[i]) / LATTICE);
  const want: Vec3T = [wantOn(0), wantOn(1), wantOn(2)];
  const step: Vec3T = [
    want[0] - d.applied[0],
    want[1] - d.applied[1],
    want[2] - d.applied[2],
  ];
  if (step[0] === 0 && step[1] === 0 && step[2] === 0) return { drag: d, step };
  return { drag: { ...d, applied: want }, step };
}

/** Whether the move has handed the region NOTHING — a drag whose travel rounded
 *  to no lattice step, or a grab dropped where it started. The drop reads this
 *  to end the session without spending a history entry on a no-op. */
export const moveIsIdle = (d: MoveDrag): boolean =>
  d.applied[0] === 0 && d.applied[1] === 0 && d.applied[2] === 0;
