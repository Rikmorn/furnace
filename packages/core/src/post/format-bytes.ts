/**
 * Bytes per texel for the color render-target formats the engine allocates.
 * Used for GPU memory-stats accounting (`_recordAlloc`/`_recordDestroy`), not
 * for layout — the only distinction that matters here is `rgba16float` (8) vs
 * the 8-bit-per-channel formats (4: bgra8unorm, rgba8unorm, and their -srgb).
 */
export function bytesPerTexel(format: GPUTextureFormat): number {
  switch (format) {
    case "rgba16float":
      return 8;
    default:
      return 4; // bgra8unorm, rgba8unorm, bgra8unorm-srgb, rgba8unorm-srgb
  }
}
