/** Loud replacement for `v!` in tests: asserts defined and returns the narrowed value. */
export function expectDefined<T>(v: T | undefined | null, label = "value"): T {
  if (v === undefined || v === null) {
    throw new Error(`expected ${label} to be defined, got ${String(v)}`);
  }
  return v;
}

/** Bounds-asserting index accessor for `noUncheckedIndexedAccess` fixtures. */
export function at<T>(arr: ArrayLike<T>, i: number): T {
  return expectDefined(arr[i], `[${i}] (length ${arr.length})`);
}
