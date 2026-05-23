import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { createGeometry, destroyGeometry } from "../../src/mesh/geometry.ts";
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
    expect(g.vertexBuffer).toBeDefined();
    expect(g.vertexCount).toBe(3);
    expect(g.indexBuffer).toBe(null);
    destroyGeometry(g);
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
    expect(g.indexBuffer).not.toBe(null);
    expect(g.indexFormat).toBe("uint16");
    expect(g.indexCount).toBe(3);
    destroyGeometry(g);
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
