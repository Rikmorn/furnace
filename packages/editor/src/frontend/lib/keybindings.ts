export type BindingAction = "save" | "undo" | "redo";

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
