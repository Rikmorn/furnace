export type BindingAction = "save" | "undo" | "redo";

/** Pure chord→action map. `inTextInput` guards bare-key bindings so typing never fires
 *  them; ⌘-chords stay global (the browser default they replace is worse). There are no
 *  bare-key bindings today, so `inTextInput` currently only gates the early return —
 *  it stays in the signature because the guard belongs with the classifier. */
export function matchBinding(
  e: KeyboardEvent,
  inTextInput: boolean,
): BindingAction | undefined {
  const mod = e.metaKey || e.ctrlKey; // ⌘ on macOS, Ctrl elsewhere
  if (mod && e.key.toLowerCase() === "z") return e.shiftKey ? "redo" : "undo";
  if (mod && e.key.toLowerCase() === "s") return "save";
  if (inTextInput || mod || e.altKey) return undefined;
  return undefined;
}

export function isTextInputTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  );
}
