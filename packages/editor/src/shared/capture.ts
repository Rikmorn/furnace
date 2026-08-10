// packages/editor/src/shared/capture.ts
//
// THE CAPTURE VOCABULARY, declared once for the four layers that need it (foundations
// T4c): where a photograph may be taken from and how big it may be. The host derives a
// camera and a texture size from these (`field-host/field-capture.ts`), the chrome relays
// them, and the daemon VALIDATES against them (`daemon/session-handlers.ts`). The MCP door is
// the fourth reader and arrived at T4c Task 6: it does not read this file either, which is
// the projection working — the daemon's `z.enum(CAPTURE_VIEWS)` IS the advertised JSON Schema
// enum, reflected out of the schema `dispatch` runs, so the array reaches an agent without a
// fifth site naming it.
//
// WHY THE NEUTRAL FLOOR AND NOT BESIDE THE VERB. The daemon is Node-portable and may not
// pull `@furnace/core`, and every file in `field-host/` value-imports it. So a bound the
// daemon's schema states and the host clamps to can only be ONE constant if it lives here.
// The alternative is a hand-copy, which is precisely the drift `wire.ts`'s header calls
// invisible in both directions: a daemon that accepts 4096 and a host that silently clamps
// to 1568 disagree about what was asked for, and nothing fails.
//
// A VALUE MODULE, unlike `wire.ts` beside it — the array and the numbers are the point.
// `wire.ts` takes only the TYPE off it, so it stays types-only itself.

/**
 * Every view a capture may be taken from — **the array is the declaration, and
 * {@link CaptureView} is derived from it.**
 *
 * That direction round is deliberate. The daemon's zod enum and the door's JSON Schema need
 * the values at RUN time; the host and the wire need the union at COMPILE time. Deriving
 * the union from the array makes those the same fact, so an arm cannot be added to one and
 * missed by the other. Ordered `"user"` first, then the corner triad's own axis order.
 */
export const CAPTURE_VIEWS = [
  "user",
  "+x",
  "-x",
  "+y",
  "-y",
  "+z",
  "-z",
] as const;

/**
 * Where a `viewport.capture` is taken from.
 *
 * **`"user"` PLUS THE SIX AXIS VIEWS, AND NOTHING ELSE** — this is T4c Task 2's one open
 * judgement, so the argument lives with the type rather than in a commit message.
 *
 * The test applied is *what can an agent usefully SAY before it has seen the world*.
 * `"user"` needs no knowledge at all and is the default. An axis view needs none either,
 * because it is derived from the human's OWN framing: the pivot and the view distance stay
 * the rig's and only the two angles move (`field-host/camera-control.ts`'s `snapToAxis` —
 * the same function `FieldHost.snapView` and the corner triad call). So "show me that from
 * above" is answerable by an agent that knows where nothing is.
 *
 * **AN EXPLICIT `{yaw, pitch}` ARM WAS CONSIDERED AND REJECTED**, and it is the near miss
 * worth recording. `SessionState.camera` already hands an agent the live yaw and pitch, so
 * a perturb-and-look loop is one arm away and would close over a wire that exists. Against
 * it: the six snaps answer the COARSE question ("from another side"), an arbitrary angle is
 * a fine question that only arises once the agent has already looked, and this union
 * becomes an MCP JSON Schema where a flat string enum is a materially better thing to hand
 * a model than a `oneOf` of a string and an object. The trigger to revisit is evidence — an
 * agent that demonstrably needed an off-axis angle and could not get it — and the cost of
 * collecting is one entry in the array above and one branch in `captureOrbit`, because the
 * derivation already runs through a pure function over the rig's state.
 *
 * **A full eye/target/up POSE was never a candidate**: an agent cannot name world
 * coordinates it has not seen, and a badly-chosen eye produces a black frame indistinguish-
 * able from a broken capture.
 *
 * **THE SPELLING IS THE CHROME'S, not a second vocabulary.** `+y` rather than `top`, because
 * the editor names these six views exactly once — `axisViewLabel` in
 * `frontend/lib/axis-triad.ts` ("View from positive Y"), which is what the triad's tips and
 * the burger's six View rows are labelled with, over `FieldHost.snapView(axis, sign)`. A
 * `top`/`front`/`left` set would be a second name for one thing, and would additionally
 * assert a world orientation this editor does not have: nothing here declares which way a
 * dungeon faces, and Y-up is the only convention the engine states. What an agent needs in
 * order to read the axes is one sentence in the tool description.
 */
export type CaptureView = (typeof CAPTURE_VIEWS)[number];

/**
 * The default longest edge, in pixels.
 *
 * 1024 because that is where a vision model stops paying for resolution it cannot use:
 * shipped 3D-capture tools default between 512 and 1920, and Anthropic's own guidance is to
 * pre-scale to ~1024 rather than let the API downscale (both cited in
 * `docs/research/2026-08-09-viewport-capture-technique.md`). The viewport's aspect is
 * preserved, so a wide editor window yields 1024 × something-shorter.
 */
export const DEFAULT_CAPTURE_SIZE = 1024;

/** The ceiling on the longest edge.
 *
 *  1568 is the long-edge cap this tranche's plan set, from Anthropic's published image
 *  guidance — an image longer than that is downscaled server-side, so the extra bytes are
 *  spent to be thrown away, along with the daemon budget spent moving them. **Taken as a
 *  BOUND rather than verified against the docs here**, which costs nothing: being
 *  conservative about a ceiling is safe in the direction that matters.
 *
 *  The daemon REFUSES above it and the host CLAMPS to it — see {@link MIN_CAPTURE_SIZE} for
 *  why those two are not the same posture by accident. */
export const MAX_CAPTURE_SIZE = 1568;

/** The floor on the longest edge. Not a GPU limit — a legibility one: below this the
 *  overlays that make the capture worth taking are sub-pixel.
 *
 *  **TWO POSTURES ON ONE BOUND, deliberately.** The daemon's schema REFUSES an out-of-range
 *  `size` (`invalid-input`, naming the range), because a schema is also documentation and an
 *  agent told the ceiling stops guessing at it. The host CLAMPS instead, because it is
 *  reachable from the chrome and from tests where a refusal buys nothing and the answer
 *  carries the size it actually produced. They agree on the numbers because they read these
 *  two constants; what differs is what each does at the edge, which is a property of who is
 *  asking. */
export const MIN_CAPTURE_SIZE = 64;
