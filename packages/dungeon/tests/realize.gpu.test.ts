import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import { pillarHall } from "../src/themes/pillar-hall.ts";
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
    const data = pillarHall({
      theme: "pillarHall",
      seed: "r-1",
      origin: [0, 0, 0],
    });

    const realized = await realizeRegion(ctx, world, cache, data);
    expect(realized.meshes.length).toBe(data.meshes.length);
    // a ray straight down from above the room centre hits a static collider (ceiling or floor)
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
