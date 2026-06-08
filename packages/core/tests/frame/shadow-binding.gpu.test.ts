import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import { create as createMesh } from "../../src/mesh/mesh.ts";
import * as shader from "../../src/shader/index.ts";
import { sceneBinding } from "../../src/shader/lighting.ts";
import {
  _cameraBinding,
  _objectBinding,
  _vsIn,
} from "../../src/shader/preamble.ts";
import { shadowHelpers } from "../../src/shader/shadows.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

// A usesShadows shader composes the preamble fragments + sceneBinding +
// shadowHelpers. The fragment calls fr_shadowFactor with slot -1, which
// short-circuits to lit (never samples), but the shader still DECLARES the
// shadow array (binding 2) + comparison sampler (binding 3). Under `auto`
// pipeline layout those bindings appear in getBindGroupLayout(0), so render
// MUST bind them or createBindGroup / draw validation fails. This proves Task 9's
// binding closes that gap.
const SHADOW_TEST_SRC = shader.source`${_cameraBinding}${_objectBinding}${_vsIn}${sceneBinding}${shadowHelpers}
@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(fr_shadowFactor(vec3<f32>(0.0), -1, 0.0), 0.0, 0.0, 1.0);
}`;

test.skipIf(!bunWebGpuAvailable())(
  "a usesShadows mesh binds shadow map (2) + comparison sampler (3) and draws clean",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.create(ctx, SHADOW_TEST_SRC, {
      usesScene: true,
      usesShadows: true,
    });
    const mat = await material.create(ctx, { shader: s });
    const cube = createMesh(ctx, {
      geometry: geometry.cube(ctx),
      material: mat,
    });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    ctx.device.pushErrorScope("validation");
    render(ctx, { meshes: [cube], camera: cam, lights: [] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);
