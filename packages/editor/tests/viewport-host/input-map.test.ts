import { expect, test } from "bun:test";
import { arrowNudgeSteps } from "../../src/viewport-host/input-map.ts";

// The stamp-nudge sign table. Pinned key by key BECAUSE nothing reachable from
// bun:test drives the keydown handler that consumes it (attachListeners only
// runs after a real GPU init), so a flipped sign here would otherwise ship
// green — and a flipped sign is the likeliest defect in a placement feature.

test("arrowNudgeSteps: plain arrows move ∓X (←/→) and ∓Z (↑/↓)", () => {
  expect(arrowNudgeSteps({ key: "ArrowLeft", shiftKey: false })).toEqual([
    -1, 0, 0,
  ]);
  expect(arrowNudgeSteps({ key: "ArrowRight", shiftKey: false })).toEqual([
    1, 0, 0,
  ]);
  // Up is −Z, not +Z. World axes, fixed — NOT resolved against the camera.
  expect(arrowNudgeSteps({ key: "ArrowUp", shiftKey: false })).toEqual([
    0, 0, -1,
  ]);
  expect(arrowNudgeSteps({ key: "ArrowDown", shiftKey: false })).toEqual([
    0, 0, 1,
  ]);
});

test("arrowNudgeSteps: Shift promotes ↑/↓ to ±Y (up is +Y)", () => {
  expect(arrowNudgeSteps({ key: "ArrowUp", shiftKey: true })).toEqual([
    0, 1, 0,
  ]);
  expect(arrowNudgeSteps({ key: "ArrowDown", shiftKey: true })).toEqual([
    0, -1, 0,
  ]);
});

test("arrowNudgeSteps: Shift on ←/→ MIRRORS the plain mapping (no second horizontal axis)", () => {
  // A stated choice, not an oversight: the modifier is a no-op on the
  // horizontal pair rather than making those keys dead while Shift is held.
  expect(arrowNudgeSteps({ key: "ArrowLeft", shiftKey: true })).toEqual(
    arrowNudgeSteps({ key: "ArrowLeft", shiftKey: false }),
  );
  expect(arrowNudgeSteps({ key: "ArrowRight", shiftKey: true })).toEqual(
    arrowNudgeSteps({ key: "ArrowRight", shiftKey: false }),
  );
});

test("arrowNudgeSteps: every step is exactly one unit on exactly one axis", () => {
  // Guards the whole table against a stray 2, a 0-vector, or a diagonal.
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])
    for (const shiftKey of [false, true]) {
      const steps = arrowNudgeSteps({ key, shiftKey });
      expect(steps).not.toBeNull();
      if (steps === null) continue;
      expect(steps.filter((s) => s !== 0).length).toBe(1);
      expect(steps.map(Math.abs).reduce((a, b) => a + b, 0)).toBe(1);
    }
});

test("arrowNudgeSteps: non-arrow keys return null (the handler falls through)", () => {
  for (const key of ["w", "Enter", "Escape", "[", "]", "Shift", " "])
    expect(arrowNudgeSteps({ key, shiftKey: false })).toBeNull();
});

test("arrowNudgeSteps: Object.prototype member names return null, not garbage", () => {
  // The lookup key is caller-supplied. Against a plain object literal these
  // names resolve through the prototype chain to a truthy non-entry, so the
  // undefined check passes and the caller nudges by garbage (the host's
  // `!== null` guard would admit it and nudgeRegion would throw). A Map has
  // no chain to inherit through. Unreachable from a real KeyboardEvent.key —
  // this pins the hardening, not a live bug.
  for (const key of ["constructor", "valueOf", "toString", "__proto__"])
    expect(arrowNudgeSteps({ key, shiftKey: false })).toBeNull();
});

test("arrowNudgeSteps: case-insensitive — the raw KeyboardEvent.key works", () => {
  // The host hands it the event directly; other branches lowercase separately.
  expect(arrowNudgeSteps({ key: "arrowup", shiftKey: false })).toEqual(
    arrowNudgeSteps({ key: "ArrowUp", shiftKey: false }),
  );
});
