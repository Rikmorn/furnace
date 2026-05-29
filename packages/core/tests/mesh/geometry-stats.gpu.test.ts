import { expect, test } from "bun:test";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import { snapshot } from "../../src/stats/public.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "geometry.create: registers 1 geometry + 1 vertex buffer (+ index buffer if indexed)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx);
    const geo = geometry.cube(ctx);
    const after = snapshot(ctx);
    expect(after.resources.geometries - before.resources.geometries).toBe(1);
    expect(
      after.memory.bufferBytes - before.memory.bufferBytes,
    ).toBeGreaterThan(0);
    geometry.destroy(ctx, geo);
    const final = snapshot(ctx);
    expect(final.resources.geometries).toBe(before.resources.geometries);
    expect(final.memory.bufferBytes).toBe(before.memory.bufferBytes);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "non-indexed geometry: create + destroy round-trips bufferBytes",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    const before = snapshot(ctx).memory.bufferBytes;

    // Minimal non-indexed triangle: 3 vertices, each with position (vec3),
    // normal (vec3), uv (vec2). Validation requires all three attribute
    // arrays. Interleaved buffer = 3 verts × 8 floats × 4 bytes = 96 bytes;
    // already a multiple of 4 so no padding.
    const geo = geometry.create(ctx, {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      // No `indices` — exercises the non-indexed path (indexBytes === 0).
    });

    const expectedVertexBytes = 3 * 8 * 4;
    const after = snapshot(ctx).memory.bufferBytes;
    expect(after - before).toBe(expectedVertexBytes);

    geometry.destroy(ctx, geo);
    expect(snapshot(ctx).memory.bufferBytes).toBe(before);

    gpu.dispose(ctx);
  },
);
