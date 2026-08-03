import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { _lookupGeometry } from "../resources/internal.ts";
import { sphere } from "./factories/sphere.ts";
import type { GeometrySlot } from "./types.ts";

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
