import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { cubeGeometry, destroyGeometry } from "../../src/mesh/index.ts";
import { snapshot } from "../../src/stats/public.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "createGeometry: registers 1 geometry + 1 vertex buffer (+ index buffer if indexed)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx);
    const geo = cubeGeometry(ctx);
    const after = snapshot(ctx);
    expect(after.resources.geometries - before.resources.geometries).toBe(1);
    expect(
      after.memory.bufferBytes - before.memory.bufferBytes,
    ).toBeGreaterThan(0);
    destroyGeometry(geo);
    const final = snapshot(ctx);
    expect(final.resources.geometries).toBe(before.resources.geometries);
    expect(final.memory.bufferBytes).toBe(before.memory.bufferBytes);
    gpu.dispose(ctx);
  },
);
