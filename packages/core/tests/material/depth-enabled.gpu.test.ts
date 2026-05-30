import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { _resolveMaterial } from "../../src/material/internal.ts";
import { create } from "../../src/material/material.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const WGSL = `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
struct VsIn { @location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32> };
@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
`;

test.skipIf(!bunWebGpuAvailable())(
  "depthEnabled defaults to true",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
    });
    const mat = await create(ctx, { vertex: WGSL, fragment: WGSL });
    expect(_resolveMaterial(ctx, mat).depthEnabled).toBe(true);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "depthEnabled:false builds a depth-less pipeline",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
    });
    const mat = await create(ctx, {
      vertex: WGSL,
      fragment: WGSL,
      depthEnabled: false,
    });
    expect(_resolveMaterial(ctx, mat).depthEnabled).toBe(false);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "depthEnabled:false materials differing only in depthWrite share one pipeline (key normalized)",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
    });
    const a = await create(ctx, {
      vertex: WGSL,
      fragment: WGSL,
      depthEnabled: false,
      depthWrite: true,
    });
    const b = await create(ctx, {
      vertex: WGSL,
      fragment: WGSL,
      depthEnabled: false,
      depthWrite: false,
    });
    expect(_resolveMaterial(ctx, a).pipeline).toBe(
      _resolveMaterial(ctx, b).pipeline,
    );
    gpu.dispose(ctx);
  },
);
