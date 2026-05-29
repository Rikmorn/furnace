import { expect, test } from "bun:test";
import * as geometry from "../../src/geometry/index.ts";
import type { GeometrySlot } from "../../src/geometry/types.ts";
import * as gpu from "../../src/gpu/index.ts";
import { unlit } from "../../src/material/unlit.ts";
import { _resolveMesh } from "../../src/mesh/internal.ts";
import { create, destroy } from "../../src/mesh/mesh.ts";
import { _lookupGeometry } from "../../src/resources/internal.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "geometry.cube produces a Geometry with 24 vertices and 36 indices",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: vec4.fromValues(1, 1, 1, 1) });
    const geom = geometry.cube(ctx);
    const m = create(ctx, { geometry: geom, material: mat });
    const meshSlot = _resolveMesh(ctx, m);
    const slot = _lookupGeometry<GeometrySlot>(ctx, meshSlot.geometry);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexCount).toBe(24);
    expect(slot.indexCount).toBe(36);
    expect(meshSlot.material).toBe(mat);
    destroy(ctx, m);
    geometry.destroy(ctx, geom);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "geometry.plane produces a Geometry with 4 vertices and 6 indices",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: vec4.fromValues(1, 1, 1, 1) });
    const geom = geometry.plane(ctx, { size: 3 });
    const m = create(ctx, { geometry: geom, material: mat });
    const meshSlot = _resolveMesh(ctx, m);
    const slot = _lookupGeometry<GeometrySlot>(ctx, meshSlot.geometry);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexCount).toBe(4);
    expect(slot.indexCount).toBe(6);
    destroy(ctx, m);
    geometry.destroy(ctx, geom);
    gpu.dispose(ctx);
  },
);
