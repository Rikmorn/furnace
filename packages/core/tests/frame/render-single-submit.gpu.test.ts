import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as post from "../../src/post/index.ts";
import * as shader from "../../src/shader/index.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { makeUnlitMaterial } from "../_helpers/unlit-material.ts";

await ensureBunWebGpu();

const PASSTHROUGH_WGSL = `
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSamp: sampler;
struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(sceneTex, sceneSamp, in.uv);
}`;

async function makeScene(): Promise<{
  ctx: gpu.Context;
  cam: camera.Camera;
  cube: mesh.Mesh;
}> {
  const canvas = await makeOffscreenCanvas(64, 64);
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const cam = camera.perspective({ aspect: 1 });
  const { material: mat } = await makeUnlitMaterial(
    ctx,
    vec4.fromValues(1, 0, 0, 1),
  );
  const cubeGeo = geometry.cube(ctx);
  const cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });
  return { ctx, cam, cube };
}

test.skipIf(!bunWebGpuAvailable())(
  "scene + 2 passthrough effects: exactly one queue.submit per render",
  async () => {
    const { ctx, cam, cube } = await makeScene();

    const realSubmit = ctx.queue.submit.bind(ctx.queue);
    let calls = 0;
    (ctx.queue as unknown as { submit: GPUQueue["submit"] }).submit = (
      ...a: Parameters<GPUQueue["submit"]>
    ) => {
      calls++;
      return realSubmit(...a);
    };

    const fx1 = await post.create(ctx, {
      shader: await shader.create(ctx, PASSTHROUGH_WGSL),
    });
    const fx2 = await post.create(ctx, {
      shader: await shader.create(ctx, PASSTHROUGH_WGSL),
    });

    await ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [cube], camera: cam, effects: [fx1, fx2] });
    const err = await ctx.device.popErrorScope();

    expect(err).toBeNull();
    expect(calls).toBe(1);

    ctx.queue.submit = realSubmit;
    post.destroy(ctx, fx1);
    post.destroy(ctx, fx2);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "scene with no effects: exactly one queue.submit per render",
  async () => {
    const { ctx, cam, cube } = await makeScene();

    const realSubmit = ctx.queue.submit.bind(ctx.queue);
    let calls = 0;
    (ctx.queue as unknown as { submit: GPUQueue["submit"] }).submit = (
      ...a: Parameters<GPUQueue["submit"]>
    ) => {
      calls++;
      return realSubmit(...a);
    };

    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [cube], camera: cam });
    const err = await ctx.device.popErrorScope();

    expect(err).toBeNull();
    expect(calls).toBe(1);

    ctx.queue.submit = realSubmit;
    gpu.dispose(ctx);
  },
);
