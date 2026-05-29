import { expect, test } from "bun:test";
import * as geometry from "../../src/geometry/index.ts";
import type { GeometrySlot } from "../../src/geometry/types.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import type { MaterialSlot } from "../../src/material/types.ts";
import * as mesh from "../../src/mesh/index.ts";
import {
  _lookupGeometry,
  _lookupMaterial,
} from "../../src/resources/internal.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "geometry.destroy while a mesh references it defers actual teardown",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const geo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: geo, material: mat });

    // userCount === 1 after mesh.create
    const slotBefore = _lookupGeometry<GeometrySlot>(ctx, geo);
    expect(slotBefore?.userCount).toBe(1);

    // Destroy geometry FIRST — deferred via markedDestroyed
    geometry.destroy(ctx, geo);
    const slotAfterMark = _lookupGeometry<GeometrySlot>(ctx, geo);
    expect(slotAfterMark).not.toBeNull();
    expect(slotAfterMark?.markedDestroyed).toBe(true);

    // Destroying the mesh should now trigger geometry teardown
    mesh.destroy(ctx, cube);
    expect(_lookupGeometry(ctx, geo)).toBeNull();

    material.destroy(ctx, mat);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "destroying multiple meshes sharing one geometry decrements correctly",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(0, 1, 0, 1),
    });
    const geo = geometry.cube(ctx);
    const m1 = mesh.create(ctx, { geometry: geo, material: mat });
    const m2 = mesh.create(ctx, { geometry: geo, material: mat });
    const m3 = mesh.create(ctx, { geometry: geo, material: mat });

    const slot = _lookupGeometry<GeometrySlot>(ctx, geo);
    expect(slot?.userCount).toBe(3);

    mesh.destroy(ctx, m1);
    expect(_lookupGeometry<GeometrySlot>(ctx, geo)?.userCount).toBe(2);
    mesh.destroy(ctx, m2);
    expect(_lookupGeometry<GeometrySlot>(ctx, geo)?.userCount).toBe(1);
    mesh.destroy(ctx, m3);
    expect(_lookupGeometry<GeometrySlot>(ctx, geo)?.userCount).toBe(0);

    geometry.destroy(ctx, geo);
    expect(_lookupGeometry(ctx, geo)).toBeNull();

    material.destroy(ctx, mat);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.destroy while a mesh references it defers actual teardown",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const geo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: geo, material: mat });

    const slotBefore = _lookupMaterial<MaterialSlot>(ctx, mat);
    expect(slotBefore?.userCount).toBe(1);

    // Destroy material FIRST — deferred via markedDestroyed
    material.destroy(ctx, mat);
    const slotAfterMark = _lookupMaterial<MaterialSlot>(ctx, mat);
    expect(slotAfterMark).not.toBeNull();
    expect(slotAfterMark?.markedDestroyed).toBe(true);

    // Destroying the mesh should now trigger material teardown
    mesh.destroy(ctx, cube);
    expect(_lookupMaterial(ctx, mat)).toBeNull();

    geometry.destroy(ctx, geo);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "destroying multiple meshes sharing one material decrements correctly",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(0, 1, 0, 1),
    });
    const geo = geometry.cube(ctx);
    const m1 = mesh.create(ctx, { geometry: geo, material: mat });
    const m2 = mesh.create(ctx, { geometry: geo, material: mat });
    const m3 = mesh.create(ctx, { geometry: geo, material: mat });

    const slot = _lookupMaterial<MaterialSlot>(ctx, mat);
    expect(slot?.userCount).toBe(3);

    mesh.destroy(ctx, m1);
    expect(_lookupMaterial<MaterialSlot>(ctx, mat)?.userCount).toBe(2);
    mesh.destroy(ctx, m2);
    expect(_lookupMaterial<MaterialSlot>(ctx, mat)?.userCount).toBe(1);
    mesh.destroy(ctx, m3);
    expect(_lookupMaterial<MaterialSlot>(ctx, mat)?.userCount).toBe(0);

    material.destroy(ctx, mat);
    expect(_lookupMaterial(ctx, mat)).toBeNull();

    geometry.destroy(ctx, geo);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "mesh.create does not increment the geometry refcount when the material handle is invalid",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 1, 0, 1),
    });
    const geo = geometry.cube(ctx);

    // Destroy the material so its handle becomes stale.
    material.destroy(ctx, mat);

    const before = _lookupGeometry<GeometrySlot>(ctx, geo)?.userCount ?? -1;
    expect(() => mesh.create(ctx, { geometry: geo, material: mat })).toThrow(
      /material handle is invalid or destroyed/,
    );
    // mesh.create validates both handles before incrementing either, so a
    // failed material lookup leaves the geometry refcount untouched.
    expect(_lookupGeometry<GeometrySlot>(ctx, geo)?.userCount).toBe(before);

    geometry.destroy(ctx, geo);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "1000-iteration spawn/despawn loop with shared geometry exercises pool reuse",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(0, 0, 1, 1),
    });
    const geo = geometry.cube(ctx);
    const handles: ReturnType<typeof mesh.create>[] = [];
    for (let i = 0; i < 1000; i++) {
      if (i % 3 === 0 && handles.length > 0) {
        const m = handles.pop();
        if (m !== undefined) mesh.destroy(ctx, m);
      } else {
        handles.push(mesh.create(ctx, { geometry: geo, material: mat }));
      }
    }
    for (const m of handles) mesh.destroy(ctx, m);
    expect(_lookupGeometry<GeometrySlot>(ctx, geo)?.userCount).toBe(0);
    geometry.destroy(ctx, geo);
    material.destroy(ctx, mat);
    gpu.dispose(ctx);
  },
);
