/** Multiplier applied when Shift is held to enable fine-grain scrubbing. */
const FINE_FACTOR = 0.1;

/**
 * Compute a scrubbed numeric value from a horizontal pixel delta.
 *
 * @param start - The value at the moment the drag began.
 * @param dxPixels - Horizontal distance moved since drag start (positive = right = increase).
 * @param sensitivity - Pixels-to-units ratio (e.g. `0.05` means 20 px per unit).
 * @param fine - When `true` (Shift held), applies {@link FINE_FACTOR} for sub-unit precision.
 * @returns The new value after applying the delta.
 */
export function scrubValue(
  start: number,
  dxPixels: number,
  sensitivity: number,
  fine: boolean,
): number {
  return start + dxPixels * sensitivity * (fine ? FINE_FACTOR : 1);
}
