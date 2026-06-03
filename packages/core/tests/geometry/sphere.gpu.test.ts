import { expect, test } from "bun:test";
import { sphere } from "../../src/geometry/factories/sphere.ts";
import type { GeometrySlot } from "../../src/geometry/types.ts";
import * as gpu from "../../src/gpu/index.ts";
import { _lookupGeometry } from "../../src/resources/internal.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "geometry.sphere uploads a live Geometry",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const g = sphere(ctx);
    const slot = _lookupGeometry<GeometrySlot>(ctx, g);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexCount).toBe(561);
    expect(slot.indexCount).toBe(3072);
    expect(slot.indexFormat).toBe("uint16");
    gpu.dispose(ctx);
  },
);
