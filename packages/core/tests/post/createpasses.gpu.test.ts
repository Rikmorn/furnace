import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as meshMod from "../../src/mesh/index.ts";
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

const PASS = /* wgsl */ `
struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> { return textureSample(tex, samp, in.uv); }
`;

test.skipIf(!bunWebGpuAvailable())(
  "createPasses 2-pass (scene→named→swapchain) renders one clean frame",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
    });
    const sh = await shader.create(ctx, PASS);
    const fx = await post.createPasses(ctx, {
      passes: [
        { shader: sh, inputs: ["scene"], output: { intermediate: "tmp" } },
        { shader: sh, inputs: [{ intermediate: "tmp" }], output: {} },
      ],
    });
    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const m = meshMod.create(ctx, { geometry: geometry.cube(ctx), material });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [m], camera: cam, effects: [fx] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createPasses validates empty passes + unknown intermediate",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
    });
    const sh = await shader.create(ctx, PASS);
    await expect(post.createPasses(ctx, { passes: [] })).rejects.toThrow(
      /at least one pass|needs at least/,
    );
    await expect(
      post.createPasses(ctx, {
        passes: [
          { shader: sh, inputs: [{ intermediate: "missing" }], output: {} },
        ],
      }),
    ).rejects.toThrow(/missing/);
    gpu.dispose(ctx);
  },
);
