import { expect, test } from "bun:test";
import type { ViewportGesture } from "../../src/field-host/index.ts";
import {
  cursorAffordance,
  viewportCursor,
} from "../../src/field-host/viewport-cursor.ts";

// --- cursorAffordance (f2b item 10 / D-F4.5-7) -----------------------------

test("cursorAffordance: an unanchored SEGMENT draws the radius ring", () => {
  expect(
    cursorAffordance({
      gesture: "segment",
      pendingStamp: false,
      anchored: false,
    }),
  ).toBe("ring");
});

test("cursorAffordance: an unanchored BOX corner draws a cross, NOT the radius ring", () => {
  // The discriminating claim: a box corner has no radius, so the two two-click
  // gestures must NOT share one affordance. A `ring` here would promise a brush
  // width that decides nothing about what the click does.
  expect(
    cursorAffordance({ gesture: "box", pendingStamp: false, anchored: false }),
  ).toBe("cross");
});

test("cursorAffordance: a pending STAMP draws the corner cross whatever else is armed", () => {
  // The pending stamp SHADOWS the background arm, so the affordance must follow the
  // pending arm and not the gesture underneath it — including when that gesture is
  // `segment`, whose own affordance is the ring.
  for (const gesture of ["pointer", "segment", null] as const)
    expect(
      cursorAffordance({ gesture, pendingStamp: true, anchored: false }),
    ).toBe("cross");
});

test("cursorAffordance: an ANCHORED gesture draws nothing — its own preview has taken over", () => {
  for (const gesture of ["box", "segment"] as const)
    expect(
      cursorAffordance({ gesture, pendingStamp: false, anchored: true }),
    ).toBeNull();
  expect(
    cursorAffordance({ gesture: "box", pendingStamp: true, anchored: true }),
  ).toBeNull();
});

test("cursorAffordance: pointer, the brush and the flood modes draw nothing", () => {
  // The brush has the sphere ghost and `pointer` has the pick; a one-click flood has
  // no pending state to preview, so a cursor mark there would say nothing true.
  for (const gesture of ["pointer", "material", "void", null] as const)
    expect(
      cursorAffordance({ gesture, pendingStamp: false, anchored: false }),
    ).toBeNull();
});

// --- viewportCursor (D-F4.5-8's per-family glyph) --------------------------

test("viewportCursor: a live move wins over every arm — grab free-hand, grabbing on a drag", () => {
  expect(
    viewportCursor({
      move: "grab",
      pendingStamp: true,
      session: true,
      gesture: "box",
    }),
  ).toBe("grab");
  expect(
    viewportCursor({
      move: "drag",
      pendingStamp: true,
      session: true,
      gesture: "box",
    }),
  ).toBe("grabbing");
});

test("viewportCursor: three answers — plain for pointer, cell for the two-click gestures, crosshair for the rest", () => {
  const armed = (gesture: ViewportGesture | null) =>
    viewportCursor({
      move: null,
      pendingStamp: false,
      session: false,
      gesture,
    });
  // `pointer` selects and drags; it marks no point.
  expect(armed("pointer")).toBe("default");
  // The two-click gestures SPAN between two points rather than committing at one —
  // and `cell` is also what stops the box/region cross from sitting UNDER a
  // crosshair, where two stacked crosses read as cursor decoration.
  expect(armed("box")).toBe("cell");
  expect(armed("segment")).toBe("cell");
  // The brush and the one-click floods commit AT the point.
  for (const gesture of ["material", "void", null] as const)
    expect([gesture, armed(gesture)]).toEqual([gesture, "crosshair"]);
});

test("viewportCursor: a live session takes the SUSPENDED arms back to the plain cursor", () => {
  const inSession = (gesture: ViewportGesture | null) =>
    viewportCursor({ move: null, pendingStamp: false, session: true, gesture });
  // The two arms `suspendedByStamp` swallows. This is the COMMON path — a stamp is
  // picked from wherever the user already was, so whatever was armed is still armed
  // underneath the session, its cursor promising a click that will be dropped.
  expect(inSession(null)).toBe("default");
  expect(inSession("segment")).toBe("default");
  // …and the arms that stay LIVE keep their own answers: selection writes nothing to
  // the field, so a session does not suspend it. Without this half the case would
  // pass against a rule that simply blanked the cursor during every session.
  expect(inSession("pointer")).toBe("default");
  expect(inSession("box")).toBe("cell");
  expect(inSession("material")).toBe("crosshair");
  expect(inSession("void")).toBe("crosshair");
});

test("viewportCursor: a pending stamp reads as a two-click gesture over ANY arm", () => {
  // The shadow again: `pointer` is the background arm a stamp is most often armed
  // from, and it is the one gesture whose own cursor is `default`. Region-draw IS a
  // two-click gesture, so it answers like one whatever sits underneath.
  for (const gesture of ["pointer", null, "material"] as const)
    expect([
      gesture,
      viewportCursor({
        move: null,
        pendingStamp: true,
        session: false,
        gesture,
      }),
    ]).toEqual([gesture, "cell"]);
});
