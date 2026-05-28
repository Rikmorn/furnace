import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { cubeGeometry } from "../../src/mesh/factories/cube.ts";
import { planeGeometry } from "../../src/mesh/factories/plane.ts";
import type { GeometrySlot } from "../../src/mesh/types.ts";
import { _lookupGeometry } from "../../src/resources/internal.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "cubeGeometry produces a Geometry with 24 vertices and 36 indices",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = cubeGeometry(ctx);
    const slot = _lookupGeometry<GeometrySlot>(ctx, g);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexCount).toBe(24);
    expect(slot.indexCount).toBe(36);
    expect(slot.indexFormat).toBe("uint16");
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "cubeGeometry accepts a size option",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = cubeGeometry(ctx, { size: 2 });
    const slot = _lookupGeometry<GeometrySlot>(ctx, g);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexCount).toBe(24);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "planeGeometry produces a Geometry with 4 vertices and 6 indices",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = planeGeometry(ctx);
    const slot = _lookupGeometry<GeometrySlot>(ctx, g);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexCount).toBe(4);
    expect(slot.indexCount).toBe(6);
    gpu.dispose(ctx);
  },
);
