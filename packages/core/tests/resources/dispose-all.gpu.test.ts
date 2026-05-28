import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as resources from "../../src/resources/index.ts";
import * as stats from "../../src/stats/index.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "resources.disposeAll tears down every live handle without disposing the device",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 1, 0, 1),
    });
    const geo = mesh.cubeGeometry(ctx);
    mesh.create(ctx, { geometry: geo, material: mat });

    expect(stats.snapshot(ctx).resources).toEqual({
      meshes: 1,
      materials: 1,
      geometries: 1,
      effects: 0,
    });

    resources.disposeAll(ctx);

    expect(stats.snapshot(ctx).resources).toEqual({
      meshes: 0,
      materials: 0,
      geometries: 0,
      effects: 0,
    });

    // Idempotent: a second call is a no-op.
    expect(() => resources.disposeAll(ctx)).not.toThrow();

    // Device still alive — gpu.dispose runs normally.
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "alloc-after-disposeAll reuses freed slots and renders correctly",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    // First wave: allocate, then dispose
    const mat1 = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const geo1 = mesh.cubeGeometry(ctx);
    const cube1 = mesh.create(ctx, { geometry: geo1, material: mat1 });

    expect(stats.snapshot(ctx).resources).toEqual({
      meshes: 1,
      materials: 1,
      geometries: 1,
      effects: 0,
    });

    resources.disposeAll(ctx);

    expect(stats.snapshot(ctx).resources).toEqual({
      meshes: 0,
      materials: 0,
      geometries: 0,
      effects: 0,
    });

    // Second wave: allocate fresh after disposeAll — confirms mid-session
    // level-transition reuse case the API was designed for.
    const mat2 = await material.unlit(ctx, {
      color: vec4.fromValues(0, 1, 0, 1),
    });
    const geo2 = mesh.cubeGeometry(ctx);
    const cube2 = mesh.create(ctx, { geometry: geo2, material: mat2 });

    expect(stats.snapshot(ctx).resources).toEqual({
      meshes: 1,
      materials: 1,
      geometries: 1,
      effects: 0,
    });

    // Old handles must NOT resolve (slots recycled, generation bumped).
    // Verifies the silent-no-op contract on stale handles.
    expect(() => mesh.destroy(ctx, cube1)).not.toThrow();
    expect(() => material.destroy(ctx, mat1)).not.toThrow();
    expect(() => mesh.destroyGeometry(ctx, geo1)).not.toThrow();

    // The fresh handles must work normally.
    mesh.destroy(ctx, cube2);
    material.destroy(ctx, mat2);
    mesh.destroyGeometry(ctx, geo2);

    gpu.dispose(ctx);
  },
);
