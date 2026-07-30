export type BindingAction = "save" | "undo" | "redo" | "togglePalettes";

/**
 * Pure chord→action map. ⌘-chords are classified unconditionally — they stay live even
 * while typing, because the browser default they replace (save-page, the input's own
 * undo stack) is worse.
 *
 * `inTextInput` is the guard for BARE-key bindings, and today it changes no outcome:
 * every bare key is unbound, so a non-chord classifies as `undefined` either way. The
 * parameter stays because it is the classifier's half of the contract — a bare-key
 * binding added without it would fire mid-word — and because the caller already computes
 * it. `tests/keybindings.test.ts` pins the currently-unbound keys, so re-binding one is
 * a deliberate act with a failing test to answer to.
 */
export function matchBinding(
  e: KeyboardEvent,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: deliberately retained, not an incomplete refactoring — this is the classifier's bare-key guard, unread only while every bare key is unbound (see the TSDoc above)
  inTextInput: boolean,
): BindingAction | undefined {
  const mod = e.metaKey || e.ctrlKey; // ⌘ on macOS, Ctrl elsewhere
  if (mod && e.key.toLowerCase() === "z") return e.shiftKey ? "redo" : "undo";
  if (mod && e.key.toLowerCase() === "s") return "save";
  // Matched on `key`, not `code`: on a layout where `\` is not its own physical key the
  // code would be wrong, whereas the key is whatever the user actually produced.
  // UNVERIFIED in Safari — that ⌘\ arrives as `key === "\\"` with meta held is the
  // standard reading, not something measured here (no Safari in the session that wrote
  // this). If the browser gate finds it silent, an `e.code === "Backslash"` fallback is
  // the fix, and it belongs here rather than in the listener.
  if (mod && e.key === "\\") return "togglePalettes";
  // No bare-key bindings today. When one returns it goes here, behind
  // `if (inTextInput || mod || e.altKey) return undefined;`.
  return undefined;
}

export function isTextInputTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  );
}
