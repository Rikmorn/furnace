import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import { snapshot } from "../../src/stats/public.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "frame.render: one cube → drawCalls=1, triangles=12, pipelineSwitches=1, bindGroupSwitches=2 (group0 + group1)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({
      aspect: 1,
      fovYRad: Math.PI / 4,
      near: 0.1,
      far: 100,
    });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const m = mesh.cube(ctx, { material: mat });
    render(ctx, { draw: [m], camera: cam });
    const s = snapshot(ctx);
    expect(s.gpu.drawCalls).toBe(1);
    expect(s.gpu.triangles).toBe(12);
    expect(s.gpu.pipelineSwitches).toBe(1);
    expect(s.gpu.bindGroupSwitches).toBe(2);
    mesh.destroy(m);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render: two cubes same material → drawCalls=2, pipelineSwitches=1",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({
      aspect: 1,
      fovYRad: Math.PI / 4,
      near: 0.1,
      far: 100,
    });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const a = mesh.cube(ctx, { material: mat });
    const b = mesh.cube(ctx, { material: mat });
    render(ctx, { draw: [a, b], camera: cam });
    const s = snapshot(ctx);
    expect(s.gpu.drawCalls).toBe(2);
    expect(s.gpu.triangles).toBe(24);
    expect(s.gpu.pipelineSwitches).toBe(1);
    mesh.destroy(a);
    mesh.destroy(b);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render: depth texture registers; ensureDepthTexture on resize unregisters old + registers new",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 48);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({
      aspect: 64 / 48,
      fovYRad: Math.PI / 4,
      near: 0.1,
      far: 100,
    });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const m = mesh.cube(ctx, { material: mat });
    render(ctx, { draw: [m], camera: cam });
    const firstSnap = snapshot(ctx);
    expect(firstSnap.memory.textureBytes).toBeGreaterThanOrEqual(64 * 48 * 4);
    const firstTexBytes = firstSnap.memory.textureBytes;

    canvas.width = 128;
    canvas.height = 96;
    render(ctx, { draw: [m], camera: cam });
    const secondSnap = snapshot(ctx);
    expect(secondSnap.memory.textureBytes).toBeGreaterThan(firstTexBytes);
    expect(secondSnap.memory.textureBytes).toBeGreaterThanOrEqual(128 * 96 * 4);
    mesh.destroy(m);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render: camera buffer registers on first use",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({
      aspect: 1,
      fovYRad: Math.PI / 4,
      near: 0.1,
      far: 100,
    });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const m = mesh.cube(ctx, { material: mat });
    const before = snapshot(ctx);
    render(ctx, { draw: [m], camera: cam });
    const after = snapshot(ctx);
    expect(
      after.memory.bufferBytes - before.memory.bufferBytes,
    ).toBeGreaterThanOrEqual(64);
    mesh.destroy(m);
    gpu.dispose(ctx);
  },
);
