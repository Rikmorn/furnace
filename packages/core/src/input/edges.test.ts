import { beforeEach, expect, test } from "bun:test";
import { _inputEndFrame } from "./internal.ts";
import {
  handleKeyDownDomEvent,
  handleKeyUpDomEvent,
  wasKeyPressed,
  wasKeyReleased,
} from "./keyboard.ts";
import {
  handlePointerDownDomEvent,
  handlePointerUpDomEvent,
  wasPointerButtonPressed,
  wasPointerButtonReleased,
} from "./pointer.ts";
import { _resetForTests } from "./state.ts";

type RawKbEvent = {
  code: string;
  key: string;
  repeat: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  timeStamp: number;
};
function rawKb(overrides: Partial<RawKbEvent> = {}): RawKbEvent {
  return {
    code: "KeyA",
    key: "a",
    repeat: false,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    timeStamp: 0,
    ...overrides,
  };
}

type RawPtr = {
  offsetX: number;
  offsetY: number;
  button: number;
  buttons: number;
  pointerType: string;
  pointerId: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  timeStamp: number;
};
function rawPtr(o: Partial<RawPtr> = {}): RawPtr {
  return {
    offsetX: 0,
    offsetY: 0,
    button: 0,
    buttons: 1,
    pointerType: "mouse",
    pointerId: 1,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    timeStamp: 0,
    ...o,
  };
}

beforeEach(() => _resetForTests());

test("wasKeyPressed is true the frame a key goes down, then clears", () => {
  handleKeyDownDomEvent(rawKb({ code: "Space" }) as unknown as KeyboardEvent);
  expect(wasKeyPressed("Space")).toBe(true);
  _inputEndFrame();
  expect(wasKeyPressed("Space")).toBe(false);
});

test("wasKeyReleased is true the frame a key goes up, then clears", () => {
  handleKeyDownDomEvent(rawKb({ code: "Space" }) as unknown as KeyboardEvent);
  _inputEndFrame();
  handleKeyUpDomEvent(rawKb({ code: "Space" }) as unknown as KeyboardEvent);
  expect(wasKeyReleased("Space")).toBe(true);
  _inputEndFrame();
  expect(wasKeyReleased("Space")).toBe(false);
});

test("a sub-frame press+release registers BOTH edges in one frame", () => {
  handleKeyDownDomEvent(rawKb({ code: "KeyR" }) as unknown as KeyboardEvent);
  handleKeyUpDomEvent(rawKb({ code: "KeyR" }) as unknown as KeyboardEvent);
  expect(wasKeyPressed("KeyR")).toBe(true);
  expect(wasKeyReleased("KeyR")).toBe(true);
});

test("OS auto-repeat does not re-fire wasKeyPressed after the press frame", () => {
  handleKeyDownDomEvent(
    rawKb({ code: "KeyD", repeat: false }) as unknown as KeyboardEvent,
  );
  _inputEndFrame(); // press frame ends, key still held
  handleKeyDownDomEvent(
    rawKb({ code: "KeyD", repeat: true }) as unknown as KeyboardEvent,
  );
  expect(wasKeyPressed("KeyD")).toBe(false); // held, not a new press
});

test("wasPointerButtonPressed/Released register button edges, then clear", () => {
  handlePointerDownDomEvent(
    rawPtr({ button: 0, buttons: 1 }) as unknown as PointerEvent,
  );
  expect(wasPointerButtonPressed(0)).toBe(true);
  _inputEndFrame();
  expect(wasPointerButtonPressed(0)).toBe(false);

  handlePointerUpDomEvent(
    rawPtr({ button: 0, buttons: 0 }) as unknown as PointerEvent,
  );
  expect(wasPointerButtonReleased(0)).toBe(true);
  _inputEndFrame();
  expect(wasPointerButtonReleased(0)).toBe(false);
});
