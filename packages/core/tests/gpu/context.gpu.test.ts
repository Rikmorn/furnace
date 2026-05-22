import { expect, test } from "bun:test";
import type { Context } from "../../src/gpu/context-types.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

const skip = !bunWebGpuAvailable();

// gpu/context.ts is resolved at runtime (not statically) so dynamic imports stay
// off the typechecker's static graph. Tests skip cleanly when bun-webgpu isn't available.
const CONTEXT_MODULE = "../../src/gpu/context.ts";

type RequestContextOptions = {
  surfaceFormat?: "srgb" | "linear";
  pixelRatio?: "device" | "css" | number;
};
type ContextModule = {
  requestContext: (
    canvas: HTMLCanvasElement,
    options?: RequestContextOptions,
  ) => Promise<Context>;
  dispose: (ctx: Context) => void;
  isDisposed: (ctx: Context) => boolean;
  getCurrentTextureView: (ctx: Context) => GPUTextureView;
};

async function loadContextModule(): Promise<ContextModule> {
  return (await import(CONTEXT_MODULE)) as ContextModule;
}

test.skipIf(skip)("requestContext returns a usable Context", async () => {
  await ensureBunWebGpu();
  const { requestContext, isDisposed, dispose } = await loadContextModule();

  const canvas = await makeOffscreenCanvas();
  const ctx = await requestContext(canvas);

  expect(ctx.device).toBeDefined();
  expect(ctx.queue).toBeDefined();
  expect(ctx.format).toMatch(/-srgb$/);
  expect(ctx.canvas).toBe(canvas);
  expect(ctx.pixelRatio).toBeGreaterThan(0);
  expect(isDisposed(ctx)).toBe(false);

  dispose(ctx);
});

test.skipIf(skip)(
  "surfaceFormat: 'linear' yields a non-sRGB format",
  async () => {
    await ensureBunWebGpu();
    const { requestContext, dispose } = await loadContextModule();

    const canvas = await makeOffscreenCanvas();
    const ctx = await requestContext(canvas, { surfaceFormat: "linear" });

    expect(ctx.format).not.toMatch(/-srgb$/);

    dispose(ctx);
  },
);

test.skipIf(skip)("pixelRatio: 'css' uses 1; numeric is honored", async () => {
  await ensureBunWebGpu();
  const { requestContext, dispose } = await loadContextModule();

  const canvasA = await makeOffscreenCanvas();
  const ctxA = await requestContext(canvasA, { pixelRatio: "css" });
  expect(ctxA.pixelRatio).toBe(1);
  dispose(ctxA);

  const canvasB = await makeOffscreenCanvas();
  const ctxB = await requestContext(canvasB, { pixelRatio: 2 });
  expect(ctxB.pixelRatio).toBe(2);
  dispose(ctxB);
});
