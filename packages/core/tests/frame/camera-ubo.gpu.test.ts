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

// Smoke test: the Camera UBO grew from 64 bytes (viewProjection only) to 80
// bytes (viewProjection + eye position, for Phase-2 Blinn-Phong specular).
// The `unlit` built-in composes `_cameraBinding` (packages/core/src/shader/preamble.ts),
// which this commit grew to 80 bytes — so the layout (80) and buffer (80) match
// here; there is no oversized-binding asymmetry on this path. This test verifies
// that a built-in shader composing the grown 80-byte `_cameraBinding` renders clean
// (no validation error) through the full render path after the Camera UBO grew.
// The genuinely asymmetric case — a shader hand-declaring a 64-byte `Camera` bound
// to the now-80-byte buffer (valid because WebGPU permits a buffer larger than the
// layout's minBindingSize) — is exercised by packages/core/tests/frame/draw-lines.gpu.test.ts
// (whose shader, render-lines.ts, still declares a 64-byte Camera).
// `surfaceFormat: "linear"` works around the bun-webgpu 0.1.7 swapchain view-format mock bug.
test.skipIf(!bunWebGpuAvailable())(
  "an unlit mesh draws clean with the 80-byte Camera UBO (position added)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.unlit(ctx);
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
