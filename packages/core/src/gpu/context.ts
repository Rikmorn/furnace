import type { Context } from "./context-types.ts";
import { FurnaceGpuError } from "./errors.ts";
import { createInternalState, markDisposed } from "./internal.ts";

export type RequestContextOptions = {
  surfaceFormat?: "srgb" | "linear";
  pixelRatio?: "device" | "css" | number;
};

// Stash the WebGPU canvas context on the internal state so getCurrentTextureView can reach it.
// Cast through unknown keeps the canvasContext field out of the public InternalState shape.
type InternalWithCanvasCtx = {
  disposed: boolean;
  canvasContext: GPUCanvasContext;
};

export async function requestContext(
  canvas: HTMLCanvasElement,
  options: RequestContextOptions = {},
): Promise<Context> {
  if (!navigator.gpu) {
    throw new FurnaceGpuError(
      "WebGPU unavailable. Need a recent Chrome/Safari/Firefox, or macOS Tahoe 26+ inside the native webview.",
    );
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new FurnaceGpuError(
      "WebGPU adapter not available. GPU may not be supported.",
    );
  }

  const device = await adapter.requestDevice();

  const canvasContext = canvas.getContext("webgpu");
  if (!canvasContext) {
    throw new FurnaceGpuError("Could not get WebGPU canvas context.");
  }

  const dpr = resolvePixelRatio(options.pixelRatio);
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);

  const baseFormat = navigator.gpu.getPreferredCanvasFormat();
  const format = applySurfaceFormat(
    baseFormat,
    options.surfaceFormat ?? "srgb",
  );

  canvasContext.configure({ device, format, alphaMode: "premultiplied" });

  const internal = createInternalState() as unknown as InternalWithCanvasCtx;
  internal.canvasContext = canvasContext;

  return Object.freeze({
    device,
    queue: device.queue,
    format,
    canvas,
    pixelRatio: dpr,
    _internal: internal,
  } as unknown as Context);
}

export function dispose(ctx: Context): void {
  if (ctx._internal.disposed) return;
  markDisposed(ctx._internal);
  try {
    ctx.device.destroy();
  } catch {
    // Some implementations may not implement destroy yet; safe to swallow on idempotent dispose.
  }
}

export function isDisposed(ctx: Context): boolean {
  return ctx._internal.disposed;
}

export function getCurrentTextureView(ctx: Context): GPUTextureView {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("context disposed");
  }
  const internal = ctx._internal as unknown as InternalWithCanvasCtx;
  return internal.canvasContext.getCurrentTexture().createView();
}

function resolvePixelRatio(
  option: RequestContextOptions["pixelRatio"],
): number {
  if (option == null || option === "device") {
    return globalThis.devicePixelRatio || 1;
  }
  if (option === "css") return 1;
  return option;
}

function applySurfaceFormat(
  baseFormat: GPUTextureFormat,
  choice: "srgb" | "linear",
): GPUTextureFormat {
  const isAlreadySrgb = baseFormat.endsWith("-srgb");
  if (choice === "srgb") {
    return isAlreadySrgb
      ? baseFormat
      : (`${baseFormat}-srgb` as GPUTextureFormat);
  }
  return isAlreadySrgb
    ? (baseFormat.replace("-srgb", "") as GPUTextureFormat)
    : baseFormat;
}
