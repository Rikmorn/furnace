import { expect, test } from "bun:test";
import { _resetForTests, state } from "./state.ts";

test("state starts in zero / unattached form", () => {
  _resetForTests();
  expect(state.canvas).toBeNull();
  expect(state.keysDown.size).toBe(0);
  expect(state.pointer).toEqual({
    x: 0,
    y: 0,
    xDevice: 0,
    yDevice: 0,
    buttons: 0,
    overCanvas: false,
  });
  expect(state.listeners.length).toBe(0);
});

test("emitters exist and are independent", () => {
  _resetForTests();
  expect(state.emitters.keyDown).toBeDefined();
  expect(state.emitters.keyUp).toBeDefined();
  expect(state.emitters.pointerDown).toBeDefined();
  expect(state.emitters.pointerMove).toBeDefined();
  expect(state.emitters.pointerUp).toBeDefined();
  expect(state.emitters.wheel).toBeDefined();
  expect(state.emitters.keyDown).not.toBe(state.emitters.keyUp);
});

test("_resetForTests clears runtime state AND emitter subscribers", () => {
  let fired = 0;
  state.emitters.keyDown.on(() => {
    fired++;
  });
  state.keysDown.add("KeyA");
  state.pointer.buttons = 1;

  _resetForTests();

  expect(state.keysDown.size).toBe(0);
  expect(state.pointer.buttons).toBe(0);
  // Emitter no longer fires the previously-registered subscriber:
  state.emitters.keyDown.emit({
    code: "KeyA",
    key: "a",
    repeat: false,
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
    timestampMs: 0,
  });
  expect(fired).toBe(0);
});
