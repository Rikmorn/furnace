/** True if the N target values are not all deep-equal (drives the "mixed" indicator). */
export function isMixed(values: unknown[]): boolean {
  if (values.length <= 1) return false;
  const first = JSON.stringify(values[0]);
  return values.some((v) => JSON.stringify(v) !== first);
}
