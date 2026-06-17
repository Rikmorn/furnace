// Bun-webgpu fixture helper. Tests using a real WebGPU device import bunWebGpuAvailable()
// and wrap their assertions in test.skipIf(!bunWebGpuAvailable())(...).
//
// bun-webgpu 0.1.7 exports an async setupGlobals() that installs navigator.gpu but
// does NOT shim HTMLCanvasElement. Callers needing a canvas use makeOffscreenCanvas(),
// which wires canvas.getContext("webgpu") to a real GPUCanvasContextMock.

// IMPORTANT: GPU tests using bun-webgpu must pass `surfaceFormat: "linear"` to
// `gpu.requestContext(canvas, ...)`. The bun-webgpu mock drops the `viewFormats`
// array configured on the canvas context, so the engine's default sRGB surface
// format causes `createView({ format: "bgra8unorm-srgb" })` to fail validation.
//
// This means sRGB-specific code paths are NOT exercised in unit tests under
// bun-webgpu; coverage for the production surface format comes from manual
// Safari / Chrome runs of hello-world and the cookbook demos. See
// `docs/reference/engine-conventions.md` for the color-space convention.

let _setup: Promise<boolean> | null = null;
let _availableSync = false;

async function trySetup(): Promise<boolean> {
  try {
    const mod = await import("bun-webgpu");
    if (typeof mod.setupGlobals !== "function") return false;
    await mod.setupGlobals();
    const ok = typeof navigator !== "undefined" && !!navigator.gpu;
    _availableSync = ok;
    return ok;
  } catch {
    return false;
  }
}

/**
 * Synchronous availability check used by test.skipIf at module top-level.
 * Returns false until ensureBunWebGpu() has resolved successfully; the first
 * .gpu.test.ts run will therefore skip. Tests that want to hot-init the
 * fixture should call ensureBunWebGpu() inside the test body.
 */
export function bunWebGpuAvailable(): boolean {
  return _availableSync;
}

/**
 * Eagerly initialize the bun-webgpu globals. Returns true if navigator.gpu is now usable.
 * Idempotent.
 */
export function ensureBunWebGpu(): Promise<boolean> {
  if (_setup) return _setup;
  _setup = trySetup();
  return _setup;
}

/**
 * Construct a canvas-shaped object whose getContext("webgpu") returns a real
 * bun-webgpu GPUCanvasContextMock. Throws if bun-webgpu isn't available — callers
 * should gate on ensureBunWebGpu() / bunWebGpuAvailable() before invoking.
 */
export async function makeOffscreenCanvas(
  width = 800,
  height = 600,
): Promise<HTMLCanvasElement> {
  const ok = await ensureBunWebGpu();
  if (!ok) throw new Error("bun-webgpu not available");
  const mod = await import("bun-webgpu");
  const mockCtx = new mod.GPUCanvasContextMock(
    {
      width,
      height,
      clientWidth: width,
      clientHeight: height,
    } as unknown as HTMLCanvasElement,
    width,
    height,
  );
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext(kind: string) {
      return kind === "webgpu"
        ? (mockCtx as unknown as GPUCanvasContext)
        : null;
    },
  } as unknown as HTMLCanvasElement;
  return canvas;
}
