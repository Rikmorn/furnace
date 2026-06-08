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
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const CASTER: Light = {
  type: "directional",
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  shadow: { orthoHalfExtent: 5, near: 0.1, far: 20, target: [0, 0, 0] },
};

// A lit cube under a shadow-casting directional light: the depth-only caster
// pass writes the cube into its array layer, then the main scene pass draws it.
// Both must validate clean (popErrorScope === null). The cube casts in the depth
// pass regardless of whether it receives — receiving is Task 12.
// `surfaceFormat: "linear"` works around the bun-webgpu 0.1.7 swapchain
// view-format mock bug (see render.gpu.test.ts).
test.skipIf(!bunWebGpuAvailable())(
  "render with a shadow-casting light runs the depth pass + main pass clean",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.lit(ctx);
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
    render(ctx, { meshes: [cube], camera: cam, lights: [CASTER] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);
