import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as physics from "../../src/physics/index.ts";
import { vec3 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

function slabCoords(): Int32Array {
  const c: number[] = [];
  for (let i = -2; i <= 2; i++) for (let k = -2; k <= 2; k++) c.push(i, 0, k);
  return new Int32Array(c); // 5x1x5 layer at j=0
}

test.skipIf(!bunWebGpuAvailable())(
  "castRay hits a voxel slab from above; a dynamic ball rests on it",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    physics.createBody(ctx, world, {
      type: "static",
      shape: { voxels: { coords: slabCoords(), size: [1, 1, 1] } },
      position: [0, 0, 0],
    });
    physics.step(ctx, world, 1 / 60);

    const hit = physics.castRay(ctx, world, {
      origin: [0, 4, 0],
      dir: [0, -1, 0],
      maxDistance: 8,
    });
    expect(hit).not.toBeNull();
    // VERIFIED (this session): Rapier voxels are CORNER-anchored, not centred.
    // Voxel (0,0,0) with size 1 occupies the cell [0,1]^3, so its top face is at
    // y≈1.0 (NOT 0.5). Task 2's voxelProxyPosition must use HALF_VOXEL=0 (corner),
    // not +0.5*size (centre), to align the proxy with the field cells.
    if (hit) expect(hit.point[1]).toBeCloseTo(1.0, 1);

    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.5 },
      position: [0, 5, 0],
    });
    for (let i = 0; i < 240; i++) physics.step(ctx, world, 1 / 60);
    const pos = physics.getBodyTranslation(ctx, ball, vec3.create());
    // Slab top at y≈1.0 + ball radius 0.5 → centre rests near y≈1.5.
    expect(pos[1]).toBeGreaterThan(1.1);
    expect(pos[1]).toBeLessThan(2.1);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "castShape sweeps a capsule into a voxel wall and returns a normal opposing travel",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const c: number[] = [];
    for (let j = 0; j <= 3; j++) for (let k = -2; k <= 2; k++) c.push(3, j, k);
    physics.createBody(ctx, world, {
      type: "static",
      shape: { voxels: { coords: new Int32Array(c), size: [1, 1, 1] } },
      position: [0, 0, 0],
    });
    physics.step(ctx, world, 1 / 60);

    const hit = physics.castShape(ctx, world, {
      shape: { capsule: { halfHeight: 0.6, radius: 0.3 } },
      position: [0, 1, 0],
      dir: [1, 0, 0],
      maxDistance: 5,
    });
    expect(hit).not.toBeNull();
    if (hit) expect(hit.normal[0]).toBeLessThan(0);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
