import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import type { GeometrySlot } from "../../src/mesh/types.ts";
import { _lookupGeometry } from "../../src/resources/internal.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "destroyGeometry while a mesh references it defers actual teardown",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await material.unlit(ctx, {
      color: vec4.fromValues(1, 0, 0, 1),
    });
    const geo = mesh.cubeGeometry(ctx);
    const cube = mesh.create(ctx, { geometry: geo, material: mat });

    // userCount === 1 after mesh.create
    const slotBefore = _lookupGeometry<GeometrySlot>(ctx, geo);
    expect(slotBefore?.userCount).toBe(1);

    // Destroy geometry FIRST — deferred via markedDestroyed
    mesh.destroyGeometry(ctx, geo);
    const slotAfterMark = _lookupGeometry<GeometrySlot>(ctx, geo);
    expect(slotAfterMark).not.toBeNull();
    expect(slotAfterMark?.markedDestroyed).toBe(true);

    // Destroying the mesh should now trigger geometry teardown
    mesh.destroy(ctx, cube);
    expect(_lookupGeometry(ctx, geo)).toBeNull();

    material.destroy(mat);
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
    const geo = mesh.cubeGeometry(ctx);
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

    mesh.destroyGeometry(ctx, geo);
    expect(_lookupGeometry(ctx, geo)).toBeNull();

    material.destroy(mat);
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
    const geo = mesh.cubeGeometry(ctx);
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
    mesh.destroyGeometry(ctx, geo);
    material.destroy(mat);
    gpu.dispose(ctx);
  },
);
