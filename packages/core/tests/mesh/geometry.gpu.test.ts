import { expect, test } from "bun:test";
import * as geometry from "../../src/geometry/index.ts";
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
  "geometry.create allocates an interleaved vertex buffer (non-indexed)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = geometry.create(ctx, {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    });
    const slot = _lookupGeometry<GeometrySlot>(ctx, g);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexBuffer).toBeDefined();
    expect(slot.vertexCount).toBe(3);
    expect(slot.indexBuffer).toBe(null);
    geometry.destroy(ctx, g);
    expect(_lookupGeometry<GeometrySlot>(ctx, g)).toBe(null);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "geometry.create allocates an index buffer when indices are provided",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = geometry.create(ctx, {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
    });
    const slot = _lookupGeometry<GeometrySlot>(ctx, g);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.indexBuffer).not.toBe(null);
    expect(slot.indexFormat).toBe("uint16");
    expect(slot.indexCount).toBe(3);
    geometry.destroy(ctx, g);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "geometry.create rejects malformed input before touching the GPU",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    expect(() =>
      geometry.create(ctx, {
        positions: new Float32Array([0, 0, 0, 1]),
        normals: new Float32Array([0, 0, 1]),
        uvs: new Float32Array([0, 0]),
      }),
    ).toThrow(/multiple of 3/);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "geometry.destroy is idempotent: second call on a stale handle is a silent no-op",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = geometry.create(ctx, {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    });
    geometry.destroy(ctx, g);
    expect(() => geometry.destroy(ctx, g)).not.toThrow();
    expect(_lookupGeometry<GeometrySlot>(ctx, g)).toBe(null);
    gpu.dispose(ctx);
  },
);
