import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as camera from "../../src/camera/index.ts";
import type { Light } from "../../src/frame/lights.ts";
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
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

// usesScene shader composes the preamble fragments + sceneBinding and touches
// scene.* in the fragment stage so the binding is statically used (reflected
// into getBindGroupLayout(0) under auto layout).
const SCENE_TEST_SRC = shader.source`${_cameraBinding}
${_objectBinding}
${_vsIn}
${sceneBinding}
@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(scene.ambientSky.rgb * f32(scene.lightCount.x + 1u), 1.0);
}`;

const KEY_LIGHT: Light = {
  type: "directional",
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
};

// A usesScene shader binds the Scene UBO at @group(0) @binding(1) and draws
// clean — proves the per-frame group-0 bind group includes the scene buffer.
// `surfaceFormat: "linear"` works around the bun-webgpu 0.1.7 swapchain
// view-format mock bug (see render.gpu.test.ts).
test.skipIf(!bunWebGpuAvailable())(
  "a usesScene mesh binds the Scene UBO at @group(0) @binding(1) and draws clean",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.create(ctx, SCENE_TEST_SRC, { usesScene: true });
    const mat = await material.create(ctx, { shader: s });
    const cube = createMesh(ctx, {
      geometry: geometry.cube(ctx),
      material: mat,
    });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    ctx.device.pushErrorScope("validation");
    render(ctx, { meshes: [cube], camera: cam, lights: [KEY_LIGHT] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);

// An unlit (usesScene:false) shader still draws clean even when lights are
// supplied — proves the Scene UBO is NOT bound for non-usesScene pipelines
// (their group-0 layout has no binding 1; binding it would fail createBindGroup).
test.skipIf(!bunWebGpuAvailable())(
  "an unlit mesh draws clean with lights supplied (Scene UBO not bound)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.unlit(ctx);
    const b = binding.create(ctx, s);
    binding.set(ctx, b, { color: vec4.fromValues(1, 0, 0, 1) });
    const mat = await material.create(ctx, { shader: s, binding: b });
    const cube = createMesh(ctx, {
      geometry: geometry.cube(ctx),
      material: mat,
    });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    ctx.device.pushErrorScope("validation");
    render(ctx, { meshes: [cube], camera: cam, lights: [KEY_LIGHT] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);
