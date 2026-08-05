/** Set component `index` to `value` on the target vector, preserving its own other
 *  components (a missing or non-numeric target defaults to a zero vector). */
export function setComponent(
  target: unknown,
  index: number,
  value: number,
  n: number,
): number[] {
  const v = Array.isArray(target) ? (target as number[]).slice(0, n) : [];
  const out = Array.from({ length: n }, (_, i) =>
    Number.isFinite(v[i]) ? (v[i] as number) : 0,
  );
  out[index] = value;
  return out;
}
