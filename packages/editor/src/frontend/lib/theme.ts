/**
 * Resolve a CSS custom property (e.g. `"--primary"`) to an `[r, g, b]` triple in
 * the 0–1 range, suitable for engine render colours (selection highlight lines,
 * viewport clear colour).
 *
 * The token may be authored in ANY CSS colour syntax. Resolution goes through a
 * 1×1 canvas 2D context: paint the colour, read the pixel back as sRGB bytes. This
 * is the ONLY reliable path — per CSS Color 4 CSSOM serialization, modern browsers
 * PRESERVE `oklch()`/`lab()`/`lch()`/`color()` in computed style (only legacy
 * hex/rgb/hsl/named normalize to `rgb()`), so parsing a computed-style string would
 * mis-read our oklch tokens as raw RGB numbers. The canvas raster always yields
 * sRGB regardless of the source colour space (browser-verified in headless Chromium:
 * `oklch(0.62 0.11 240)` → `rgb(62,142,193)`).
 *
 * Returns `fallback` (0–1 floats) when the var is unset or the 2D context is
 * unavailable; never throws.
 *
 * @param varName - The custom-property name including the leading `--`.
 * @param fallback - `[r, g, b]` in `[0, 1]`, returned when resolution fails.
 * @returns `[r, g, b]`, each in `[0, 1]`.
 */
export function resolveCssColor(
  varName: string,
  fallback: [number, number, number],
): [number, number, number] {
  try {
    const css = getComputedStyle(document.documentElement)
      .getPropertyValue(varName)
      .trim();
    if (!css) return fallback;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fallback;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    // A filled 1×1 canvas always yields 4 bytes; the `= 0` defaults just satisfy
    // noUncheckedIndexedAccess (they cannot fire in practice).
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  } catch {
    return fallback;
  }
}
