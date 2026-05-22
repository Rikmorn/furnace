import { afterEach, beforeEach, expect, test } from "bun:test";
import { attach, detach, isAttached } from "../../src/input/attach.ts";
import { FurnaceInputError } from "../../src/input/errors.ts";
import { isKeyDown, onKeyDown } from "../../src/input/keyboard.ts";
import {
  getPointer,
  isPointerButtonDown,
  onPointerDown,
} from "../../src/input/pointer.ts";
import { _resetForTests, state } from "../../src/input/state.ts";
import { makeStubCanvas } from "../_helpers/dom-stubs.ts";

beforeEach(() => {
  _resetForTests();
});

afterEach(() => {
  // Defensive: tests may leave state attached if they fail; clean up so the
  // next test starts on a real fresh slate.
  if (isAttached()) detach();
});

test("isAttached is false before attach", () => {
  expect(isAttached()).toBe(false);
});

test("attach installs listeners and isAttached becomes true", () => {
  const canvas = makeStubCanvas();
  attach(canvas);
  expect(isAttached()).toBe(true);
  expect(state.canvas).toBe(canvas);
  expect(state.listeners.length).toBeGreaterThan(0);
});

test("detach clears listeners, canvas, and isAttached", () => {
  const canvas = makeStubCanvas();
  attach(canvas);
  detach();
  expect(isAttached()).toBe(false);
  expect(state.canvas).toBeNull();
  expect(state.listeners.length).toBe(0);
});

test("attach while already attached throws FurnaceInputError", () => {
  const canvas = makeStubCanvas();
  attach(canvas);
  expect(() => attach(canvas)).toThrow(FurnaceInputError);
  expect(() => attach(canvas)).toThrow(/already attached/);
});

test("detach when not attached is a no-op", () => {
  expect(() => detach()).not.toThrow();
  expect(isAttached()).toBe(false);
});

// Bun (v1.3.14) does not expose KeyboardEvent / PointerEvent as constructors in
// the test runtime. Use plain Event + Object.defineProperty to carry the fields
// the engine reads — the engine only cares about the shape, not the constructor.

function makeKeyboardEvent(
  type: string,
  fields: { code: string; key: string },
): Event {
  const ev = new Event(type);
  Object.defineProperty(ev, "code", { value: fields.code });
  Object.defineProperty(ev, "key", { value: fields.key });
  Object.defineProperty(ev, "repeat", { value: false });
  Object.defineProperty(ev, "shiftKey", { value: false });
  Object.defineProperty(ev, "ctrlKey", { value: false });
  Object.defineProperty(ev, "altKey", { value: false });
  Object.defineProperty(ev, "metaKey", { value: false });
  return ev;
}

function makePointerEvent(fields: {
  offsetX: number;
  offsetY: number;
  button: number;
  buttons: number;
}): Event {
  const ev = new Event("pointerdown");
  Object.defineProperty(ev, "offsetX", { value: fields.offsetX });
  Object.defineProperty(ev, "offsetY", { value: fields.offsetY });
  Object.defineProperty(ev, "button", { value: fields.button });
  Object.defineProperty(ev, "buttons", { value: fields.buttons });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "shiftKey", { value: false });
  Object.defineProperty(ev, "ctrlKey", { value: false });
  Object.defineProperty(ev, "altKey", { value: false });
  Object.defineProperty(ev, "metaKey", { value: false });
  Object.defineProperty(ev, "timeStamp", { value: 0 });
  return ev;
}

test("attach → detach → attach preserves subscribers", () => {
  let fired = 0;
  onKeyDown(() => {
    fired++;
  });
  const canvas = makeStubCanvas();
  attach(canvas);
  detach();
  attach(canvas);

  globalThis.dispatchEvent(
    makeKeyboardEvent("keydown", { code: "KeyA", key: "a" }),
  );

  expect(fired).toBe(1);
});

test("integration: real keyboard event dispatch on globalThis reaches subscribers", () => {
  let firedCode = "";
  let firedKey = "";
  onKeyDown((e) => {
    firedCode = e.code;
    firedKey = e.key;
  });
  const canvas = makeStubCanvas();
  attach(canvas);

  globalThis.dispatchEvent(
    makeKeyboardEvent("keydown", { code: "ArrowLeft", key: "ArrowLeft" }),
  );

  expect(firedCode).toBe("ArrowLeft");
  expect(firedKey).toBe("ArrowLeft");
  expect(isKeyDown("ArrowLeft")).toBe(true);
});

test("integration: real pointer event dispatch on canvas reaches subscribers", () => {
  let firedX = -1;
  let firedY = -1;
  let firedButton = -1;
  onPointerDown((e) => {
    firedX = e.x;
    firedY = e.y;
    firedButton = e.button ?? -1;
  });
  const canvas = makeStubCanvas();
  attach(canvas);

  canvas.dispatchEvent(
    makePointerEvent({ offsetX: 50, offsetY: 25, button: 0, buttons: 1 }),
  );

  expect(firedX).toBe(50);
  expect(firedY).toBe(25);
  expect(firedButton).toBe(0);
  expect(isPointerButtonDown(0)).toBe(true);
});

test("integration: blur on globalThis clears held state", () => {
  const canvas = makeStubCanvas();
  attach(canvas);

  globalThis.dispatchEvent(
    makeKeyboardEvent("keydown", { code: "ArrowLeft", key: "ArrowLeft" }),
  );
  expect(isKeyDown("ArrowLeft")).toBe(true);

  globalThis.dispatchEvent(new Event("blur"));

  expect(isKeyDown("ArrowLeft")).toBe(false);
});

test("snapshot helpers return zero state before attach", () => {
  expect(isKeyDown("ArrowLeft")).toBe(false);
  expect(isPointerButtonDown(0)).toBe(false);
  expect(getPointer()).toEqual({
    x: 0,
    y: 0,
    xDevice: 0,
    yDevice: 0,
    buttons: 0,
    overCanvas: false,
  });
});
