export type BindingAction = "save" | "undo" | "redo" | "frame" | "delete";

/** Pure chord→action map. `inTextInput` guards bare-key bindings (F, ⌫) so typing
 *  never fires them; ⌘-chords stay global (the browser default they replace is worse). */
export function matchBinding(
  e: KeyboardEvent,
  inTextInput: boolean,
): BindingAction | undefined {
  const mod = e.metaKey || e.ctrlKey; // ⌘ on macOS, Ctrl elsewhere
  if (mod && e.key.toLowerCase() === "z") return e.shiftKey ? "redo" : "undo";
  if (mod && e.key.toLowerCase() === "s") return "save";
  if (inTextInput || mod || e.altKey) return undefined;
  if (e.key.toLowerCase() === "f") return "frame";
  if (e.key === "Backspace" || e.key === "Delete") return "delete";
  return undefined;
}

export function isTextInputTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  );
}
