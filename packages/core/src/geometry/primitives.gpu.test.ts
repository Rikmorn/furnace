import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { _lookupGeometry } from "../resources/internal.ts";
import * as geometry from "./index.ts";
import type { GeometrySlot } from "./types.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "geometry.cube produces a Geometry with 24 vertices and 36 indices",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = geometry.cube(ctx);
    const slot = _lookupGeometry<GeometrySlot>(ctx, g);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexCount).toBe(24);
    expect(slot.indexCount).toBe(36);
    expect(slot.indexFormat).toBe("uint16");
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "geometry.cube accepts a size option",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = geometry.cube(ctx, { size: 2 });
    const slot = _lookupGeometry<GeometrySlot>(ctx, g);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexCount).toBe(24);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "geometry.plane produces a Geometry with 4 vertices and 6 indices",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = geometry.plane(ctx);
    const slot = _lookupGeometry<GeometrySlot>(ctx, g);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexCount).toBe(4);
    expect(slot.indexCount).toBe(6);
    gpu.dispose(ctx);
  },
);
