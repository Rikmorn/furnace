import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as shader from "../../src/shader/index.ts";
import { sceneBinding } from "../../src/shader/lighting.ts";
import {
  _cameraBinding,
  _objectBinding,
  _vsIn,
} from "../../src/shader/preamble.ts";
import { shadowHelpers } from "../../src/shader/shadows.ts";
import { toWgsl } from "../../src/shader/source.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test("shadowHelpers composes + dedups its sceneBinding dep once", () => {
  const wgsl = toWgsl(shader.source`${sceneBinding}${shadowHelpers}`);
  expect(wgsl.match(/struct Scene/g)?.length).toBe(1);
  expect(wgsl).toContain("fn fr_shadowFactor");
  expect(wgsl).toContain("sampler_comparison");
});

test.skipIf(!bunWebGpuAvailable())(
  "a shader composing shadowHelpers compiles",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const src = shader.source`${_cameraBinding}${_objectBinding}${_vsIn}${sceneBinding}${shadowHelpers}
@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(fr_shadowFactor(vec3<f32>(0.0), -1, 0.0));
}`;
    ctx.device.pushErrorScope("validation");
    const s = await shader.create(ctx, src, {
      usesScene: true,
      usesShadows: true,
    });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    expect(s).toBeTruthy();
    gpu.dispose(ctx);
  },
);
