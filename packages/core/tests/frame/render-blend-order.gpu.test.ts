import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import { _resolveMaterial } from "../../src/material/internal.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as shader from "../../src/shader/index.ts";
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

// The swap chain is configured without COPY_SRC, so frame.render's output
// cannot be read back for a pixel assertion. `gpu.pipelineSwitches` is the
// available observation of RECORD ORDER: the counter only ticks when a draw's
// pipeline differs from the previous draw's, so an arrangement whose repeated
// pipelines become adjacent in exactly one of the two orders discriminates
// them. What this pins is that the partition is WIRED INTO render() at all —
// the counter is symmetric under reversal and cannot tell which group went
// first. The direction (opaques before blended) is pinned by the pure tests
// in render-draw-order.test.ts.
test.skipIf(!bunWebGpuAvailable())(
  "frame.render records blended meshes after opaque meshes, not in submission order",
  async () => {
    // submission order (the bug): blend, opaque, blend → 3 switches
    // partitioned order (fixed):  opaque, blend, blend → 2 switches
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
    });
    const sh = await createShader(ctx, WGSL);
    const opaqueMat = await material.create(ctx, { shader: sh });
    // The editor-ghost shape: blended AND depth-write-off, so it leaves nothing
    // in the depth buffer to protect it from a later opaque draw.
    const blendMat = await material.create(ctx, {
      shader: sh,
      blend: material.blend.straightAlpha,
      depth: { write: false },
    });
    // The switch counter only means anything if the two materials really did
    // build distinct pipelines.
    expect(_resolveMaterial(ctx, opaqueMat).pipeline).not.toBe(
      _resolveMaterial(ctx, blendMat).pipeline,
    );

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

test.skipIf(!bunWebGpuAvailable())(
  "frame.render records an opaque instanced group before a blended mesh",
  async () => {
    // The shape the bug was reported in: a translucent ghost mesh submitted
    // alongside opaque INSTANCED geometry (the kit tiles). render concatenates
    // as [...meshes, ...instanced], so the ghosts always precede the tiles on
    // submission — the partition has to pull the tiles ahead of them.
    //   submission order (the bug): ghostA, solid, ghostB, tiles → 4 switches
    //   partitioned order (fixed):  solid, tiles, ghostA, ghostB → 3 switches
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
    });
    const sh = await createShader(ctx, WGSL);
    const opaqueMat = await material.create(ctx, { shader: sh });
    const blendMat = await material.create(ctx, {
      shader: sh,
      blend: material.blend.straightAlpha,
      depth: { write: false },
    });

    const instShader = await shader.unlitInstanced(ctx);
    const instBinding = binding.create(ctx, instShader);
    binding.set(ctx, instBinding, { color: [1, 1, 1, 1] });
    const instMat = await material.create(ctx, {
      shader: instShader,
      binding: instBinding,
    });

    const geo = geometry.cube(ctx);
    const ghostA = mesh.create(ctx, { geometry: geo, material: blendMat });
    const solid = mesh.create(ctx, { geometry: geo, material: opaqueMat });
    const ghostB = mesh.create(ctx, { geometry: geo, material: blendMat });
    const tiles = mesh.createInstanced(ctx, {
      geometry: geo,
      material: instMat,
      count: 2,
    });
    mesh.setInstanceTransform(ctx, tiles, 0, [-1.2, 0, -4], [0, 0, 0, 1], 1);
    mesh.setInstanceTransform(ctx, tiles, 1, [1.2, 0, -4], [0, 0, 0, 1], 1);

    render(ctx, {
      meshes: [ghostA, solid, ghostB],
      instanced: [tiles],
      camera: camera.perspective({ aspect: 1 }),
    });

    const stats = snapshot(ctx).gpu;
    expect(stats.drawCalls).toBe(4); // 3 meshes + 1 instanced group
    expect(stats.pipelineSwitches).toBe(3);

    gpu.dispose(ctx);
  },
);
