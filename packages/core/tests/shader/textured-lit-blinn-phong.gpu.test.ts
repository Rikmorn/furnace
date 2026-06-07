import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import type { Light } from "../../src/frame/lights.ts";
import { render } from "../../src/frame/render.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import { create as createMesh } from "../../src/mesh/mesh.ts";
import * as shader from "../../src/shader/index.ts";
import * as texture from "../../src/texture/index.ts";
import { vec3 } from "../../src/transform/vec3.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

// One light of each type — exercises the directional / point / spot branches of
// fr_shade (tag < 0.5 / 0.5..1.5 / > 1.5) through texturedLit's composed
// Blinn-Phong, with albedo sampled from a texture and a FIXED engine specular.
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
async function texturedLitMesh(
  ctx: gpu.Context,
): Promise<ReturnType<typeof createMesh>> {
  const s = await shader.texturedLit(ctx);
  const tex = await texture.create(
    ctx,
    texture.checkerboard({ size: 64, cells: 8 }),
  );
  const mat = await material.create(ctx, {
    shader: s,
    texture: { texture: tex },
  });
  return createMesh(ctx, { geometry: geometry.cube(ctx), material: mat });
}

// texturedLit draws clean under each light type — proves the composed Blinn-Phong
// compiles, samples albedo from the texture, binds the Scene UBO at
// @group(0) @binding(1) (usesScene), keeps @group(1) = sampler+texture only (no
// uniform specular binding), and validates under each light branch.
for (const { kind, light } of LIGHTS) {
  test.skipIf(!bunWebGpuAvailable())(
    `texturedLit draws clean under a ${kind} light`,
    async () => {
      const canvas = await makeOffscreenCanvas();
      const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
      const cube = await texturedLitMesh(ctx);
      const cam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 1, 3),
      });
      ctx.device.pushErrorScope("validation");
      render(ctx, { meshes: [cube], camera: cam, lights: [light] });
      const err = await ctx.device.popErrorScope();
      expect(err).toBe(null);
      gpu.dispose(ctx);
    },
  );
}

// texturedLit draws clean with NO lights supplied — the Scene UBO is still bound
// (usesScene), lightCount is 0, and the surface renders ambient-only (textured).
test.skipIf(!bunWebGpuAvailable())(
  "texturedLit draws clean with no lights supplied (ambient-only)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cube = await texturedLitMesh(ctx);
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 1, 3),
    });
    ctx.device.pushErrorScope("validation");
    render(ctx, { meshes: [cube], camera: cam });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);
