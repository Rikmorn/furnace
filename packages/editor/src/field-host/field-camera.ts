// The camera's INPUT arithmetic: what a wheel event, a set of held keys and a
// look drag's pixel motion MEAN, before any of it reaches the rig.
//
// `camera-control.ts` is the other half and the split is not alphabetical: that
// module is the OrbitState math — V3 in, V3 out, no DOM anywhere in it, which is
// what lets it be reasoned about as geometry. Here the DOM is the subject
// (`WheelEvent`, a key set, client-pixel deltas), and the answers are plain
// numbers that module then takes. Nothing here imports it, and nothing here
// touches an `OrbitState`.
//
// Pure and host-free, for the `field-move.ts` / `viewport-cursor.ts` reason: the
// parts worth pinning down are the ones a bug makes SILENTLY wrong rather than
// loudly — a look drag whose sign inverts, a scroll banked and never spent, a
// speed that scales with the frame rate — and each of those is assertable with
// synthetic events and exact numbers, where through a live drag it is a matter
// of opinion.
//
// The RIG keeps every decision that needs its own readers: whether fly travel is
// gated open at all (`look`), the `orbitState` these feed, and `applyOrbit` —
// `field-camera-rig.ts` since 2026-08-08, the `createFieldHost` closure before
// that. One decision stays further out still, in the host's `onWheel`: which of
// the wheel's two bindings this scroll is, which is a fact about the EVENT.

/** A fly-travel direction, each component in [-1, 1]: `f` view-forward, `r`
 *  view-right, `u` WORLD-up — not camera-up, so the rig rises vertically whatever
 *  the pitch. `camera-control.ts`'s `flyMove` is what resolves the first two
 *  against the current orientation. */
export type FlyMove = { f: number; r: number; u: number };

/** `WheelEvent.deltaMode` unit conversions to pixels. A "line" is the ~16 px the
 *  browsers reporting `deltaMode: 1` (Firefox) assume; a "page" is a screenful,
 *  approximated rather than measured because nothing in this editor scrolls by
 *  pages and the mode is effectively unreachable here. */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;
/** Scroll distance, in CSS pixels, that buys one camera-travel step. Roughly one
 *  notch of a physical wheel on the platforms that report pixels. */
const WHEEL_STEP_PX = 100;

const FLY_SPEED = 6; // m/s
const FLY_BOOST = 3; // shift-held multiplier
const LOOK_SPEED = 0.005; // rad per pixel of RMB drag

/** A wheel event's scroll distance in CSS pixels, whatever unit it arrived in. */
function wheelPixels(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * WHEEL_LINE_PX;
  if (e.deltaMode === 2) return e.deltaY * WHEEL_PAGE_PX;
  return e.deltaY;
}

/**
 * Bank one wheel event toward the next camera-travel step.
 *
 * Returns the whole steps this event RELEASED — 0 while the scroll is still
 * short of {@link WHEEL_STEP_PX} — and the remainder to carry into the next one.
 * The remainder is SIGNED, so reversing direction drains the bank rather than
 * fighting it, and the caller must store it whether or not a step came out: a
 * sub-threshold scroll that is not carried is a scroll the user made and the
 * camera never spends.
 *
 * `steps` carries `deltaY`'s OWN sign, so it is positive for a scroll TOWARD the
 * user; turning that into a dolly direction is the caller's flip, because
 * away-from-the-user is forward. Why camera travel is banked at all rather than
 * stepped per event is argued at the one call site — `cameraRig.wheelDolly`
 * (`field-camera-rig.ts`) since 2026-08-08. The host's `onWheel` keeps only the
 * decision that this scroll is the camera's rather than the brush's.
 */
export function bankDolly(
  banked: number,
  e: WheelEvent,
): { banked: number; steps: number } {
  const total = banked + wheelPixels(e);
  const steps = Math.trunc(total / WHEEL_STEP_PX);
  return { banked: total - steps * WHEEL_STEP_PX, steps };
}

/** One frame's fly-travel direction from the held keys: W/S forward, D/A right,
 *  E/Q up, each axis the DIFFERENCE of its pair so holding both stands still.
 *  Reads only w/a/s/d/q/e, which is what leaves the rest of the alphabet to the
 *  editor's bare-letter bindings — the host's `onKeyDown` makes that argument. */
export const readFlyMove = (keys: ReadonlySet<string>): FlyMove => ({
  f: (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0),
  r: (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0),
  u: (keys.has("e") ? 1 : 0) - (keys.has("q") ? 1 : 0),
});

/** What one frame of fly travel is worth, in metres: the base rate, boosted
 *  while ⇧ is held, times the frame's `dt` in seconds. Scaling by `dt` rather
 *  than per frame is what keeps it a RATE and not a function of the display's
 *  refresh. `camera-control.ts`'s `flyMove` applies it per {@link FlyMove} AXIS
 *  and does not normalise, so a two-key diagonal covers √2 of it. */
export const flySpeed = (keys: ReadonlySet<string>, dt: number): number =>
  FLY_SPEED * (keys.has("shift") ? FLY_BOOST : 1) * dt;

/** A look drag's pixel motion as yaw/pitch deltas. The NEGATION is the whole
 *  content: it is what turns the view the direction the hand moved. The same two
 *  angles serve both drags — the RIG hands them to `orbitAbout` or to `flyLook`
 *  depending on whether the press latched a pivot (`field-camera-rig.ts`'s
 *  `lookDrag`, which is where that latch is read). */
export const lookDeltas = (
  dx: number,
  dy: number,
): { dYaw: number; dPitch: number } => ({
  dYaw: -dx * LOOK_SPEED,
  dPitch: -dy * LOOK_SPEED,
});
