import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import * as shader from "./index.ts";
import { _usesShadowsOf } from "./shader.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "lit and texturedLit declare usesShadows; unlit does not",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    expect(_usesShadowsOf(ctx, await shader.lit(ctx))).toBe(true);
    expect(_usesShadowsOf(ctx, await shader.texturedLit(ctx))).toBe(true);
    expect(_usesShadowsOf(ctx, await shader.unlit(ctx))).toBe(false);
    gpu.dispose(ctx);
  },
);
