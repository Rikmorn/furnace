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
// THE DAEMON IS A SECOND ENFORCER SINCE T4c, and the bar reads slightly differently for it —
// worth one clause, because two of the members below are now here for that reason rather than
// the chrome's. `daemon/op-schema.ts` reads `HOLLOW_MIN_M` and `daemon/session-handlers.ts`
// reads `MAX_PROBE_M`, both to state a bound in a zod schema that an MCP client is
// ADVERTISED. That is the same structural constraint the header opens with, from a third
// side: the daemon is Node-portable and may not touch anything that imports the engine, so a
// number it validates against and the host computes with can only be one constant if it lives
// here. `MAX_PROBE_M` is therefore enforced by the DAEMON and not by the host, which the
// original bar did not contemplate; the bar's point — no home-less numbers, and no
// host-private clamps taking up residence — is unchanged. The "user" a schema states a bound
// to is an agent reading `inputSchema`, and being told a ceiling beats discovering it.
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
// brush layer (`clampRadius`, and the `hollow` floor `clampTool` applies — both in
// `field-host/field-tool.ts`) and each is STATED to a
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

/** How far a `session.query` probe looks before it answers "nothing there", in metres.
 *
 *  TWO USES, ONE CONCEPT — *how far this editor's spatial probes reach unless told
 *  otherwise*. It is the FIXED reach of the prop contact probe (`field-host/field-query.ts`
 *  casts straight down from a prop's base and reports the gap it found), and it is the
 *  DEFAULT `maxDist` of the `{about:"ray"}` arm, which a caller may override up to
 *  {@link MAX_PROBE_M}.
 *
 *  THE CONTACT PROBE'S REACH IS DELIBERATELY NOT TUNABLE, which is why one of the two uses
 *  is fixed and the other is not. `contact` is a BOOLEAN an agent compares across calls and
 *  across props; a per-call reach would make two answers about the same world disagree for a
 *  reason no reader could see from either one.
 *
 *  THIRTY, and the honest reason is that the answer is not sensitive to this number in the
 *  direction that matters. What a caller acts on is `contact` and — when it is false and a
 *  surface WAS found — the gap to close. A prop with nothing under it for 30 m and one with
 *  nothing under it for 300 m are the same defect with the same remedy, and the answer
 *  distinguishes them anyway (a `null` gap is "nothing within the reach", stated in the tool
 *  description). What the bound buys is a COST ceiling: at the default 0.25 m cell it is 120
 *  DDA steps per probe, measured at ~10 µs each on a fully-carved column (the worst case —
 *  unallocated chunks read as SOLID, so an uncarved world hits at the first sample).
 *
 *  EQUAL TO {@link DIG_RANGE_M} TODAY AND DELIBERATELY NOT SPELLED AS IT, exactly as
 *  {@link HOLLOW_MIN_M} is not spelled as the kit lattice. That one is how far a HAND reaches
 *  from an eye; this is how far a PROBE looks for a floor. One number, two unrelated
 *  geometries — a shared spelling would make tuning either move the other. */
export const DEFAULT_PROBE_M = 30;

/** The furthest a `{about:"ray"}` caller may push `maxDist`, in metres.
 *
 *  A CEILING ON A PROMISE RATHER THAN ON COST, and that distinction is the whole reason for
 *  the number. `raycastField` has a SECOND terminator besides `maxDist` — its own internal
 *  `MAX_STEPS` (4096, core's `field/raycast.ts`) — and the two disagree about what a `null`
 *  means. Out of distance is *"nothing is there"*; out of steps is *"I stopped looking"*, and
 *  the function spells both `null`. Refusing a `maxDist` the walk cannot honour is what keeps
 *  the answer's `null` a single fact.
 *
 *  512, AND THE TWO HALVES OF THAT ARE NOT THE SAME KIND OF CLAIM.
 *
 *  MEASURED (bun, 2026-08-10, `field/raycast.ts` at head): at the 0.25 m cell an AXIS-ALIGNED
 *  ray through carved air finds a plug at 1000 m and not one at 1050 m — bracketing the
 *  4096 × 0.25 = 1024 m the step ceiling predicts.
 *
 *  DERIVED, NOT MEASURED: a 3D-DIAGONAL ray is the worst direction, because it crosses a
 *  boundary on all three axes per cell of per-axis advance — ~√3 steps per cell of travel —
 *  so its reach is ~1024/√3 ≈ 591 m. The equivalent probe for it was written and abandoned
 *  (carving a 700 m diagonal corridor did not finish in two minutes and the arithmetic it
 *  would have confirmed is already anchored by the axis case).
 *
 *  512 sits under the WORST direction, so a `null` at any accepted `maxDist` means "nothing
 *  there" whatever way the ray points.
 *
 *  IT IS EXACT FOR THE ONLY LATTICE THIS DOOR SERVES, and that is a verified fact rather than
 *  an assumption: the editor is single-lattice at the default cell — `field-host.ts` builds
 *  its one store with a bare `field.createFieldStore()`, and the two worker mirrors take that
 *  store's own `cellSize` over the wire. A COARSER cell would only push the true bound out
 *  (this under-promises, the safe direction); a FINER one would pull it in, which is the case
 *  to re-derive if the editor ever grows a second lattice. */
export const MAX_PROBE_M = 512;

/** How many cells a click-gesture flood may select before it truncates.
 *
 *  Under core's `MAX_SELECTION_BUDGET` (262144) so a UI selection never rides the op-replay
 *  ceiling exactly; truncation at this cap surfaces via `SelectionInfo.truncated`. It bounds
 *  the two FLOOD gestures (`material`, `void`) only — a `box` span is snapped instead, and
 *  `truncated` is always false for regions. */
export const SELECTION_UI_BUDGET = 200_000;

/** The smallest brush/capsule radius the host will hold, in metres.
 *
 *  Enforced by `clampRadius` (`field-host/field-tool.ts`) on every radius the chrome or
 *  the `[`/`]` keys push, and STATED as the `min` of the strip's radius range input — so
 *  the control cannot ask for a radius the clamp would move. */
export const RADIUS_MIN = 0.25;

/** The largest brush/capsule radius the host will hold, in metres. {@link RADIUS_MIN}'s
 *  other end, enforced by the same `clampRadius` and stated as the same input's `max`. */
export const RADIUS_MAX = 4;

/** The thinnest shell band a hollow fill may carve, in metres.
 *
 *  Core accepts any FINITE positive thickness (it cannot clamp against the cell size); the host
 *  applies this floor because a sub-cell shell on an organic shape comes out holey. Stated
 *  as the `min` of the strip's thickness field, which is also where the chrome re-applies it
 *  on blur — a settled sub-floor value would otherwise DISPLAY 0.2 while strokes carved 0.5.
 *
 *  Equal to `LATTICE` today and deliberately not spelled as it: the kit lattice is a
 *  snapping step and this is a thickness floor, and a shared spelling would make one move
 *  the other. */
export const HOLLOW_MIN_M = 0.5;
