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

// Single-input copy: @binding(0) = texture, @binding(1) = sampler.
const COPY = /* wgsl */ `
struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> { return textureSample(t, s, in.uv); }
`;

// 2-input composite: @binding(0) = texture a, @binding(1) = texture b,
// @binding(2) = sampler. The engine must bind 2 texture views at 0 and 1,
// then the sampler at 2 — the generic N-input path in recordPassDraw.
const COMPOSITE2 = /* wgsl */ `
struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
@group(0) @binding(0) var a: texture_2d<f32>;
@group(0) @binding(1) var b: texture_2d<f32>;
@group(0) @binding(2) var s: sampler;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(a, s, in.uv) + textureSample(b, s, in.uv);
}
`;

test.skipIf(!bunWebGpuAvailable())(
  "a 2-input composite pass binds both inputs + sampler and renders clean",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
    });
    const copy = await shader.create(ctx, COPY);
    const comp = await shader.create(ctx, COMPOSITE2);

    // Pass 1: copy scene → named intermediate "half" (1 input, binding 0 + sampler at 1)
    // Pass 2: composite scene + "half" → swapchain (2 inputs, bindings 0+1 + sampler at 2)
    const fx = await post.createPasses(ctx, {
      passes: [
        { shader: copy, inputs: ["scene"], output: { intermediate: "half" } },
        {
          shader: comp,
          inputs: ["scene", { intermediate: "half" }],
          output: {},
        },
      ],
    });

    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(0, 1, 0, 1),
    );
    const m = meshMod.create(ctx, { geometry: geometry.cube(ctx), material });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });

    // A clean popErrorScope means WebGPU validated the bind group: binding 0
    // and binding 1 matched the declared texture_2d<f32> entries, and binding 2
    // matched the sampler — confirming the generic N-input path is correct.
    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [m], camera: cam, effects: [fx] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();

    gpu.dispose(ctx);
  },
);
