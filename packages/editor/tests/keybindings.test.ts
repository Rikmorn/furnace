import { expect, test } from "bun:test";
import { matchBinding } from "../src/frontend/lib/keybindings.ts";

// Pure classifier — no DOM needed; `KeyboardEvent` is only a type here (erased),
// so this file deliberately does NOT import the happy-dom harness (doing so from a
// top-level tests/ file poisons the daemon/bundle/GPU suites — see the header of
// tests/chrome/keybindings-dom.test.ts).
// (isTextInputTarget, which needs a real HTMLElement, is covered there.)
const ev = (o: Partial<KeyboardEvent> & { key: string }) => o as KeyboardEvent;

test("matchBinding maps the ⌘-chords, in a text input as much as out of one", () => {
  expect(matchBinding(ev({ key: "s", metaKey: true }), false)).toBe("save");
  expect(matchBinding(ev({ key: "z", metaKey: true }), false)).toBe("undo");
  expect(
    matchBinding(ev({ key: "z", metaKey: true, shiftKey: true }), false),
  ).toBe("redo");
  // ⌘/Ctrl-chords stay live even in a text input (the browser default is worse).
  expect(matchBinding(ev({ key: "s", metaKey: true }), true)).toBe("save");
});

test("matchBinding maps ⌘\\ to the palette hide-all latch", () => {
  expect(matchBinding(ev({ key: "\\", metaKey: true }), false)).toBe(
    "togglePalettes",
  );
  expect(matchBinding(ev({ key: "\\", ctrlKey: true }), false)).toBe(
    "togglePalettes",
  );
  // A ⌘-chord, so it stays live in a text input like the others.
  expect(matchBinding(ev({ key: "\\", metaKey: true }), true)).toBe(
    "togglePalettes",
  );
  // Bare `\` is a character someone is typing — never a binding.
  expect(matchBinding(ev({ key: "\\" }), false)).toBeUndefined();
});

test("matchBinding: Ctrl stands in for Cmd, Alt is inert, case is folded", () => {
  expect(matchBinding(ev({ key: "z", ctrlKey: true }), false)).toBe("undo");
  expect(
    matchBinding(ev({ key: "z", ctrlKey: true, shiftKey: true }), false),
  ).toBe("redo");
  expect(matchBinding(ev({ key: "s", ctrlKey: true }), false)).toBe("save");
  expect(matchBinding(ev({ key: "z", ctrlKey: true }), true)).toBe("undo");
  // ⌥ is not a modifier any binding uses — with it held, nothing classifies.
  expect(matchBinding(ev({ key: "s", altKey: true }), false)).toBeUndefined();
  // Uppercase (Shift-held) letter still classifies via toLowerCase.
  expect(matchBinding(ev({ key: "S", metaKey: true }), false)).toBe("save");
});

test("matchBinding: the retired bare-key bindings classify as nothing", () => {
  // F (frame) and ⌫/Delete (delete selection) went with the scene surface. They are
  // pinned as UNBOUND so a future binding has to be added deliberately, not inherited.
  expect(matchBinding(ev({ key: "f" }), false)).toBeUndefined();
  expect(matchBinding(ev({ key: "Backspace" }), false)).toBeUndefined();
  expect(matchBinding(ev({ key: "Delete" }), false)).toBeUndefined();
  expect(matchBinding(ev({ key: "f" }), true)).toBeUndefined();
});
