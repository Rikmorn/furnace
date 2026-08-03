import { beforeEach, expect, test } from "bun:test";
import {
  getPointer,
  handlePointerDownDomEvent,
  handlePointerEnterDomEvent,
  handlePointerLeaveDomEvent,
  handlePointerMoveDomEvent,
  handlePointerUpDomEvent,
  handleWheelDomEvent,
  isPointerButtonDown,
  normalizePointer,
  normalizeWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
} from "./pointer.ts";
import { _resetForTests, state } from "./state.ts";

type RawPtrEvent = {
  offsetX: number;
  offsetY: number;
  button: number;
  buttons: number;
  pointerType: "mouse" | "pen" | "touch";
  pointerId: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  timeStamp: number;
};

function rawPtr(overrides: Partial<RawPtrEvent> = {}): RawPtrEvent {
  return {
    offsetX: 100,
    offsetY: 50,
    button: 0,
    buttons: 1,
    pointerType: "mouse",
    pointerId: 1,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    timeStamp: 0,
    ...overrides,
  };
}

type RawWheelEvent = {
  offsetX: number;
  offsetY: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  timeStamp: number;
};

function rawWheel(overrides: Partial<RawWheelEvent> = {}): RawWheelEvent {
  return {
    offsetX: 100,
    offsetY: 50,
    deltaX: 0,
    deltaY: 10,
    deltaZ: 0,
    timeStamp: 0,
    ...overrides,
  };
}

// Stand-in for a bound canvas with DPR=2 (backing-store 800x600, CSS 400x300).
function setStubCanvas(): void {
  const c = Object.assign(new EventTarget(), {
    width: 800,
    height: 600,
    clientWidth: 400,
    clientHeight: 300,
  }) as unknown as HTMLCanvasElement;
  state.canvas = c;
}

beforeEach(() => {
  _resetForTests();
  setStubCanvas();
});

test("normalizePointer maps CSS coords and computes device coords via DPR", () => {
  const out = normalizePointer(
    rawPtr({ offsetX: 100, offsetY: 50 }) as unknown as PointerEvent,
    "pointerdown",
  );
  // DPR = 800/400 = 2 → xDevice = 200, yDevice = 100
  expect(out.x).toBe(100);
  expect(out.y).toBe(50);
  expect(out.xDevice).toBe(200);
  expect(out.yDevice).toBe(100);
  expect(out.button).toBe(0);
  expect(out.buttons).toBe(1);
  expect(out.pointerType).toBe("mouse");
});

test("normalizePointer returns button=null on pointermove", () => {
  const out = normalizePointer(
    rawPtr({ button: -1 }) as unknown as PointerEvent,
    "pointermove",
  );
  expect(out.button).toBeNull();
});

test("normalizePointer with no bound canvas yields raw CSS coords and xDevice=x", () => {
  state.canvas = null;
  const out = normalizePointer(
    rawPtr({ offsetX: 100, offsetY: 50 }) as unknown as PointerEvent,
    "pointerdown",
  );
  expect(out.x).toBe(100);
  expect(out.y).toBe(50);
  expect(out.xDevice).toBe(100);
  expect(out.yDevice).toBe(50);
});

test("handlePointerDown updates buttons mask, emits, and reflects in snapshot", () => {
  let fired = 0;
  onPointerDown((e) => {
    expect(e.button).toBe(0);
    fired++;
  });

  handlePointerDownDomEvent(
    rawPtr({ button: 0, buttons: 1 }) as unknown as PointerEvent,
  );

  expect(isPointerButtonDown(0)).toBe(true);
  expect(state.pointer.buttons).toBe(1);
  expect(fired).toBe(1);
});

test("handlePointerUp clears the corresponding button", () => {
  state.pointer.buttons = 0b11;
  handlePointerUpDomEvent(
    rawPtr({ button: 0, buttons: 0b10 }) as unknown as PointerEvent,
  );
  // After pointerup the engine trusts the DOM's `buttons` bitmask as the new state.
  expect(state.pointer.buttons).toBe(0b10);
  expect(isPointerButtonDown(0)).toBe(false);
  expect(isPointerButtonDown(1)).toBe(true);
});

test("onPointerUp subscribers fire on handlePointerUp", () => {
  let fired = 0;
  onPointerUp((e) => {
    expect(e.button).toBe(0);
    expect(e.x).toBe(100);
    fired++;
  });

  handlePointerUpDomEvent(
    rawPtr({ button: 0, buttons: 0 }) as unknown as PointerEvent,
  );

  expect(fired).toBe(1);
});

test("handlePointerMove updates position; button=null in payload", () => {
  let fired = 0;
  onPointerMove((e) => {
    expect(e.button).toBeNull();
    expect(e.x).toBe(200);
    expect(e.y).toBe(75);
    fired++;
  });

  handlePointerMoveDomEvent(
    rawPtr({ offsetX: 200, offsetY: 75 }) as unknown as PointerEvent,
  );

  expect(state.pointer.x).toBe(200);
  expect(state.pointer.y).toBe(75);
  expect(state.pointer.xDevice).toBe(400);
  expect(state.pointer.yDevice).toBe(150);
  expect(fired).toBe(1);
});

test("handlePointerEnter / handlePointerLeave toggle overCanvas", () => {
  expect(state.pointer.overCanvas).toBe(false);
  handlePointerEnterDomEvent(rawPtr() as unknown as PointerEvent);
  expect(state.pointer.overCanvas).toBe(true);
  handlePointerLeaveDomEvent(rawPtr() as unknown as PointerEvent);
  expect(state.pointer.overCanvas).toBe(false);
});

test("getPointer returns a snapshot reflecting current state", () => {
  state.pointer.x = 1;
  state.pointer.y = 2;
  state.pointer.xDevice = 3;
  state.pointer.yDevice = 4;
  state.pointer.buttons = 5;
  state.pointer.overCanvas = true;

  expect(getPointer()).toEqual({
    x: 1,
    y: 2,
    xDevice: 3,
    yDevice: 4,
    buttons: 5,
    overCanvas: true,
  });
});

test("normalizeWheel computes dual coords and preserves deltas", () => {
  const out = normalizeWheel(
    rawWheel({
      offsetX: 100,
      offsetY: 50,
      deltaX: -1,
      deltaY: 2,
      deltaZ: 3,
      timeStamp: 42,
    }) as unknown as WheelEvent,
  );
  expect(out.x).toBe(100);
  expect(out.xDevice).toBe(200);
  expect(out.deltaX).toBe(-1);
  expect(out.deltaY).toBe(2);
  expect(out.deltaZ).toBe(3);
  expect(out.timestampMs).toBe(42);
});

test("handleWheel emits the normalized event", () => {
  let fired = 0;
  onWheel((e) => {
    expect(e.deltaY).toBe(10);
    fired++;
  });
  handleWheelDomEvent(rawWheel({ deltaY: 10 }) as unknown as WheelEvent);
  expect(fired).toBe(1);
});

test("snapshots before any event yield zero state", () => {
  _resetForTests();
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
