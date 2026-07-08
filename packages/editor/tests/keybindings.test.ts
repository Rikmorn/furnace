import { expect, test } from "bun:test";
import { matchBinding } from "../src/frontend/lib/keybindings.ts";

// Pure classifier — no DOM needed; `KeyboardEvent` is only a type here (erased),
// so this file deliberately does NOT import the happy-dom harness.
// (isTextInputTarget, which needs a real HTMLElement, is covered in menubar.test.tsx.)
const ev = (o: Partial<KeyboardEvent> & { key: string }) => o as KeyboardEvent;

test("matchBinding maps chords and refuses text-input targets", () => {
  expect(matchBinding(ev({ key: "s", metaKey: true }), false)).toBe("save");
  expect(matchBinding(ev({ key: "z", metaKey: true }), false)).toBe("undo");
  expect(
    matchBinding(ev({ key: "z", metaKey: true, shiftKey: true }), false),
  ).toBe("redo");
  expect(matchBinding(ev({ key: "f" }), false)).toBe("frame");
  expect(matchBinding(ev({ key: "Backspace" }), false)).toBe("delete");
  expect(matchBinding(ev({ key: "f" }), true)).toBeUndefined();
  expect(matchBinding(ev({ key: "Backspace" }), true)).toBeUndefined();
  expect(matchBinding(ev({ key: "s", metaKey: true }), true)).toBe("save");
});

test("matchBinding: Ctrl stands in for Cmd, Delete maps like Backspace, Alt is inert", () => {
  expect(matchBinding(ev({ key: "z", ctrlKey: true }), false)).toBe("undo");
  expect(
    matchBinding(ev({ key: "z", ctrlKey: true, shiftKey: true }), false),
  ).toBe("redo");
  expect(matchBinding(ev({ key: "s", ctrlKey: true }), false)).toBe("save");
  expect(matchBinding(ev({ key: "Delete" }), false)).toBe("delete");
  // ⌘/Ctrl-chords stay live even in a text input (the browser default is worse).
  expect(matchBinding(ev({ key: "z", ctrlKey: true }), true)).toBe("undo");
  // Bare F with a modifier is not a frame chord.
  expect(matchBinding(ev({ key: "f", altKey: true }), false)).toBeUndefined();
  // Uppercase (Shift-held) letter still classifies via toLowerCase.
  expect(matchBinding(ev({ key: "S", metaKey: true }), false)).toBe("save");
});
