import type { InternalState } from "./internal.ts";

/**
 * The frozen root context value-type returned by {@link requestContext} and
 * threaded as the first argument by every other `@furnace/core` module.
 *
 * The object itself is `Object.freeze`d; the WebGPU resources it points at
 * (device, queue, canvas) are not — `dispose(ctx)` is the engine-owned
 * teardown path. `_internal` is opaque to consumers; mutating it from
 * outside core is unsupported.
 *
 * @remarks
 * - `format` is the *view* format applied per swapchain texture
 *   (`*-srgb` when `RequestContextOptions.surfaceFormat === "srgb"`, the
 *   plain unorm format otherwise). The canvas itself is configured with the
 *   canonical non-srgb format because the WebGPU spec restricts
 *   `GPUCanvasContext.configure({ format })` to that set — sRGB encoding
 *   happens via the view format on each `getCurrentTexture().createView(...)`.
 * - `pixelRatio` is the resolved DPR (device pixels per CSS pixel) used to
 *   size the canvas backing store: `canvas.width = clientWidth * pixelRatio`.
 *   Defaults to `devicePixelRatio` (sharp on high-DPI displays); overridden
 *   via `RequestContextOptions.pixelRatio`. See `engine-conventions.md`
 *   §"Device pixel ratio".
 */
export type Context = Readonly<{
  device: GPUDevice;
  queue: GPUQueue;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  pixelRatio: number;
  _internal: InternalState;
}>;
