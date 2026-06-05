import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as shader from "../../src/shader/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const TEXTURED_WGSL = /* wgsl */ `
@group(0) @binding(0) var<uniform> camera: mat4x4<f32>;
@group(0) @binding(1) var<uniform> object: mat4x4<f32>;
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;
struct VsIn { @location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32> };
struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.pos = camera * object * vec4<f32>(v.position, 1.0);
  out.uv = v.uv;
  return out;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, in.uv);
}
`;

test.skipIf(!bunWebGpuAvailable())(
  "shader.create with textureBinding:true sets the slot flag; default is false",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const withTex = await shader.create(ctx, TEXTURED_WGSL, {
      textureBinding: true,
    });
    expect(shader._textureBindingOf(ctx, withTex)).toBe(true);
    // A shader created without the flag defaults to false.
    const plain = await shader.normalColor(ctx);
    expect(shader._textureBindingOf(ctx, plain)).toBe(false);
    shader.destroy(ctx, withTex);
    gpu.dispose(ctx);
  },
);
