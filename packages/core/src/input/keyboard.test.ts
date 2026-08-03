import { beforeEach, expect, test } from "bun:test";
import {
  handleBlur,
  handleKeyDownDomEvent,
  handleKeyUpDomEvent,
  isKeyDown,
  normalizeKey,
  onKeyDown,
  onKeyUp,
} from "./keyboard.ts";
import { _resetForTests, state } from "./state.ts";

// Plain-object event-shapes used through normalize. Avoids depending on the
// global KeyboardEvent constructor's exact behavior under Bun.
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
    timeStamp: 1234,
    ...overrides,
  };
}

beforeEach(() => {
  _resetForTests();
});

test("normalizeKey maps the DOM shape to the engine shape", () => {
  const out = normalizeKey(
    rawKb({
      code: "ArrowLeft",
      key: "ArrowLeft",
      repeat: true,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: true,
      timeStamp: 99,
    }) as unknown as KeyboardEvent,
  );
  expect(out).toEqual({
    code: "ArrowLeft",
    key: "ArrowLeft",
    repeat: true,
    shift: true,
    ctrl: false,
    alt: false,
    meta: true,
    timestampMs: 99,
  });
});

test("handleKeyDownDomEvent updates keysDown and emits", () => {
  let fired = 0;
  onKeyDown((e) => {
    expect(e.code).toBe("KeyA");
    fired++;
  });

  handleKeyDownDomEvent(rawKb({ code: "KeyA" }) as unknown as KeyboardEvent);

  expect(state.keysDown.has("KeyA")).toBe(true);
  expect(isKeyDown("KeyA")).toBe(true);
  expect(fired).toBe(1);
});

test("handleKeyUpDomEvent clears keysDown and emits", () => {
  state.keysDown.add("KeyA");
  let fired = 0;
  onKeyUp((e) => {
    expect(e.code).toBe("KeyA");
    fired++;
  });

  handleKeyUpDomEvent(rawKb({ code: "KeyA" }) as unknown as KeyboardEvent);

  expect(state.keysDown.has("KeyA")).toBe(false);
  expect(fired).toBe(1);
});

test("isKeyDown returns false for never-pressed keys", () => {
  expect(isKeyDown("ArrowLeft")).toBe(false);
});

test("auto-repeats preserve held state and emit with repeat=true", () => {
  const events: boolean[] = [];
  onKeyDown((e) => {
    events.push(e.repeat);
  });

  handleKeyDownDomEvent(
    rawKb({ code: "KeyA", repeat: false }) as unknown as KeyboardEvent,
  );
  handleKeyDownDomEvent(
    rawKb({ code: "KeyA", repeat: true }) as unknown as KeyboardEvent,
  );
  handleKeyDownDomEvent(
    rawKb({ code: "KeyA", repeat: true }) as unknown as KeyboardEvent,
  );

  expect(events).toEqual([false, true, true]);
  expect(state.keysDown.has("KeyA")).toBe(true);
});

test("handleBlur clears keysDown without synthesizing keyup events", () => {
  state.keysDown.add("ArrowLeft");
  state.keysDown.add("ArrowRight");
  let keyUpFired = 0;
  onKeyUp(() => {
    keyUpFired++;
  });

  handleBlur();

  expect(state.keysDown.size).toBe(0);
  expect(keyUpFired).toBe(0);
});

test("subscribers unsubscribe via the returned function", () => {
  let fired = 0;
  const unsub = onKeyDown(() => {
    fired++;
  });
  handleKeyDownDomEvent(rawKb() as unknown as KeyboardEvent);
  unsub();
  handleKeyDownDomEvent(rawKb() as unknown as KeyboardEvent);
  expect(fired).toBe(1);
});
