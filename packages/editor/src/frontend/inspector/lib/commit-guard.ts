// The unchanged-blur dirty-check, shared by NumberField / VecField / QuatField (single
// source of truth). Committing on a blur that didn't change the value fires a spurious
// server round-trip → revision bump → extra undo entry — exactly the noise Task 8 set out
// to remove on the most-touched fields (Transform position/rotation/scale).
//
// The `committed` baseline is per-scalar (per vector/euler component for Vec/Quat) and must
// be captured while UNfocused, so it holds the pre-edit value rather than the live-previewed
// draft the field re-renders with mid-edit.

/** Run `doCommit` only when `parsed` differs from the `committed` baseline. The one
 *  comparison every numeric field's blur path routes through. */
export function commitIfChanged(
  committed: number,
  parsed: number,
  doCommit: () => void,
): void {
  if (parsed !== committed) doCommit();
}
