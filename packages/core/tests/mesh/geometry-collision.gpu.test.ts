// GPU skeleton (see Testing conventions)
import { expect, test } from "bun:test";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const DATA = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
};

test.skipIf(!bunWebGpuAvailable())(
  "retainForCollision keeps positions+u32 indices; default retains nothing",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const g1 = geometry.create(ctx, DATA, { retainForCollision: true });
    const c = geometry.getCollisionData(ctx, g1);
    expect(c).not.toBeNull();
    expect(Array.from(c?.indices ?? [])).toEqual([0, 1, 2]);
    expect(c?.vertices.length).toBe(9);
    const g2 = geometry.create(ctx, DATA);
    expect(geometry.getCollisionData(ctx, g2)).toBeNull();
    geometry.destroy(ctx, g1);
    geometry.destroy(ctx, g2);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "retainForCollision without indices throws (a trimesh needs indices)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    expect(() =>
      geometry.create(
        ctx,
        { positions: DATA.positions, normals: DATA.normals, uvs: DATA.uvs },
        { retainForCollision: true },
      ),
    ).toThrow();
    gpu.dispose(ctx);
  },
);
