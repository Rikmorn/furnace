import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { createGeometry, destroyGeometry } from "../../src/mesh/geometry.ts";
import type { GeometrySlot } from "../../src/mesh/types.ts";
import { _lookupGeometry } from "../../src/resources/internal.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "createGeometry allocates an interleaved vertex buffer (non-indexed)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = createGeometry(ctx, {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    });
    const slot = _lookupGeometry<GeometrySlot>(ctx, g);
    if (!slot) throw new Error("unreachable: slot should be live");
    expect(slot.vertexBuffer).toBeDefined();
    expect(slot.vertexCount).toBe(3);
    expect(slot.indexBuffer).toBe(null);
    destroyGeometry(ctx, g);
    expect(_lookupGeometry<GeometrySlot>(ctx, g)).toBe(null);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createGeometry allocates an index buffer when indices are provided",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = createGeometry(ctx, {
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
    destroyGeometry(ctx, g);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createGeometry rejects malformed input before touching the GPU",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    expect(() =>
      createGeometry(ctx, {
        positions: new Float32Array([0, 0, 0, 1]),
        normals: new Float32Array([0, 0, 1]),
        uvs: new Float32Array([0, 0]),
      }),
    ).toThrow(/multiple of 3/);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "destroyGeometry is idempotent: second call on a stale handle is a silent no-op",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = createGeometry(ctx, {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    });
    destroyGeometry(ctx, g);
    expect(() => destroyGeometry(ctx, g)).not.toThrow();
    expect(_lookupGeometry<GeometrySlot>(ctx, g)).toBe(null);
    gpu.dispose(ctx);
  },
);
