/**
 * Whether SchemaForm may re-seed its drafts from a new `values` prop. Returns
 * `false` while the user is actively editing the form (focus within), so an
 * incoming session-updated event does not clobber the in-progress draft
 * (Godot changing-guard pattern).
 *
 * Deliberately a pure predicate so the suppression logic is unit-testable
 * independently of the React focus-tracking that sets `focusWithin`.
 *
 * @param focusWithin - `true` when any input inside the SchemaForm currently
 *   holds focus (tracked via `onFocusCapture` / `onBlurCapture`).
 */
export function shouldReseed(focusWithin: boolean): boolean {
  return !focusWithin;
}
