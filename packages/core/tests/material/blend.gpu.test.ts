import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const SHADER = `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};
@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}`;

const PREMULTIPLIED: GPUBlendState = {
  color: {
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
  alpha: {
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
};

test.skipIf(!bunWebGpuAvailable())(
  "materials with differing blend produce distinct pipelineKey",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    const opaque = await material.create(ctx, {
      vertex: SHADER,
      fragment: SHADER,
    });
    const blended = await material.create(ctx, {
      vertex: SHADER,
      fragment: SHADER,
      blend: PREMULTIPLIED,
    });

    expect(opaque.pipelineKey).not.toBe(blended.pipelineKey);

    material.destroy(opaque);
    material.destroy(blended);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "two materials with identical blend share the cached pipeline",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    const a = await material.create(ctx, {
      vertex: SHADER,
      fragment: SHADER,
      blend: PREMULTIPLIED,
    });
    const b = await material.create(ctx, {
      vertex: SHADER,
      fragment: SHADER,
      blend: PREMULTIPLIED,
    });

    expect(a.pipelineKey).toBe(b.pipelineKey);
    expect(a.pipeline).toBe(b.pipeline);

    material.destroy(a);
    material.destroy(b);
    gpu.dispose(ctx);
  },
);
