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

    // Two warns coexist during the Sessions 2-4 migration window: the
    // dispose-cascade auto-clean warn (covers pooled kinds — geometry today)
    // and the legacy stats-leak warn (covers still-Object kinds — mesh and
    // material today). After Task 2.4 the legacy warn goes away entirely.
    const cleanupWarn = entries.find(
      (e) => e.module === "resources" && e.message.includes("auto-cleaned"),
    );
    expect(cleanupWarn).toBeDefined();
    expect(cleanupWarn?.level).toBe("warn");
    expect(cleanupWarn?.message).toContain("1 live handles");

    const leakWarn = entries.find(
      (e) =>
        e.module === "gpu" &&
        e.message.includes("context disposed with resources still registered"),
    );
    expect(leakWarn).toBeDefined();
    expect(leakWarn?.level).toBe("warn");
    // mesh(1) + objectBuffer(1) + material(1) — geometry's 3 entries get
    // auto-unregistered by the cascade teardown.
    expect(leakWarn?.rest[0]).toEqual({ remaining: 3 });
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
    mesh.destroyGeometry(ctx, geo);
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
  "gpu.dispose: auto-cleans a forgotten geometry via the cascade",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.normalColor(ctx);
    const geo = mesh.cubeGeometry(ctx);
    const m = mesh.create(ctx, { geometry: geo, material: mat });
    mesh.destroy(m);
    material.destroy(mat);
    // Deliberately skip mesh.destroyGeometry — pre-pool this was the leak
    // regression guard; post-pool the dispose cascade auto-cleans the
    // geometry slot and unregisters its stats handles, so no legacy
    // leak-suspected warn fires. The auto-clean warn is the new safety
    // signal that takes its place.

    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      gpu.dispose(ctx);
    } finally {
      setSink(consoleSink);
    }

    const cleanupWarn = entries.find(
      (e) => e.module === "resources" && e.message.includes("auto-cleaned"),
    );
    expect(cleanupWarn).toBeDefined();
    expect(cleanupWarn?.level).toBe("warn");
    expect(cleanupWarn?.message).toContain("1 live handles");

    const leakWarn = entries.find(
      (e) =>
        e.module === "gpu" &&
        e.message.includes("context disposed with resources still registered"),
    );
    expect(leakWarn).toBeUndefined();
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
    mesh.destroyGeometry(ctx, geo);
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
    mesh.destroyGeometry(ctx, geo);
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
