import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import { drawLines } from "../../src/frame/render-lines.ts";
import * as gpu from "../../src/gpu/index.ts";
import { vec3 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "drawLines occlude:false renders clean over a frame (always-on-top overlay mode)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 0, 5),
    });

    // Populate depth + swap-chain first (required before drawLines)
    render(ctx, { meshes: [], camera: cam });

    // One yellow line passing through the origin — would be occluded behind a
    // mesh at depth, but with occlude:false it should always render.
    const verts = new Float32Array([-2, 0, 0, 2, 0, 0]);
    const colors = new Float32Array([1, 1, 0, 1, 1, 1, 0, 1]);

    ctx.device.pushErrorScope("validation");

    // overlay mode (always-on-top, depthCompare:"always")
    drawLines(ctx, { vertices: verts, colors, camera: cam, occlude: false });
    // default/occlude mode (depthCompare:"less-equal") — must still work unchanged
    drawLines(ctx, { vertices: verts, colors, camera: cam, occlude: true });
    // omitted occlude — should default to true (backward-compatible)
    drawLines(ctx, { vertices: verts, colors, camera: cam });

    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();

    gpu.dispose(ctx);
  },
);
