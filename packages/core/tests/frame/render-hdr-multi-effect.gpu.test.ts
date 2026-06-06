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

const PASSTHROUGH = /* wgsl */ `
struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> { return textureSample(tex, samp, in.uv); }
`;

test.skipIf(!bunWebGpuAvailable())(
  "hdr + two single-pass effects render one clean frame (guard relaxed)",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
      hdr: true,
    });
    const sh = await shader.create(ctx, PASSTHROUGH);
    const fxA = await post.create(ctx, { shader: sh });
    const fxB = await post.tonemap(ctx); // final effect → swapchain (ctx.format)
    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(2, 2, 2, 1),
    );
    const m = meshMod.create(ctx, { geometry: geometry.cube(ctx), material });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [m], camera: cam, effects: [fxA, fxB] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();
    gpu.dispose(ctx);
  },
);
