import type { Context } from "./context-types.ts";
import { FurnaceGpuError } from "./errors.ts";
import { markDisposed } from "./internal.ts";

export type RequestContextOptions = {
  surfaceFormat?: "srgb" | "linear";
  pixelRatio?: "device" | "css" | number;
};

// Boundary type — extends InternalState with module-private fields gpu/context.ts
// installs and reads back. Keeps these fields out of the public InternalState shape
// while letting the same module that wrote them read them back via a localised cast.
type InternalWithCanvasCtx = {
  disposed: boolean;
  canvasContext: GPUCanvasContext;
  viewFormat: GPUTextureFormat;
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
  const viewFormat = resolveViewFormat(
    baseFormat,
    options.surfaceFormat ?? "srgb",
  );

  // The WebGPU spec restricts GPUCanvasContext.configure({ format }) to the
  // canonical unorm/float formats (no -srgb variant). sRGB encoding happens via
  // a viewFormat applied when we createView on each swapchain texture.
  const needsSrgbView = viewFormat !== baseFormat;
  canvasContext.configure({
    device,
    format: baseFormat,
    alphaMode: "premultiplied",
    viewFormats: needsSrgbView ? [viewFormat] : [],
  });

  const internal: InternalWithCanvasCtx = {
    disposed: false,
    canvasContext,
    viewFormat,
  };

  return Object.freeze({
    device,
    queue: device.queue,
    format: viewFormat,
    canvas,
    pixelRatio: dpr,
    _internal: internal,
  });
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
  // Boundary cast: requestContext installs canvasContext and viewFormat on _internal;
  // type system can't track field installation across the public InternalState boundary.
  const internal = ctx._internal as unknown as InternalWithCanvasCtx;
  return internal.canvasContext
    .getCurrentTexture()
    .createView({ format: internal.viewFormat });
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

function resolveViewFormat(
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
