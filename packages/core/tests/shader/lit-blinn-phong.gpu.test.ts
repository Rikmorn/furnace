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
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

// One light of each type — exercises the directional / point / spot branches of
// fr_shade (tag < 0.5 / 0.5..1.5 / > 1.5) under the new multi-light Blinn-Phong.
const DIRECTIONAL_LIGHT: Light = {
  type: "directional",
  direction: [0, -1, -0.5],
  color: [1, 1, 1],
  intensity: 1,
};
const LIGHTS: { kind: string; light: Light }[] = [
  { kind: "directional", light: DIRECTIONAL_LIGHT },
  {
    kind: "point",
    light: {
      type: "point",
      position: [0, 2, 2],
      color: [1, 0.9, 0.8],
      intensity: 2,
      range: 12,
    },
  },
  {
    kind: "spot",
    light: {
      type: "spot",
      position: [0, 3, 2],
      direction: [0, -1, -0.5],
      color: [1, 1, 1],
      intensity: 3,
      range: 15,
      innerAngle: 0.3,
      outerAngle: 0.5,
    },
  },
];

// `surfaceFormat: "linear"` works around the bun-webgpu 0.1.7 swapchain
// view-format mock bug (see scene-binding.gpu.test.ts / render.gpu.test.ts).
async function litMesh(
  ctx: gpu.Context,
  specular: number[] | undefined,
): Promise<ReturnType<typeof createMesh>> {
  const s = await shader.lit(ctx);
  const b = binding.create(ctx, s);
  // { color }-only is a valid Partial — leaving specular unset keeps it matte.
  const values = specular
    ? { color: [0.6, 0.6, 0.65, 1], specular }
    : { color: [0.6, 0.6, 0.65, 1] };
  binding.set(ctx, b, values);
  const mat = await material.create(ctx, { shader: s, binding: b });
  return createMesh(ctx, { geometry: geometry.cube(ctx), material: mat });
}

// (1) lit draws clean under each light type with a specular highlight set
// (specular = vec4(specColor, shininess)) — proves the composed Blinn-Phong
// compiles, binds the Scene UBO, and validates under each light branch.
for (const { kind, light } of LIGHTS) {
  test.skipIf(!bunWebGpuAvailable())(
    `lit draws clean under a ${kind} light with a specular highlight`,
    async () => {
      const canvas = await makeOffscreenCanvas();
      const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
      const cube = await litMesh(ctx, [0.5, 0.5, 0.5, 64]);
      const cam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
      });
      ctx.device.pushErrorScope("validation");
      render(ctx, { meshes: [cube], camera: cam, lights: [light] });
      const err = await ctx.device.popErrorScope();
      expect(err).toBe(null);
      gpu.dispose(ctx);
    },
  );
}

// (2) Matte default: a { color }-only binding (specular left zero → matte) validates
// and draws clean; the max(shininess, 1.0) guard keeps the matte path from a
// compile/eval error. (pushErrorScope captures validation errors, not NaN in pixels.)
test.skipIf(!bunWebGpuAvailable())(
  "lit draws clean with a { color }-only binding (matte default, NaN-free)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cube = await litMesh(ctx, undefined);
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    ctx.device.pushErrorScope("validation");
    render(ctx, { meshes: [cube], camera: cam, lights: [DIRECTIONAL_LIGHT] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);
