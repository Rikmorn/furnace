import { expect, test } from "bun:test";
import type { Camera } from "../../src/camera/index.ts";
import * as camera from "../../src/camera/index.ts";
import { _frameRenderInternals, render } from "../../src/frame/render.ts";
import * as gpu from "../../src/gpu/index.ts";
import { _resolveMaterial } from "../../src/material/internal.ts";
import { normalColor } from "../../src/material/normal-color.ts";
import { unlit } from "../../src/material/unlit.ts";
import { cubeGeometry, planeGeometry } from "../../src/mesh/factories/index.ts";
import { _resolveMesh } from "../../src/mesh/internal.ts";
import { create as createMesh } from "../../src/mesh/mesh.ts";
import type { Mesh } from "../../src/mesh/types.ts";
import { vec3 } from "../../src/transform/index.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "_ensureDepthTexture creates a depth texture matching the canvas size",
  async () => {
    const canvas = await makeOffscreenCanvas(640, 480);
    const ctx = await gpu.requestContext(canvas);
    const entry = _frameRenderInternals._ensureDepthTexture(ctx);
    expect(entry.width).toBe(640);
    expect(entry.height).toBe(480);
    expect(entry.view).toBeDefined();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_ensureCameraBuffer is stable across calls and writes viewProjection",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const cam = camera.perspective({});
    const b1 = _frameRenderInternals._ensureCameraBuffer(ctx, cam);
    const b2 = _frameRenderInternals._ensureCameraBuffer(ctx, cam);
    expect(b2).toBe(b1);
    gpu.dispose(ctx);
  },
);

// `surfaceFormat: "linear"` works around a bun-webgpu 0.1.7 mock bug where
// GPUCanvasContextMock.createRenderTexture drops the configured `viewFormats`,
// so an srgb view-format upcast on the swapchain texture fails validation.
// Chrome handles this correctly; covered separately by the Playwright probe.
test.skipIf(!bunWebGpuAvailable())(
  "frame.render draws cube + plane in one pass with no validation errors",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    const cubeMat = await normalColor(ctx);
    const planeMat = await unlit(ctx, {
      color: vec4.fromValues(0.1, 0.15, 0.2, 1),
    });
    const c = createMesh(ctx, {
      geometry: cubeGeometry(ctx),
      material: cubeMat,
    });
    const p = createMesh(ctx, {
      geometry: planeGeometry(ctx, { size: 3 }),
      material: planeMat,
    });
    ctx.device.pushErrorScope("validation");
    render(ctx, { draw: [p, c], camera: cam });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render with empty draw array clears the framebuffer without error",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({});
    ctx.device.pushErrorScope("validation");
    render(ctx, {
      draw: [],
      camera: cam,
      clearColor: vec4.fromValues(0.2, 0.3, 0.4, 1),
    });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render throws on disposed context",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({});
    gpu.dispose(ctx);
    expect(() => render(ctx, { draw: [], camera: cam })).toThrow(/disposed/);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_ensureMeshGroup0 returns distinct bind groups per cameraBuffer",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const camA = camera.perspective({ position: vec3.fromValues(0, 0, 3) });
    const camB = camera.perspective({ position: vec3.fromValues(3, 0, 0) });
    const mat = await normalColor(ctx);
    const c = createMesh(ctx, { geometry: cubeGeometry(ctx), material: mat });
    const cSlot = _resolveMesh(ctx, c);
    const matSlot = _resolveMaterial(ctx, mat);
    const bufA = _frameRenderInternals._ensureCameraBuffer(ctx, camA);
    const bufB = _frameRenderInternals._ensureCameraBuffer(ctx, camB);
    const groupA = _frameRenderInternals._ensureMeshGroup0(
      ctx,
      cSlot,
      matSlot.pipeline,
      bufA,
    );
    const groupB = _frameRenderInternals._ensureMeshGroup0(
      ctx,
      cSlot,
      matSlot.pipeline,
      bufB,
    );
    const groupAagain = _frameRenderInternals._ensureMeshGroup0(
      ctx,
      cSlot,
      matSlot.pipeline,
      bufA,
    );
    expect(groupA).not.toBe(groupB);
    expect(groupAagain).toBe(groupA);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render throws when camera is null",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await unlit(ctx, { color: vec4.fromValues(1, 0, 0, 1) });
    const m = createMesh(ctx, { geometry: cubeGeometry(ctx), material: mat });
    expect(() =>
      render(ctx, { draw: [m], camera: null as unknown as Camera }),
    ).toThrow("camera is required");
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render throws when draw is null",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({});
    expect(() =>
      render(ctx, { draw: null as unknown as Mesh[], camera: cam }),
    ).toThrow("draw is required");
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render throws when draw contains a null entry",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({});
    const mat = await unlit(ctx, { color: vec4.fromValues(1, 0, 0, 1) });
    const m = createMesh(ctx, { geometry: cubeGeometry(ctx), material: mat });
    expect(() =>
      render(ctx, {
        draw: [m, null as unknown as Mesh],
        camera: cam,
      }),
    ).toThrow("draw[1]: null/undefined mesh");
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render throws when draw contains a cross-context mesh",
  async () => {
    const canvasA = await makeOffscreenCanvas();
    const ctxA = await gpu.requestContext(canvasA, { surfaceFormat: "linear" });
    const canvasB = await makeOffscreenCanvas();
    const ctxB = await gpu.requestContext(canvasB, { surfaceFormat: "linear" });
    const cam = camera.perspective({});
    const matB = await unlit(ctxB, { color: vec4.fromValues(1, 0, 0, 1) });
    const mB = createMesh(ctxB, {
      geometry: cubeGeometry(ctxB),
      material: matB,
    });
    expect(() => render(ctxA, { draw: [mB], camera: cam })).toThrow(
      "mesh belongs to a different context",
    );
    gpu.dispose(ctxA);
    gpu.dispose(ctxB);
  },
);
