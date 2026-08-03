import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import type { Context } from "../gpu/context-types.ts";

await ensureBunWebGpu();

const skip = !bunWebGpuAvailable();

// gpu/context.ts and frame/encode.ts are resolved at runtime (not statically) so
// the dynamic imports below stay off the typechecker's static graph. Tests skip
// cleanly when bun-webgpu isn't available.
const CONTEXT_MODULE = "../gpu/context.ts";
const ENCODE_MODULE = "./encode.ts";

type ContextModule = {
  requestContext: (canvas: HTMLCanvasElement) => Promise<Context>;
  dispose: (ctx: Context) => void;
};
type EncodeModule = {
  encode: (ctx: Context, cb: (encoder: GPUCommandEncoder) => void) => void;
};

async function loadModules(): Promise<{
  requestContext: ContextModule["requestContext"];
  dispose: ContextModule["dispose"];
  encode: EncodeModule["encode"];
}> {
  const ctxMod = (await import(CONTEXT_MODULE)) as ContextModule;
  const encMod = (await import(ENCODE_MODULE)) as EncodeModule;
  return {
    requestContext: ctxMod.requestContext,
    dispose: ctxMod.dispose,
    encode: encMod.encode,
  };
}

test.skipIf(skip)(
  "encode receives a valid GPUCommandEncoder and submits",
  async () => {
    await ensureBunWebGpu();
    const { requestContext, dispose, encode } = await loadModules();

    const canvas = await makeOffscreenCanvas();
    const ctx = await requestContext(canvas);

    let encoderReceived: GPUCommandEncoder | null = null;
    encode(ctx, (encoder) => {
      encoderReceived = encoder;
    });

    expect(encoderReceived).not.toBeNull();
    dispose(ctx);
  },
);

test.skipIf(skip)("encode throws on disposed context", async () => {
  await ensureBunWebGpu();
  const { requestContext, dispose, encode } = await loadModules();

  const canvas = await makeOffscreenCanvas();
  const ctx = await requestContext(canvas);
  dispose(ctx);

  expect(() =>
    encode(ctx, () => {
      /* no-op */
    }),
  ).toThrow(/disposed/);
});

test.skipIf(skip)("encode throws when callback is null", async () => {
  await ensureBunWebGpu();
  const { requestContext, dispose, encode } = await loadModules();

  const canvas = await makeOffscreenCanvas();
  const ctx = await requestContext(canvas);

  expect(() =>
    encode(ctx, null as unknown as (encoder: GPUCommandEncoder) => void),
  ).toThrow("callback must be a function");

  dispose(ctx);
});

test.skipIf(skip)("encode throws when callback is not a function", async () => {
  await ensureBunWebGpu();
  const { requestContext, dispose, encode } = await loadModules();

  const canvas = await makeOffscreenCanvas();
  const ctx = await requestContext(canvas);

  expect(() =>
    encode(ctx, 42 as unknown as (encoder: GPUCommandEncoder) => void),
  ).toThrow("callback must be a function");

  dispose(ctx);
});
