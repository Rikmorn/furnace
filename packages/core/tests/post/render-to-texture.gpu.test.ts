import { expect, test } from "bun:test";
import type { Camera } from "../../src/camera/index.ts";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
import * as geometry from "../../src/geometry/index.ts";
import { FurnaceGpuError } from "../../src/gpu/errors.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import type { Mesh } from "../../src/mesh/types.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture happy path: renders into a consumer-owned target",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({ aspect: 1 });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });

    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const depth = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    frame.renderToTexture(ctx, {
      texture: target,
      depthTexture: depth,
      draw: [cube],
      camera: cam,
      clearColor: vec4.fromValues(0, 0, 0, 1),
    });

    expect(true).toBe(true); // No throw is the success criterion at this layer.
    depth.destroy();
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, cubeGeo);
    material.destroy(ctx, mat);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture on disposed ctx throws",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({ aspect: 1 });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    gpu.dispose(ctx);
    expect(() =>
      frame.renderToTexture(ctx, { texture: target, draw: [], camera: cam }),
    ).toThrow(FurnaceGpuError);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture throws when camera is null",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        draw: [cube],
        camera: null as unknown as Camera,
      }),
    ).toThrow("camera is required");
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, cubeGeo);
    material.destroy(ctx, mat);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture throws when draw is null",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const cam = camera.perspective({ aspect: 1 });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        draw: null as unknown as Mesh[],
        camera: cam,
      }),
    ).toThrow("draw is required");
    target.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.renderToTexture throws when draw contains a null entry",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const target = ctx.device.createTexture({
      size: { width: 64, height: 64 },
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const cam = camera.perspective({ aspect: 1 });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });
    expect(() =>
      frame.renderToTexture(ctx, {
        texture: target,
        draw: [cube, null as unknown as Mesh],
        camera: cam,
      }),
    ).toThrow("draw[1]: null/undefined mesh");
    target.destroy();
    mesh.destroy(ctx, cube);
    geometry.destroy(ctx, cubeGeo);
    material.destroy(ctx, mat);
    gpu.dispose(ctx);
  },
);
