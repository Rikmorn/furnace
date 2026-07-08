// Reference-select option model (resource refs). Radix Select forbids an item with an
// empty-string value, and a blank trigger for an unset ref reads as "broken" rather than
// "unset" — so an unset ref maps to an explicit "(none)" sentinel option and back to ""
// on commit. Pure + unit-tested so the field renderer stays a thin mapping over this.

/** Sentinel Select value standing in for "no reference". A reserved `__none__` token that
 *  can't collide with an author-defined resource id (ids are alphanumeric / dashed). */
export const REF_NONE = "__none__";

export type RefOption = { value: string; label: string };

/** Option list for a ref select: a leading explicit "(none)" then one option per id. */
export function refOptions(ids: readonly string[]): RefOption[] {
  return [
    { value: REF_NONE, label: "(none)" },
    ...ids.map((id) => ({ value: id, label: id })),
  ];
}

/** The Select `value` for the current stored id: the sentinel when unset (""), so the
 *  "(none)" option shows as selected instead of a blank trigger. */
export function refSelectValue(id: string): string {
  return id === "" ? REF_NONE : id;
}

/** Map a chosen Select value back to the stored id — the "(none)" sentinel clears to "". */
export function refCommitValue(value: string): string {
  return value === REF_NONE ? "" : value;
}
