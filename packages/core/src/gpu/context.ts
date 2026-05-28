import { error, warn } from "../log/internal.ts";
import { disposeAllResources } from "../resources/dispose.ts";
import {
  createResourceManager,
  type ResourceManager,
} from "../resources/manager.ts";
import {
  _recordDeviceLost,
  _recordUncapturedError,
} from "../stats/internal.ts";
import { createStatsState, type StatsState } from "../stats/state.ts";
import type { Context } from "./context-types.ts";
import { _emitDeviceLost } from "./device-lost.ts";
import { _runDisposeCascade } from "./dispose-cascade.ts";
import { FurnaceGpuError } from "./errors.ts";
import { _nextContextId, markDisposed } from "./internal.ts";
import { _emitUncapturedError } from "./uncaptured-error.ts";

/**
 * Options accepted by {@link requestContext}.
 *
 * Defaults: `surfaceFormat: "srgb"`, `pixelRatio: "device"`.
 *
 * - `surfaceFormat`: `"srgb"` configures an sRGB *view* over the canonical
 *   unorm swapchain format, so shaders write linear values and the swap-chain
 *   does the linear→sRGB encoding on present. `"linear"` skips the sRGB view
 *   — useful when the consumer wants to manage gamma themselves.
 * - `pixelRatio`: `"device"` uses `globalThis.devicePixelRatio` (sharp on
 *   high-DPI displays), `"css"` pins to 1 (CSS pixels = backing-store pixels,
 *   cheaper to render), or a literal number for explicit DPR control.
 *   See `engine-conventions.md` §"Device pixel ratio".
 */
export type RequestContextOptions = {
  surfaceFormat?: "srgb" | "linear";
  pixelRatio?: "device" | "css" | number;
};

// Boundary type — extends InternalState with module-private fields gpu/context.ts
// installs and reads back. Keeps these fields out of the public InternalState shape
// while letting the same module that wrote them read them back via a localised cast.
type InternalWithCanvasCtx = {
  disposed: boolean;
  stats: StatsState;
  resources: ResourceManager;
  ctxId: number;
  canvasContext: GPUCanvasContext;
  viewFormat: GPUTextureFormat;
};

/**
 * Acquire a WebGPU adapter + device, configure `canvas` for presentation,
 * and return the frozen {@link Context} every other `@furnace/core` module
 * takes as its first argument.
 *
 * Sizes the canvas backing store to `clientWidth/clientHeight * pixelRatio`
 * once at acquisition; ongoing layout changes are handled by `onResize`.
 * Installs an `uncapturederror` handler on the device that records into
 * stats and routes to the engine log helper (see `@furnace/core/log`) at
 * `error` level — async GPU validation errors surface there rather than
 * as thrown exceptions. Also attaches a `device.lost` promise handler that
 * records the loss in stats, emits it via {@link onDeviceLost} subscribers,
 * and logs at `error` level; the handler no-ops when the context was
 * disposed via {@link dispose} (expected teardown, not a runtime failure).
 *
 * Setup-loud per the foreground failure policy
 * (`engine-conventions.md` §"Failure policy").
 *
 * @throws FurnaceGpuError - if WebGPU is unavailable (`navigator.gpu`
 * missing, no adapter, no `webgpu` canvas context).
 * @throws FurnaceGpuError - if `options.pixelRatio` is provided as a
 *   number and is not a positive finite value.
 */
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
    stats: createStatsState(performance.now()),
    resources: createResourceManager(),
    ctxId: _nextContextId(),
    canvasContext,
    viewFormat,
  };

  const ctx = Object.freeze({
    device,
    queue: device.queue,
    format: viewFormat,
    canvas,
    pixelRatio: dpr,
    _internal: internal,
  });

  // No disposed-check: GPU errors that arrived before dispose() are still
  // real and worth surfacing. Contrast device.lost, where reason "destroyed"
  // is the expected outcome of dispose() and must be filtered.
  device.addEventListener("uncapturederror", (e) => {
    // Boundary cast: DOM addEventListener types the event as `Event`; the
    // "uncapturederror" name guarantees a GPUUncapturedErrorEvent at runtime.
    const evt = e as GPUUncapturedErrorEvent;
    _recordUncapturedError(ctx);
    _emitUncapturedError(ctx, evt.error);
    error("gpu", "uncaptured device error", evt.error.message);
  });

  device.lost.then((info) => {
    if (ctx._internal.disposed) return;
    _recordDeviceLost(ctx);
    _emitDeviceLost(ctx, info);
    try {
      error("gpu", "device lost", info.reason, info.message);
    } catch {
      // Sink threw while logging device-lost. Swallow to avoid unhandled
      // promise rejection from this async continuation.
    }
  });

  return ctx;
}

/**
 * Tear down a context: mark it disposed, destroy the underlying `GPUDevice`,
 * and clear internal bookkeeping. Idempotent — calling on an already-disposed
 * ctx is a no-op.
 *
 * Routes a warning to the engine log helper (see `@furnace/core/log`) at
 * `warn` level if any engine resources (meshes, materials, geometries,
 * effects, buffers, textures) are still registered when called; the
 * entry's `rest` carries the count as `{ remaining: N }`. That's the leak
 * signal: in well-behaved teardown the consumer destroys owned resources
 * before calling `dispose`.
 *
 * After `dispose`, `isDisposed(ctx)` returns `true` and foreground APIs that
 * take a `Context` throw `FurnaceGpuError`; background reads return zero /
 * null defaults (see `engine-conventions.md` §"Failure policy").
 */
export function dispose(ctx: Context): void {
  if (ctx._internal.disposed) return;
  _runDisposeCascade(ctx);
  disposeAllResources(ctx);
  const r = ctx._internal.stats.resources;
  const remaining =
    r.counts.meshes +
    r.counts.materials +
    r.counts.geometries +
    r.counts.effects;
  if (remaining > 0) {
    warn(
      "gpu",
      "context disposed with resources still registered — leak suspected",
      { remaining },
    );
  }
  markDisposed(ctx._internal);
  try {
    ctx.device.destroy();
  } catch {
    // Some implementations may not implement destroy yet; safe to swallow on idempotent dispose.
  }
}

/**
 * `true` after {@link dispose} has been called on `ctx`, `false` otherwise.
 */
export function isDisposed(ctx: Context): boolean {
  return ctx._internal.disposed;
}

/**
 * Return a `GPUTextureView` on the current swap-chain texture, with the
 * configured sRGB view format applied (see {@link Context} `format`).
 *
 * Escape hatch for consumers writing their own render pass — most callers
 * go through `frame.render`, which handles the view, depth attachment, and
 * post chain. Each call invokes `getCurrentTexture()` on the underlying
 * `GPUCanvasContext` and creates a fresh view.
 *
 * @throws FurnaceGpuError - if `ctx` has been disposed.
 */
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
  if (!Number.isFinite(option) || option <= 0) {
    throw new FurnaceGpuError(
      `requestContext: pixelRatio must be a positive finite number, "device", or "css"; got ${option}`,
    );
  }
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
