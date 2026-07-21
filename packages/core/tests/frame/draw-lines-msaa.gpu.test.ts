import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import { drawLines } from "../../src/frame/render-lines.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as meshMod from "../../src/mesh/index.ts";
import { vec3, vec4 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { makeUnlitMaterial } from "../_helpers/unlit-material.ts";

await ensureBunWebGpu();

async function msaaFixture() {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, {
    surfaceFormat: "linear",
    sampleCount: 4,
  });
  const { material } = await makeUnlitMaterial(
    ctx,
    vec4.fromValues(1, 0, 0, 1),
  );
  const geo = geometry.cube(ctx);
  const mesh = meshMod.create(ctx, { geometry: geo, material });
  const cam = camera.perspective({
    aspect: ctx.canvas.width / ctx.canvas.height,
    position: vec3.fromValues(0, 0, 3),
  });
  return { ctx, cam, mesh };
}

test.skipIf(!bunWebGpuAvailable())(
  "drawLines on a sampleCount:4 context builds a valid pass (both depth modes)",
  async () => {
    const { ctx, cam, mesh } = await msaaFixture();
    const vertices = new Float32Array([0, 0, 0, 1, 1, 1]);
    const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]);

    render(ctx, { meshes: [mesh], camera: cam });

    ctx.device.pushErrorScope("validation");
    drawLines(ctx, { vertices, colors, camera: cam, occlude: true });
    const occludeErr = await ctx.device.popErrorScope();
    expect(occludeErr).toBeNull();

    ctx.device.pushErrorScope("validation");
    drawLines(ctx, { vertices, colors, camera: cam, occlude: false });
    const overlayErr = await ctx.device.popErrorScope();
    expect(overlayErr).toBeNull();

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "multiple drawLines calls compose in one MSAA frame with no validation error",
  async () => {
    const { ctx, cam, mesh } = await msaaFixture();
    const vertices = new Float32Array([-1, 0, 0, 1, 0, 0]);
    const colors = new Float32Array([1, 1, 0, 1, 1, 1, 0, 1]);

    render(ctx, { meshes: [mesh], camera: cam });

    ctx.device.pushErrorScope("validation");
    drawLines(ctx, { vertices, colors, camera: cam });
    drawLines(ctx, { vertices, colors, camera: cam, occlude: false });
    drawLines(ctx, { vertices, colors, camera: cam, occlude: true });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();

    gpu.dispose(ctx);
  },
);
