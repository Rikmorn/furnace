import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as post from "../../src/post/index.ts";
import * as stats from "../../src/stats/index.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { makeUnlitMaterial } from "../_helpers/unlit-material.ts";

await ensureBunWebGpu();

const IDENTITY_EFFECT = `
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSamp: sampler;
struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(sceneTex, sceneSamp, in.uv);
}`;

async function tinyScene(): Promise<{
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
  "render with empty effects array behaves identically to no effects",
  async () => {
    const { ctx, cam, cube } = await tinyScene();
    expect(() =>
      frame.render(ctx, { draw: [cube], camera: cam, effects: [] }),
    ).not.toThrow();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "render with one effect: drawCalls === meshCount + 1",
  async () => {
    const { ctx, cam, cube } = await tinyScene();
    const fx = await post.create(ctx, { shader: IDENTITY_EFFECT });
    frame.render(ctx, { draw: [cube], camera: cam, effects: [fx] });
    expect(stats.snapshot(ctx).gpu.drawCalls).toBe(2);
    post.destroy(ctx, fx);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "render with two effects: drawCalls === meshCount + 2",
  async () => {
    const { ctx, cam, cube } = await tinyScene();
    const fx1 = await post.create(ctx, { shader: IDENTITY_EFFECT });
    const fx2 = await post.create(ctx, { shader: IDENTITY_EFFECT });
    frame.render(ctx, { draw: [cube], camera: cam, effects: [fx1, fx2] });
    expect(stats.snapshot(ctx).gpu.drawCalls).toBe(3);
    post.destroy(ctx, fx1);
    post.destroy(ctx, fx2);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "ctx-mismatched effect throws naming the offending index",
  async () => {
    const a = await tinyScene();
    const b = await tinyScene();
    const fxA = await post.create(a.ctx, { shader: IDENTITY_EFFECT });
    expect(() =>
      frame.render(b.ctx, { draw: [b.cube], camera: b.cam, effects: [fxA] }),
    ).toThrow(/effects\[0\]/);
    post.destroy(a.ctx, fxA);
    gpu.dispose(a.ctx);
    gpu.dispose(b.ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "destroyed effect throws naming the offending index",
  async () => {
    const { ctx, cam, cube } = await tinyScene();
    const fx = await post.create(ctx, { shader: IDENTITY_EFFECT });
    post.destroy(ctx, fx);
    expect(() =>
      frame.render(ctx, { draw: [cube], camera: cam, effects: [fx] }),
    ).toThrow(/effects\[0\]/);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "null in effects array throws naming the offending index",
  async () => {
    const { ctx, cam, cube } = await tinyScene();
    const fx = await post.create(ctx, { shader: IDENTITY_EFFECT });
    expect(() =>
      frame.render(ctx, {
        draw: [cube],
        camera: cam,
        effects: [fx, null] as unknown as post.Effect[],
      }),
    ).toThrow(/effects\[1\]/);
    post.destroy(ctx, fx);
    gpu.dispose(ctx);
  },
);
