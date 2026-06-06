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

test.skipIf(!bunWebGpuAvailable())(
  "MSAA scene pass (sampleCount 4) renders one frame with no validation error",
  async () => {
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
    const m = meshMod.create(ctx, { geometry: geo, material });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [m], camera: cam });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "non-MSAA path (sampleCount 1) still renders clean (regression)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(0, 1, 0, 1),
    );
    const geo = geometry.cube(ctx);
    const m = meshMod.create(ctx, { geometry: geo, material });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [m], camera: cam });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();
    gpu.dispose(ctx);
  },
);
