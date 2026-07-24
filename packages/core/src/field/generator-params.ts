// packages/core/src/field/generator-params.ts — the field generators' shared
// strict, setup-loud param validators.
//
// Extracted here (F3b Task 5) so the hall/maze (generators.ts), the cave
// (cave.ts) AND the scatter (scatter.ts) generators share ONE copy WITHOUT a
// cycle: generators.ts imports the cave/scatter DEFS to register them in
// FIELD_GENERATORS, so a generator importing the validators back out of
// generators.ts would close a loop. A leaf module with no field imports breaks
// it — the exact `rng.ts` precedent (F3b Task 2).
//
// Before this extraction each generator carried its own byte-identical copy
// (generators.ts labelled them; cave.ts hardcoded the "cave" prefix). Reconciled
// to the labelled form — `label` names the generator in the throw, matching every
// other setup-loud generator throw.

/** Finite number param in the schema property's `[minimum, maximum]` —
 *  setup-loud. Admits fractional values (a probability, a density). `label`
 *  names the generator in the throw ("hall" / "maze" / "cave" / "scatter").
 *
 *  @throws {@link Error} if `params[key]` is not a finite number in range. */
export function numParam(
  label: string,
  params: Record<string, unknown>,
  key: string,
  range: { minimum: number; maximum: number },
): number {
  const v = params[key];
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < range.minimum ||
    v > range.maximum
  )
    throw new Error(
      `${label}: ${key} must be a number in [${range.minimum}, ${range.maximum}], got ${JSON.stringify(v)}`,
    );
  return v;
}

/** Integer param in the schema property's `[minimum, maximum]` — setup-loud.
 *  Unlike {@link numParam} it rejects fractional values.
 *
 *  @throws {@link Error} if `params[key]` is not an integer in range. */
export function intParam(
  label: string,
  params: Record<string, unknown>,
  key: string,
  range: { minimum: number; maximum: number },
): number {
  const v = params[key];
  if (
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    v < range.minimum ||
    v > range.maximum
  )
    throw new Error(
      `${label}: ${key} must be an integer in [${range.minimum}, ${range.maximum}], got ${JSON.stringify(v)}`,
    );
  return v;
}

/** Boolean param — setup-loud. `label` names the generator in the throw.
 *
 *  @throws {@link Error} if `params[key]` is not a boolean. */
export function boolParam(
  label: string,
  params: Record<string, unknown>,
  key: string,
): boolean {
  const v = params[key];
  if (typeof v !== "boolean")
    throw new Error(
      `${label}: ${key} must be a boolean, got ${JSON.stringify(v)}`,
    );
  return v;
}
