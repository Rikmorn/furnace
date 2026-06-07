import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as camera from "../../src/camera/index.ts";
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

// `surfaceFormat: "linear"` works around the bun-webgpu 0.1.7 swapchain
// view-format mock bug (see render.gpu.test.ts for the full note).
test.skipIf(!bunWebGpuAvailable())(
  "a built-in lit mesh renders clean with object at @group(2)",
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
    render(ctx, { meshes: [cube], camera: cam });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);

// Regression: a material-less shader (normalColor declares NO `@group(1)`) now
// spans bind-group slots 0 and 2 with an empty intermediate slot 1. The engine
// must still bind group 1 (an empty bind group) so the draw is valid — an
// unbound intermediate slot below a bound higher slot is a WebGPU validation
// error. (Surfaced by the triangle + render-target demos under Safari.)
test.skipIf(!bunWebGpuAvailable())(
  "a material-less mesh (normalColor, no @group(1)) renders clean with object at @group(2)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.normalColor(ctx);
    const mat = await material.create(ctx, { shader: s });
    const cube = createMesh(ctx, {
      geometry: geometry.cube(ctx),
      material: mat,
    });
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
