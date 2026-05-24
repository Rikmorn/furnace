import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { cubeGeometry } from "../../src/mesh/factories/cube.ts";
import { planeGeometry } from "../../src/mesh/factories/plane.ts";
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
    expect(g.vertexCount).toBe(24);
    expect(g.indexCount).toBe(36);
    expect(g.indexFormat).toBe("uint16");
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "cubeGeometry accepts a size option",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = cubeGeometry(ctx, { size: 2 });
    expect(g.vertexCount).toBe(24);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "planeGeometry produces a Geometry with 4 vertices and 6 indices",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const g = planeGeometry(ctx);
    expect(g.vertexCount).toBe(4);
    expect(g.indexCount).toBe(6);
    gpu.dispose(ctx);
  },
);
