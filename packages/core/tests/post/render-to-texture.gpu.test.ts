import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
import { FurnaceGpuError } from "../../src/gpu/errors.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
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
    const mat = await material.unlit(ctx, { color: [1, 0, 0, 1] });
    const cube = mesh.cube(ctx, { material: mat });

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
      clearColor: [0, 0, 0, 1],
    });

    expect(true).toBe(true); // No throw is the success criterion at this layer.
    depth.destroy();
    target.destroy();
    mesh.destroy(cube);
    material.destroy(mat);
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
