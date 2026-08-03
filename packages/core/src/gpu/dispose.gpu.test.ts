import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import type { Context } from "./context-types.ts";

await ensureBunWebGpu();

const skip = !bunWebGpuAvailable();

const CONTEXT_MODULE = "./context.ts";

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

test.skipIf(skip)("dispose marks the context as disposed", async () => {
  await ensureBunWebGpu();
  const { requestContext, dispose, isDisposed } = await loadContextModule();
  const canvas = await makeOffscreenCanvas();
  const ctx = await requestContext(canvas);
  expect(isDisposed(ctx)).toBe(false);
  dispose(ctx);
  expect(isDisposed(ctx)).toBe(true);
});

test.skipIf(skip)("dispose is idempotent", async () => {
  await ensureBunWebGpu();
  const { requestContext, dispose } = await loadContextModule();
  const canvas = await makeOffscreenCanvas();
  const ctx = await requestContext(canvas);
  dispose(ctx);
  expect(() => {
    dispose(ctx);
  }).not.toThrow();
});

test.skipIf(skip)("getCurrentTextureView throws after dispose", async () => {
  await ensureBunWebGpu();
  const { requestContext, dispose, getCurrentTextureView } =
    await loadContextModule();
  const canvas = await makeOffscreenCanvas();
  const ctx = await requestContext(canvas);
  dispose(ctx);
  expect(() => getCurrentTextureView(ctx)).toThrow(/disposed/);
});
