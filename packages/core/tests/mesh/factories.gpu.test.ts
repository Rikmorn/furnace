import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { unlit } from "../../src/material/unlit.ts";
import { cube, plane } from "../../src/mesh/factories";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "mesh.cube produces a Mesh with the cube geometry attached",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: [1, 1, 1, 1] });
    const m = cube(ctx, { material: mat });
    expect(m.geometry.vertexCount).toBe(24);
    expect(m.geometry.indexCount).toBe(36);
    expect(m.material).toBe(mat);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "mesh.plane produces a Mesh with the plane geometry attached",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: [1, 1, 1, 1] });
    const m = plane(ctx, { material: mat, size: 3 });
    expect(m.geometry.vertexCount).toBe(4);
    expect(m.geometry.indexCount).toBe(6);
    gpu.dispose(ctx);
  },
);
