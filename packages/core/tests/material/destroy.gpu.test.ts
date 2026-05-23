import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { create, destroy } from "../../src/material/material.ts";
import { _pipelineCache } from "../../src/material/pipeline.ts";
import { unlit } from "../../src/material/unlit.ts";
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
  struct VsIn {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
  };
  @vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
    return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  }
  @fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }
`;

test.skipIf(!bunWebGpuAvailable())(
  "material.destroy releases the pipeline refcount; two same-descriptor materials share the cache entry",
  async () => {
    _pipelineCache.resetForTests();
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat1 = await create(ctx, { vertex: WGSL, fragment: WGSL });
    const mat2 = await create(ctx, { vertex: WGSL, fragment: WGSL });
    expect(mat1.pipelineKey).toBe(mat2.pipelineKey);
    expect(mat1.pipeline).toBe(mat2.pipeline);
    destroy(mat1);
    // mat2 still holds a reference; second destroy fully evicts.
    destroy(mat2);
    // After both destroyed, a fresh create rebuilds the pipeline (different identity).
    const mat3 = await create(ctx, { vertex: WGSL, fragment: WGSL });
    expect(mat3.pipeline).not.toBe(mat1.pipeline);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.destroy on a built-in unlit material releases the owned color buffer",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: [1, 0, 0, 1] });
    const buffer = mat.ownedBuffers[0];
    expect(buffer).toBeDefined();
    destroy(mat);
    // We can't observe destroy via the WebGPU API directly (no isDestroyed query).
    // Indirect check: writing to the buffer should fail with validation error.
    ctx.device.pushErrorScope("validation");
    ctx.queue.writeBuffer(
      buffer as GPUBuffer,
      0,
      new Float32Array([0, 0, 0, 1]),
    );
    const err = await ctx.device.popErrorScope();
    expect(err).not.toBe(null);
    gpu.dispose(ctx);
  },
);
