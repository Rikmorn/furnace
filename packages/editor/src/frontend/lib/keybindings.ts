// The one DOM question the key gate asks that `lib/actions.ts` cannot: is the event's
// target a place where the user is TYPING? It lives here rather than beside the registry
// so that module stays DOM-free and unit-testable without a happy-dom harness — this
// predicate needs real element classes to narrow against, and its cases live with the
// other DOM ones (`tests/chrome/keybindings-dom.test.ts`).
//
// A focusable `<canvas>` is deliberately NOT a text input: the viewport is where the bare
// keys are meant to work.

/** The `<input>` types that hold TYPED TEXT. `""` is in the set because that is what
 *  `type` reports for an `<input>` with no attribute at all, which IS a text field.
 *
 *  Everything absent is a control the user OPERATES rather than types into: `range`,
 *  `checkbox`, `radio`, `color`, `file`, the date/time pickers, `button`/`submit`. */
const TEXTUAL_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  // Textual: it takes digits, `-`, `.` and `e` from the keyboard like any text field.
  "number",
  "",
]);

/**
 * Is the user typing into this target? Both gates that consult it (bare keys, and Esc/⏎)
 * refuse when it is true, and it has to be right in BOTH directions — each error loses
 * the user something different:
 *
 * - **Too wide** and a binding dies behind a control the user is merely FOCUSED on. The
 *   brush-radius `<input type="range">` is the sharp case: it is the control someone
 *   drags *while looking at the field*, so matching it makes `V`/`B`/`F` dead exactly
 *   there — the standing "touch a panel and the keys stop working" defect
 *   (`docs/reference/editor/action-registry.md` "Who owns a key") relocated from the
 *   canvas to a slider.
 * - **Too narrow** and a key pressed FOR THE CONTROL runs an editor verb instead. A
 *   native `<select>` is the sharp case that way: Esc is the conventional dismiss for its
 *   popup, and these panels use native selects throughout (`field/form-bits.tsx` says
 *   why) — including the merge-policy select that is on screen *during a live stamp
 *   session*, where an unclaimed Esc runs the cancel ladder and discards the session the
 *   user is configuring.
 *
 * So the rule is TYPED TEXT ENTRY, not "focusable form control": a textarea, a select
 * (its popup owns the keyboard while open), the textual `<input>` types, and anything
 * contentEditable.
 */
export function isTextInputTarget(t: EventTarget | null): boolean {
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)
    return true;
  if (t instanceof HTMLInputElement) return TEXTUAL_INPUT_TYPES.has(t.type);
  return t instanceof HTMLElement && t.isContentEditable;
}
