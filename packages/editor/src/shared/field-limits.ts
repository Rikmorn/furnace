// The host's user-facing LIMITS: numbers the host ENFORCES and the chrome has to STATE.
//
// They sit in `src/shared/` for one reason. The chrome cannot value-import anything under
// `field-host/` — a value edge there drags the engine barrel into the main bundle, which
// `tests/frontend-no-engine-leakage.test.ts` machine-enforces — so before this module every
// one of them was a number written twice: once where it is enforced, once where it is said,
// agreeing by review. Three sites carried a restatement in prose (the rail's Segment hint
// "max 60 m", the strip's flood note "budget 200k", the box gesture's "snaps to 0.5 m") and
// each declared itself a restatement in a comment, which is the honest version of a fact
// with no single home rather than a fix.
//
// `LATTICE` is the fourth number of that set and is deliberately NOT here: it is an INPUT to
// `field-brush.ts`'s own snap arithmetic, so the module that computes with it owns it, and a
// limits module re-exporting it would be a second name for one constant — the exact defect
// this file exists to remove.
//
// THE BAR FOR ADDING ONE: it must be both enforced by the host AND stated to a user. A
// host-private clamp with no affordance belongs beside its enforcement, where a reader
// looking at the check can see the number; moving it here would buy nothing and cost the
// locality. `src/shared/` is React-free and engine-free (both halves machine-enforced), and
// plain numbers are the easiest possible tenant of that rule.
//
// `DIG_RANGE_M` is the one member that does NOT meet that bar on its own — no surface states
// it — and it is here as the INPUT `MAX_SEGMENT_M` is twice by construction. Splitting the
// two would leave the derived limit spelled `60`, which is the geometry lost to a round
// number. That is the same rule `LATTICE` obeys from the other side: the derivation and its
// input live together, and which module they live in is decided by which one has to be
// reachable from the chrome.
//
// THE BRUSH CLAMPS ARRIVED IN T3b2 Task 5 and are the same class read at a second surface.
// `RADIUS_MIN`/`RADIUS_MAX`/`HOLLOW_MIN_M` were the strip's own literals, under a comment
// saying they mirrored the host "by review" — the same honest-restatement shape the three
// above carried, found in the file that task had to open anyway. Each is enforced by the
// host (`clampRadius`, and the `hollow` floor `clampTool` applies) and each is STATED to a
// user as a native control's own bound, which is the strongest form of stating one: the
// range input cannot be dragged past `RADIUS_MAX`, so a drifted copy would not merely
// misdescribe the clamp, it would make the control refuse a value the host accepts.

/** How far a dig reaches from the eye, in metres.
 *
 *  The host's own reach budget: {@link MAX_SEGMENT_M} is twice it by construction, and the
 *  `pointer` pick reaches exactly this far ("you can select what you could dig" is one rule
 *  to hold in the head, and the same range bounds the pick's occlusion probe so nothing can
 *  be picked through terrain the probe never tested). */
export const DIG_RANGE_M = 30;

/** The longest capsule the segment gesture will sweep (D-F4-16), in metres.
 *
 *  A segment's cost is linear in its length — every chunk on the line is dirtied, remeshed
 *  and re-analysed — and the two clicks are independent, so an orbit between them can pair
 *  points across the whole world by accident. The cap refuses that op and keeps the anchor
 *  armed, making the fix one nearer click.
 *
 *  Twice {@link DIG_RANGE_M} is not a round number, it is the geometry: each endpoint lands
 *  within `DIG_RANGE_M` of the eye that resolved it, so two clicks from ONE camera can never
 *  be more than 2·30 m apart. The cap therefore admits every segment a stationary user can
 *  draw and refuses only the ones that needed the camera to move between clicks — which is
 *  exactly the accident it is for.
 *
 *  CARRIED to the chrome at runtime as `SegmentHud.capM` (D-25) as well as read from here:
 *  the status bar's readout counts a LIVE measurement against the cap the host applied to
 *  that measurement, so it takes the number that rode with it rather than this one. The
 *  static affordance — the rail's Segment member hint, which describes the gesture before it
 *  starts and has no push to read — takes this one. */
export const MAX_SEGMENT_M = 2 * DIG_RANGE_M;

/** How many cells a click-gesture flood may select before it truncates.
 *
 *  Under core's `MAX_SELECTION_BUDGET` (262144) so a UI selection never rides the op-replay
 *  ceiling exactly; truncation at this cap surfaces via `SelectionInfo.truncated`. It bounds
 *  the two FLOOD gestures (`material`, `void`) only — a `box` span is snapped instead, and
 *  `truncated` is always false for regions. */
export const SELECTION_UI_BUDGET = 200_000;

/** The smallest brush/capsule radius the host will hold, in metres.
 *
 *  Enforced by `clampRadius` (`field-host.ts`) on every radius the chrome or the `[`/`]`
 *  keys push, and STATED as the `min` of the strip's radius range input — so the control
 *  cannot ask for a radius the clamp would move. */
export const RADIUS_MIN = 0.25;

/** The largest brush/capsule radius the host will hold, in metres. {@link RADIUS_MIN}'s
 *  other end, enforced by the same `clampRadius` and stated as the same input's `max`. */
export const RADIUS_MAX = 4;

/** The thinnest shell band a hollow fill may carve, in metres.
 *
 *  Core accepts any positive thickness (it cannot clamp against the cell size); the host
 *  applies this floor because a sub-cell shell on an organic shape comes out holey. Stated
 *  as the `min` of the strip's thickness field, which is also where the chrome re-applies it
 *  on blur — a settled sub-floor value would otherwise DISPLAY 0.2 while strokes carved 0.5.
 *
 *  Equal to `LATTICE` today and deliberately not spelled as it: the kit lattice is a
 *  snapping step and this is a thickness floor, and a shared spelling would make one move
 *  the other. */
export const HOLLOW_MIN_M = 0.5;
