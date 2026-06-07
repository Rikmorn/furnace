import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { _resolveMaterial } from "../../src/material/internal.ts";
import { create } from "../../src/material/material.ts";
import { create as createShader } from "../../src/shader/shader.ts";
import type { Shader } from "../../src/shader/types.ts";
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
  @group(2) @binding(0) var<uniform> object: Object;
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

const WGSL_WITH_GROUP1 = `
  struct Camera { viewProjection: mat4x4<f32> };
  struct Object { model: mat4x4<f32> };
  struct Mat { color: vec4<f32> };
  @group(0) @binding(0) var<uniform> camera: Camera;
  @group(2) @binding(0) var<uniform> object: Object;
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

const ENTRY_WGSL = `
  struct Camera { viewProjection: mat4x4<f32> };
  struct Object { model: mat4x4<f32> };
  @group(0) @binding(0) var<uniform> camera: Camera;
  @group(2) @binding(0) var<uniform> object: Object;
  struct VsIn {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
  };
  @vertex fn my_vs(v: VsIn) -> @builtin(position) vec4<f32> {
    return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  }
  @fragment fn my_fs() -> @location(0) vec4<f32> {
    return vec4<f32>(0.0, 1.0, 0.0, 1.0);
  }
`;

test.skipIf(!bunWebGpuAvailable())(
  "material.create builds a Material with default state",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const sh = await createShader(ctx, TRIVIAL_WGSL);
    const mat = await create(ctx, { shader: sh });
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
    const colorBuffer = ctx.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    ctx.queue.writeBuffer(colorBuffer, 0, new Float32Array([1, 0, 0, 1]));
    const sh = await createShader(ctx, WGSL_WITH_GROUP1);
    const mat = await create(ctx, {
      shader: sh,
      bindings: [{ binding: 0, resource: { buffer: colorBuffer } }],
    });
    const slot = _resolveMaterial(ctx, mat);
    expect(slot.group1).not.toBe(null);
    expect(slot.ownedBuffers.length).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.create throws when shader is missing",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    await expect(
      create(ctx, {} as unknown as Parameters<typeof create>[1]),
    ).rejects.toThrow(/shader is required/);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.create throws when shader handle is invalid or destroyed",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    await expect(create(ctx, { shader: 999999 as Shader })).rejects.toThrow(
      /invalid or destroyed/,
    );
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "same shader handle + same state share one pipeline",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const sh = await createShader(ctx, TRIVIAL_WGSL);
    const a = await create(ctx, { shader: sh });
    const b = await create(ctx, { shader: sh });
    expect(_resolveMaterial(ctx, a).pipeline).toBe(
      _resolveMaterial(ctx, b).pipeline,
    );
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "two shaders of identical source produce two distinct pipelines (no source dedup)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const a = await create(ctx, {
      shader: await createShader(ctx, TRIVIAL_WGSL),
    });
    const b = await create(ctx, {
      shader: await createShader(ctx, TRIVIAL_WGSL),
    });
    expect(_resolveMaterial(ctx, a).pipeline).not.toBe(
      _resolveMaterial(ctx, b).pipeline,
    );
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "entryPoints override builds pipeline with custom entry names",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const esh = await createShader(ctx, ENTRY_WGSL);
    // Default vs_main/fs_main are absent — pipeline build should fail.
    await expect(create(ctx, { shader: esh })).rejects.toThrow();
    // Explicit override should succeed.
    const m = await create(ctx, {
      shader: esh,
      entryPoints: { vertex: "my_vs", fragment: "my_fs" },
    });
    expect(_resolveMaterial(ctx, m).pipeline).toBeDefined();
    gpu.dispose(ctx);
  },
);
