import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import { create as createShader } from "../../src/shader/shader.ts";
import { snapshot } from "../../src/stats/public.ts";
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
@group(2) @binding(0) var<uniform> object: Object;
struct VsIn { @location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32> };
@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 1.0, 1.0, 0.5); }
`;

const ALPHA_BLEND: GPUBlendState = {
  color: {
    srcFactor: "src-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
  alpha: {
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
};

// The swap chain is configured without COPY_SRC, so frame.render's output
// cannot be read back for a pixel assertion. `gpu.pipelineSwitches` is the
// available observation of RECORD ORDER: the counter only ticks when a draw's
// pipeline differs from the previous draw's, so submitting
// blended → opaque → blended discriminates the two orders exactly:
//   submission order (the bug): blend, opaque, blend → 3 switches
//   partitioned order (fixed):  opaque, blend, blend → 2 switches
test.skipIf(!bunWebGpuAvailable())(
  "frame.render records blended draws after opaque ones, not in submission order",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
    });
    const sh = await createShader(ctx, WGSL);
    const opaqueMat = await material.create(ctx, { shader: sh });
    // The editor-ghost shape: blended AND depth-write-off, so it leaves nothing
    // in the depth buffer to protect it from a later opaque draw.
    const blendMat = await material.create(ctx, {
      shader: sh,
      blend: ALPHA_BLEND,
      depth: { write: false },
    });
    expect(opaqueMat).not.toBe(blendMat);

    const geo = geometry.cube(ctx);
    const ghostA = mesh.create(ctx, { geometry: geo, material: blendMat });
    const solid = mesh.create(ctx, { geometry: geo, material: opaqueMat });
    const ghostB = mesh.create(ctx, { geometry: geo, material: blendMat });

    render(ctx, {
      meshes: [ghostA, solid, ghostB],
      camera: camera.perspective({ aspect: 1 }),
    });

    const stats = snapshot(ctx).gpu;
    expect(stats.drawCalls).toBe(3);
    expect(stats.pipelineSwitches).toBe(2);

    gpu.dispose(ctx);
  },
);
