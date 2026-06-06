import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
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

// ── MSAA guard ────────────────────────────────────────────────────────────────

test.skipIf(!bunWebGpuAvailable())(
  "renderToTexture under MSAA ctx (sampleCount 4) throws a clear FurnaceGpuError",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
      sampleCount: 4,
    });
    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const geo = geometry.cube(ctx);
    const m = meshMod.create(ctx, { geometry: geo, material });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    // Color target uses the working color format (correct for format check),
    // with a depth texture (correct for depth check) — so only the MSAA guard fires.
    const tex = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx._internal.workingColorFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depth = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: tex,
        depthTexture: depth,
        meshes: [m],
        camera: cam,
      }),
    ).toThrow(/MSAA|sampleCount/);
    depth.destroy();
    tex.destroy();
    gpu.dispose(ctx);
  },
);

// ── HDR format guard ──────────────────────────────────────────────────────────

test.skipIf(!bunWebGpuAvailable())(
  "renderToTexture under HDR ctx rejects ctx.format target (workingColorFormat mismatch)",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
      hdr: true,
    });
    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 1, 1, 1),
    );
    const geo = geometry.cube(ctx);
    const m = meshMod.create(ctx, { geometry: geo, material });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    // Under HDR, ctx.format is bgra8unorm (the swapchain format) while
    // workingColorFormat is rgba16float. Passing ctx.format is wrong.
    const wrong = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depth = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: wrong,
        depthTexture: depth,
        meshes: [m],
        camera: cam,
      }),
    ).toThrow(/working color format/);
    wrong.destroy();
    depth.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "renderToTexture under HDR ctx accepts workingColorFormat (rgba16float) target without format error",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
      hdr: true,
    });
    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 1, 1, 1),
    );
    const geo = geometry.cube(ctx);
    const m = meshMod.create(ctx, { geometry: geo, material });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    // Correct: rgba16float matches workingColorFormat under HDR.
    const correct = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx._internal.workingColorFormat, // rgba16float
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depth = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    // The format guard must NOT fire — renderToTexture should succeed (no throw).
    // We push/pop a validation scope to catch any raw WebGPU errors that would
    // indicate a pipeline-vs-pass format mismatch escaped to the GPU layer.
    ctx.device.pushErrorScope("validation");
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: correct,
        depthTexture: depth,
        meshes: [m],
        camera: cam,
      }),
    ).not.toThrow();
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();
    correct.destroy();
    depth.destroy();
    gpu.dispose(ctx);
  },
);
