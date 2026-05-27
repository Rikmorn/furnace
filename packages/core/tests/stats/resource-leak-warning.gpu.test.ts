import { beforeEach, expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as post from "../../src/post/index.ts";
import { _pipelineCache } from "../../src/post/pipeline-cache.ts";
import { vec3 } from "../../src/transform/vec3.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

beforeEach(() => {
  _pipelineCache.resetForTests();
});

test.skipIf(!bunWebGpuAvailable())(
  "gpu.dispose: warns when resources are still registered",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.normalColor(ctx);
    const geo = mesh.cubeGeometry(ctx);
    mesh.create(ctx, { geometry: geo, material: mat });
    // Deliberately do not call destroy.

    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      gpu.dispose(ctx);
    } finally {
      setSink(consoleSink);
    }

    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    if (!entry) throw new Error("unreachable: entries.length checked above");
    expect(entry.level).toBe("warn");
    expect(entry.module).toBe("gpu");
    expect(entry.message).toContain(
      "context disposed with resources still registered",
    );
    expect(entry.rest[0]).toEqual({ remaining: 6 });
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "gpu.dispose: no warning when all resources unregistered",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.normalColor(ctx);
    const geo = mesh.cubeGeometry(ctx);
    const m = mesh.create(ctx, { geometry: geo, material: mat });
    mesh.destroy(m);
    mesh.destroyGeometry(geo);
    material.destroy(mat);

    // Camera buffer + depth texture only allocate inside frame.render; this
    // test never renders, so the registry is empty before dispose.
    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      gpu.dispose(ctx);
    } finally {
      setSink(consoleSink);
    }

    expect(entries.length).toBe(0);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "gpu.dispose: no warning after a render when all consumer resources destroyed",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.normalColor(ctx);
    const geo = mesh.cubeGeometry(ctx);
    const m = mesh.create(ctx, { geometry: geo, material: mat });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 0, 5),
    });

    frame.render(ctx, { draw: [m], camera: cam });

    mesh.destroy(m);
    mesh.destroyGeometry(geo);
    material.destroy(mat);

    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      gpu.dispose(ctx);
    } finally {
      setSink(consoleSink);
    }

    expect(entries.length).toBe(0);
  },
);

const PASSTHROUGH_SHADER = `
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSamp: sampler;
struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(sceneTex, sceneSamp, in.uv);
}`;

test.skipIf(!bunWebGpuAvailable())(
  "gpu.dispose: no warning after a render with effects when all consumer resources destroyed",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.normalColor(ctx);
    const geo = mesh.cubeGeometry(ctx);
    const m = mesh.create(ctx, { geometry: geo, material: mat });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 0, 5),
    });
    const fx = await post.create(ctx, { shader: PASSTHROUGH_SHADER });

    frame.render(ctx, { draw: [m], camera: cam, effects: [fx] });

    post.destroy(fx);
    mesh.destroy(m);
    mesh.destroyGeometry(geo);
    material.destroy(mat);

    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      gpu.dispose(ctx);
    } finally {
      setSink(consoleSink);
    }

    expect(entries.length).toBe(0);
  },
);
