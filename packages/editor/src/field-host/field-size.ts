// Pure size-default derivation for stamp generators (spec D-F3-13): fit a
// generator's size params to a selection's extent (measured in coarse cells),
// each value clamped to the generator's own schema bounds. No engine imports —
// the schema bounds and the maze pitch are PASSED IN (the host reads them from
// @furnace/core/field and threads them here), so this unit-tests without a GPU.
// It sits in `field-host/` because the host is its only consumer; the
// no-core-values property above is now a testability choice rather than the
// project-first invariant, which binds `src/frontend/` and `src/shared/` (where
// field-entity.ts stays type-only for exactly that reason).

/** Coarse cells the hall's masonry shell adds around its interior per axis: the
 *  generator's footprint is `interior + HALL_SHELL_CELLS` (a 1-cell wall each
 *  side, core's `dims+2`), so the interior fitting an extent is
 *  `extent − HALL_SHELL_CELLS`. */
const HALL_SHELL_CELLS = 2;

/** Coarse cells the maze's outer shell adds across each horizontal axis: a
 *  `cellsX × cellsZ` maze spans `pitch · cells + 1` coarse cells (core's
 *  `PITCH·cells − 1 + 2`), so the largest maze fitting `n` cells has
 *  `floor((n − MAZE_SHELL_CELLS) / pitch)` cells. */
const MAZE_SHELL_CELLS = 1;

/** A numeric schema property's clamp range (JSON-Schema `minimum`/`maximum`). */
type NumericBound = { minimum: number; maximum: number };

const clampTo = (v: number, b: NumericBound): number =>
  Math.max(b.minimum, Math.min(b.maximum, v));

/** Reads `{minimum, maximum}` off one schema property, setup-loud when the
 *  property is missing or not numerically bounded — a schema regression, never
 *  a user error. Builds a fresh record (never aliases the schema). */
function boundOf(
  properties: Record<string, unknown>,
  key: string,
): NumericBound {
  const p = properties[key];
  if (
    typeof p === "object" &&
    p !== null &&
    "minimum" in p &&
    "maximum" in p &&
    typeof p.minimum === "number" &&
    typeof p.maximum === "number"
  ) {
    return { minimum: p.minimum, maximum: p.maximum };
  }
  throw new Error(
    `field-size: schema property "${key}" is not a numerically bounded field`,
  );
}

/**
 * Size-param defaults for a stamp generator, fitted to a selection's extent and
 * clamped to the generator's own schema bounds — spec D-F3-13's "an active
 * selection derives size-param defaults from its extent". A SENSIBLE default,
 * not a hard fill (legal sizes are quantized): the user's later `updateStamp`
 * edits override any value the session then carries.
 *
 * - **hall**: `width/height/depth = extent − 2 coarse cells` per axis — the
 *   interior whose `dims+2` footprint matches the selection.
 * - **maze**: `cellsX/cellsZ = floor((extent − 1) / pitch)` — the largest cell
 *   count whose `pitch·cells + 1` footprint FITS the selection (the geometric
 *   inverse of the maze generator's own footprint; height is fixed, not seeded).
 * - any other generator: `{}` (no derivable size params).
 *
 * Every derived value is clamped into its schema `[minimum, maximum]`, so an
 * out-of-range extent CLAMPS (a 100 m selection → a max-size hall; a 1 m one →
 * the minimum) rather than throwing.
 *
 * @param generator - The generator id being stamped.
 * @param extentCells - The selection's per-axis extent in coarse cells `[x, y, z]`.
 * @param properties - The generator's schema `properties` map (the clamp-bound source).
 * @param mazePitchCells - The maze's coarse-cell pitch (core `MAZE_PITCH_CELLS`).
 * @returns The derived size params to overlay onto the session's default params.
 * @throws Error if a size key the generator needs is not a numerically bounded
 *   schema property (a schema regression).
 */
export function deriveSizeDefaults(
  generator: string,
  extentCells: readonly [number, number, number],
  properties: Record<string, unknown>,
  mazePitchCells: number,
): Record<string, number> {
  const [ex, ey, ez] = extentCells;
  if (generator === "hall") {
    return {
      width: clampTo(ex - HALL_SHELL_CELLS, boundOf(properties, "width")),
      height: clampTo(ey - HALL_SHELL_CELLS, boundOf(properties, "height")),
      depth: clampTo(ez - HALL_SHELL_CELLS, boundOf(properties, "depth")),
    };
  }
  if (generator === "maze") {
    const fit = (extent: number): number =>
      Math.floor((extent - MAZE_SHELL_CELLS) / mazePitchCells);
    return {
      cellsX: clampTo(fit(ex), boundOf(properties, "cellsX")),
      cellsZ: clampTo(fit(ez), boundOf(properties, "cellsZ")),
    };
  }
  return {};
}
