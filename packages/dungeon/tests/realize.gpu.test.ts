import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import { GENERATOR_VERSION, type RegionData } from "../src/region.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "realizeRegion builds meshes + static bodies, frees cleanly",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    // Minimal hand-built region: one box mesh + one matching cuboid collider — realize's
    // subject is the upload/instantiate/destroy path, not any generator.
    const data: RegionData = {
      meshes: [
        {
          geometry: { box: [4, 0.3, 4] },
          material: 0,
          position: [0, -0.15, 0],
        },
      ],
      colliders: [{ shape: { cuboid: [2, 0.15, 2] }, position: [0, -0.15, 0] }],
      materials: [
        { color: [0.5, 0.5, 0.52, 1], specular: [0.02, 0.02, 0.02, 8] },
      ],
      connections: [],
      instances: [],
      origin: [0, 0, 0],
      bounds: { min: [-2, -0.3, -2], max: [2, 0, 2] },
      provenance: {
        generatorId: "dungeon",
        generatorVersion: GENERATOR_VERSION,
        theme: "cave",
        seed: "r-1",
      },
    };

    const realized = await realizeRegion(ctx, world, cache, data);
    expect(realized.meshes.length).toBe(data.meshes.length);
    // a ray straight down from above the floor slab hits its static collider (top face at y=0)
    physics.step(ctx, world, 1 / 60);
    const hit = physics.castRay(ctx, world, {
      origin: [0, 5, 0],
      dir: [0, -1, 0],
      maxDistance: 10,
    });
    expect(hit).not.toBeNull();

    realized.destroy();
    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx); // warns on any leaked slot → clean shutdown is the leak check
  },
);
