import { afterEach, beforeEach, expect, test } from "bun:test";
import { attach, detach, isAttached } from "../../src/input/attach.ts";
import { isKeyDown, onKeyDown } from "../../src/input/keyboard.ts";
import { _resetForTests } from "../../src/input/state.ts";
import { makeStubCanvas } from "../_helpers/dom-stubs.ts";

beforeEach(() => {
  _resetForTests();
});

afterEach(() => {
  if (isAttached()) detach();
});

// Bun (v1.3.14) does not expose KeyboardEvent as a constructor in the test
// runtime. Use plain Event + Object.defineProperty to carry the fields the
// engine reads — the engine only cares about the shape, not the constructor.
function makeKbEvent(
  type: "keydown" | "keyup",
  code: string,
  key: string,
): Event {
  const e = new Event(type, { bubbles: false });
  Object.defineProperty(e, "code", { value: code });
  Object.defineProperty(e, "key", { value: key });
  Object.defineProperty(e, "repeat", { value: false });
  Object.defineProperty(e, "shiftKey", { value: false });
  Object.defineProperty(e, "ctrlKey", { value: false });
  Object.defineProperty(e, "altKey", { value: false });
  Object.defineProperty(e, "metaKey", { value: false });
  Object.defineProperty(e, "timeStamp", { value: performance.now() });
  return e;
}

test("subscribe before attach: subscriber fires once attach happens", () => {
  let fired = 0;
  onKeyDown(() => {
    fired++;
  });
  // No attach yet — dispatch on the window doesn't reach the subscriber.
  globalThis.dispatchEvent(makeKbEvent("keydown", "KeyA", "a"));
  expect(fired).toBe(0);

  attach(makeStubCanvas());
  globalThis.dispatchEvent(makeKbEvent("keydown", "KeyA", "a"));
  expect(fired).toBe(1);
});

test("multiple subscribers all fire on the same event", () => {
  let a = 0;
  let b = 0;
  let c = 0;
  onKeyDown(() => {
    a++;
  });
  onKeyDown(() => {
    b++;
  });
  onKeyDown(() => {
    c++;
  });
  attach(makeStubCanvas());

  globalThis.dispatchEvent(makeKbEvent("keydown", "KeyA", "a"));

  expect(a).toBe(1);
  expect(b).toBe(1);
  expect(c).toBe(1);
});

test("a throwing subscriber doesn't break the others", () => {
  const originalError = console.error;
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppress console noise in test
  console.error = () => {};
  try {
    let firedAfter = 0;
    onKeyDown(() => {
      throw new Error("boom");
    });
    onKeyDown(() => {
      firedAfter++;
    });
    attach(makeStubCanvas());

    globalThis.dispatchEvent(makeKbEvent("keydown", "KeyA", "a"));

    expect(firedAfter).toBe(1);
    // And the held-state map is still consistent:
    expect(isKeyDown("KeyA")).toBe(true);
  } finally {
    console.error = originalError;
  }
});

test("unsubscribe via returned function stops that subscriber only", () => {
  let a = 0;
  let b = 0;
  const unsubA = onKeyDown(() => {
    a++;
  });
  onKeyDown(() => {
    b++;
  });
  attach(makeStubCanvas());

  globalThis.dispatchEvent(makeKbEvent("keydown", "KeyA", "a"));
  expect(a).toBe(1);
  expect(b).toBe(1);

  unsubA();

  globalThis.dispatchEvent(makeKbEvent("keydown", "KeyB", "b"));
  expect(a).toBe(1);
  expect(b).toBe(2);
});
