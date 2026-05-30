import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { _resolveMaterial } from "../../src/material/internal.ts";
import { create, destroy } from "../../src/material/material.ts";
import { unlit } from "../../src/material/unlit.ts";
import { create as createShader } from "../../src/shader/shader.ts";
import { vec4 } from "../../src/transform/vec4.ts";
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
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const sh = await createShader(ctx, WGSL);
    const mat1 = await create(ctx, { shader: sh });
    const mat2 = await create(ctx, { shader: sh });
    const slot1 = _resolveMaterial(ctx, mat1);
    const slot2 = _resolveMaterial(ctx, mat2);
    expect(slot1.pipelineKey).toBe(slot2.pipelineKey);
    expect(slot1.pipeline).toBe(slot2.pipeline);
    const sharedPipeline = slot1.pipeline;
    destroy(ctx, mat1);
    // mat2 still holds a reference; second destroy fully evicts.
    destroy(ctx, mat2);
    // After both destroyed, a fresh create rebuilds the pipeline (different identity).
    const mat3 = await create(ctx, { shader: sh });
    const slot3 = _resolveMaterial(ctx, mat3);
    expect(slot3.pipeline).not.toBe(sharedPipeline);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.destroy on a built-in unlit material releases the owned color buffer",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: vec4.fromValues(1, 0, 0, 1) });
    const slot = _resolveMaterial(ctx, mat);
    const buffer = slot.ownedBuffers[0];
    expect(buffer).toBeDefined();
    destroy(ctx, mat);
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
