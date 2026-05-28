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

const TRIVIAL_WGSL = `
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
  }
`;

test.skipIf(!bunWebGpuAvailable())(
  "material.create builds a Material with default state",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await create(ctx, {
      vertex: TRIVIAL_WGSL,
      fragment: TRIVIAL_WGSL,
    });
    const slot = _resolveMaterial(ctx, mat);
    expect(slot.pipeline).toBeDefined();
    expect(slot.cullMode).toBe("back");
    expect(slot.topology).toBe("triangle-list");
    expect(slot.depthWrite).toBe(true);
    expect(slot.depthCompare).toBe("less");
    expect(slot.group1).toBe(null);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.create with group-1 bindings builds group1",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const wgsl = `
      struct Camera { viewProjection: mat4x4<f32> };
      struct Object { model: mat4x4<f32> };
      struct Mat { color: vec4<f32> };
      @group(0) @binding(0) var<uniform> camera: Camera;
      @group(0) @binding(1) var<uniform> object: Object;
      @group(1) @binding(0) var<uniform> mat: Mat;
      struct VsIn {
        @location(0) position: vec3<f32>,
        @location(1) normal: vec3<f32>,
        @location(2) uv: vec2<f32>,
      };
      @vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
        return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
      }
      @fragment fn fs_main() -> @location(0) vec4<f32> { return mat.color; }
    `;
    const colorBuffer = ctx.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ctx.queue.writeBuffer(colorBuffer, 0, new Float32Array([1, 0, 0, 1]));
    const mat = await create(ctx, {
      vertex: wgsl,
      fragment: wgsl,
      bindings: [{ binding: 0, resource: { buffer: colorBuffer } }],
    });
    const slot = _resolveMaterial(ctx, mat);
    expect(slot.group1).not.toBe(null);
    expect(slot.ownedBuffers.length).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.create throws when vertex or fragment is empty",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    let threw = false;
    try {
      await create(ctx, { vertex: "", fragment: TRIVIAL_WGSL });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toMatch(/vertex.*fragment.*required/i);
    }
    expect(threw).toBe(true);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.create throws when shader fails to compile",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    let threw = false;
    try {
      await create(ctx, { vertex: "broken wgsl", fragment: "also broken" });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(Error);
    }
    expect(threw).toBe(true);
    gpu.dispose(ctx);
  },
);
