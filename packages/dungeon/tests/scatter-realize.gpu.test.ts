import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import * as stats from "@furnace/core/stats";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import { cave } from "../src/themes/cave.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "realizeRegion creates one instanced mesh per group, frees on destroy",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const data = cave({ theme: "cave", seed: "cv", origin: [0, 0, 0] });
    expect(data.instances.length).toBeGreaterThan(0); // precondition: cave has scatter

    const before = stats.snapshot(ctx).resources.instancedMeshes;
    const realized = await realizeRegion(ctx, world, cache, data);
    expect(realized.instanced.length).toBe(data.instances.length); // one InstancedMesh per group
    expect(stats.snapshot(ctx).resources.instancedMeshes - before).toBe(
      data.instances.length,
    );

    realized.destroy();
    expect(stats.snapshot(ctx).resources.instancedMeshes).toBe(before); // no leak

    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
