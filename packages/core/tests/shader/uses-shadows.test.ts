import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as shader from "../../src/shader/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const SRC = `@vertex fn vs_main() -> @builtin(position) vec4<f32> {
  return vec4<f32>(0,0,0,1);
}
@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1); }`;

test.skipIf(!bunWebGpuAvailable())("usesShadows flag round-trips", async () => {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const s = await shader.create(ctx, SRC, { usesShadows: true });
  expect(shader._usesShadowsOf(ctx, s)).toBe(true);
  const s2 = await shader.create(ctx, SRC);
  expect(shader._usesShadowsOf(ctx, s2)).toBe(false);
  gpu.dispose(ctx);
});
