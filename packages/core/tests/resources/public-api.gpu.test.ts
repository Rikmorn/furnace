import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import * as resources from "../../src/resources/index.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "resources.summary tracks allocations and destructions",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    expect(resources.summary(ctx)).toEqual({
      meshes: 0,
      materials: 0,
      geometries: 0,
      effects: 0,
    });

    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const geo = mesh.cubeGeometry(ctx);
    const cube = mesh.create(ctx, { geometry: geo, material: mat });

    expect(resources.summary(ctx)).toEqual({
      meshes: 1,
      materials: 1,
      geometries: 1,
      effects: 0,
    });

    mesh.destroy(ctx, cube);
    material.destroy(ctx, mat);
    mesh.destroyGeometry(ctx, geo);

    expect(resources.summary(ctx)).toEqual({
      meshes: 0,
      materials: 0,
      geometries: 0,
      effects: 0,
    });

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "resources.list yields live handles per kind",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(0, 1, 0, 1),
    });
    const geo = mesh.cubeGeometry(ctx);
    const m1 = mesh.create(ctx, { geometry: geo, material: mat });
    const m2 = mesh.create(ctx, { geometry: geo, material: mat });

    const meshHandles = [...resources.list<resources.MeshHandle>(ctx, "mesh")];
    expect(meshHandles).toHaveLength(2);
    expect(new Set(meshHandles)).toEqual(new Set([m1, m2]));

    const materialHandles = [
      ...resources.list<resources.MaterialHandle>(ctx, "material"),
    ];
    expect(materialHandles).toEqual([mat]);

    const geometryHandles = [
      ...resources.list<resources.GeometryHandle>(ctx, "geometry"),
    ];
    expect(geometryHandles).toEqual([geo]);

    const effectHandles = [
      ...resources.list<resources.EffectHandle>(ctx, "effect"),
    ];
    expect(effectHandles).toEqual([]);

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "resources.snapshot collects every live handle into per-kind arrays",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(0, 0, 1, 1),
    });
    const geo = mesh.cubeGeometry(ctx);
    const cube = mesh.create(ctx, { geometry: geo, material: mat });

    const snap = resources.snapshot(ctx);
    expect(snap.meshes).toEqual([cube]);
    expect(snap.materials).toEqual([mat]);
    expect(snap.geometries).toEqual([geo]);
    expect(snap.effects).toEqual([]);

    gpu.dispose(ctx);
  },
);

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

    expect(resources.summary(ctx)).toEqual({
      meshes: 1,
      materials: 1,
      geometries: 1,
      effects: 0,
    });

    resources.disposeAll(ctx);

    expect(resources.summary(ctx)).toEqual({
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
