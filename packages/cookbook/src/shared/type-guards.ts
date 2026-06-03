/**
 * Build a runtime guard for a string-literal union. Use at the boundary where
 * a `string` (e.g. from a <select>) must be narrowed back to the literal type
 * without a forbidden `as` cast.
 *
 *   type LoopKind = "variable" | "fixed";
 *   const isLoopKind = makeUnionGuard<LoopKind>(["variable", "fixed"]);
 *   if (isLoopKind(v)) onLoopChange(v);
 */
export function makeUnionGuard<T extends string>(
  values: readonly T[],
): (v: string) => v is T {
  const set = new Set<string>(values);
  return (v: string): v is T => set.has(v);
}
