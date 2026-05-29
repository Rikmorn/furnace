import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import { cube as cubeGeometry } from "../../src/geometry/factories/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import { normalColor } from "../../src/material/normal-color.ts";
import { create as createMesh } from "../../src/mesh/mesh.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "frame.render: triangle-list cube records 12 triangles, 1 draw call",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    const mat = await normalColor(ctx);
    const c = createMesh(ctx, { geometry: cubeGeometry(ctx), material: mat });
    render(ctx, { draw: [c], camera: cam });
    expect(ctx._internal.stats.triangles).toBe(12);
    expect(ctx._internal.stats.drawCalls).toBe(1);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render: line-list cube records 0 triangles, 1 draw call",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    const mat = await normalColor(ctx, {
      topology: "line-list",
      cullMode: "none",
    });
    const c = createMesh(ctx, { geometry: cubeGeometry(ctx), material: mat });
    render(ctx, { draw: [c], camera: cam });
    expect(ctx._internal.stats.triangles).toBe(0);
    expect(ctx._internal.stats.drawCalls).toBe(1);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render: point-list cube records 0 triangles, 1 draw call",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    const mat = await normalColor(ctx, {
      topology: "point-list",
      cullMode: "none",
    });
    const c = createMesh(ctx, { geometry: cubeGeometry(ctx), material: mat });
    render(ctx, { draw: [c], camera: cam });
    expect(ctx._internal.stats.triangles).toBe(0);
    expect(ctx._internal.stats.drawCalls).toBe(1);
    gpu.dispose(ctx);
  },
);
