import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import { create as createMesh, setScale } from "../../src/mesh/mesh.ts";
import * as shader from "../../src/shader/index.ts";
import { vec3 } from "../../src/transform/vec3.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

// Non-uniform scale drives the inverse-transpose normalMatrix path in
// `_recomputeModelIfDirty`: with the Object UBO grown to 128 bytes
// ({ model, normalMatrix }), the `normalColor` built-in transforms its normal
// via `object.normalMatrix`. This verifies the grown buffer + the normalMatrix
// write produce a clean draw (no validation error) on a non-uniformly scaled
// mesh — the case where `object.model` would have skewed the normal.
// `surfaceFormat: "linear"` works around the bun-webgpu 0.1.7 swapchain
// view-format mock bug.
test.skipIf(!bunWebGpuAvailable())(
  "a non-uniform-scaled normalColor mesh draws clean (normalMatrix path)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.normalColor(ctx);
    const mat = await material.create(ctx, { shader: s });
    const cube = createMesh(ctx, {
      geometry: geometry.cube(ctx),
      material: mat,
    });
    setScale(ctx, cube, vec3.fromValues(2, 0.2, 1)); // non-uniform
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    ctx.device.pushErrorScope("validation");
    render(ctx, { meshes: [cube], camera: cam });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);
