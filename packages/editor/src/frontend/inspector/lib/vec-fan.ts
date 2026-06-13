/** Set component `index` to `value` on each of the N target vectors, preserving
 *  each target's own other components (missing targets default to a zero vector). */
export function fanComponent(
  targets: unknown[],
  index: number,
  value: number,
  n: number,
): number[][] {
  return targets.map((t) => {
    const v = Array.isArray(t) ? (t as number[]).slice(0, n) : [];
    const out = Array.from({ length: n }, (_, i) =>
      Number.isFinite(v[i]) ? (v[i] as number) : 0,
    );
    out[index] = value;
    return out;
  });
}
