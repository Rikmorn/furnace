import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as post from "../../src/post/index.ts";
import * as shader from "../../src/shader/index.ts";
import { vec3, vec4 } from "../../src/transform/index.ts";
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

async function makeHdrScene(): Promise<{
  ctx: gpu.Context;
  cam: camera.Camera;
  cube: mesh.Mesh;
}> {
  const canvas = await makeOffscreenCanvas(64, 64);
  const ctx = await gpu.requestContext(canvas, {
    surfaceFormat: "linear",
    hdr: true,
  });
  const cam = camera.perspective({
    aspect: 1,
    position: vec3.fromValues(0, 0, 3),
  });
  const { material: mat } = await makeUnlitMaterial(
    ctx,
    vec4.fromValues(1, 0, 0, 1),
  );
  const cubeGeo = geometry.cube(ctx);
  const cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });
  return { ctx, cam, cube };
}

test.skipIf(!bunWebGpuAvailable())(
  "hdr on + empty effects → throws /hdr/",
  async () => {
    const { ctx, cam, cube } = await makeHdrScene();
    expect(() => frame.render(ctx, { meshes: [cube], camera: cam })).toThrow(
      /hdr/,
    );
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "hdr on + ONE passthrough effect → renders one clean frame",
  async () => {
    const { ctx, cam, cube } = await makeHdrScene();
    const fx = await post.create(ctx, {
      shader: await shader.create(ctx, PASSTHROUGH_WGSL),
    });
    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [cube], camera: cam, effects: [fx] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();
    post.destroy(ctx, fx);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "hdr on + MORE THAN ONE effect → setup-loud throw (multi-effect HDR is Stage 2b)",
  async () => {
    const { ctx, cam, cube } = await makeHdrScene();
    const fxA = await post.create(ctx, {
      shader: await shader.create(ctx, PASSTHROUGH_WGSL),
    });
    const fxB = await post.create(ctx, {
      shader: await shader.create(ctx, PASSTHROUGH_WGSL),
    });
    expect(() =>
      frame.render(ctx, { meshes: [cube], camera: cam, effects: [fxA, fxB] }),
    ).toThrow(/single effect|multi-effect|Stage 2b/);
    post.destroy(ctx, fxA);
    post.destroy(ctx, fxB);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "hdr on + MSAA (sampleCount 4) + ONE passthrough effect → renders one clean frame",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      hdr: true,
      sampleCount: 4,
    });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    const { material: mat } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(0, 1, 0, 1),
    );
    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });
    const fx = await post.create(ctx, {
      shader: await shader.create(ctx, PASSTHROUGH_WGSL),
    });
    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [cube], camera: cam, effects: [fx] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();
    post.destroy(ctx, fx);
    gpu.dispose(ctx);
  },
);
