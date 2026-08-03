import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import { MaterialCache, realizeRegion } from "./realize.ts";
import { GENERATOR_VERSION, type RegionData } from "./region.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "realizeRegion builds meshes + static bodies, frees cleanly",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    // Hand-built region — realize's subject is the upload/instantiate/destroy path, not any
    // generator. Two meshes, deliberately: a floor slab (top face at y=0, under the down-ray,
    // with the only collider) and a wall slab standing beside it, CLEAR of the ray. The second
    // mesh is what gives the mesh-count assertion its teeth — with one mesh it would read
    // `1 === 1` and a partial-drop regression in realize's mesh loop would sail through. The
    // wall is render-only on purpose: the unequal array lengths (2 meshes, 1 collider) also
    // catch a mesh/collider list mix-up that a 1:1 fixture would hide.
    const data: RegionData = {
      meshes: [
        {
          geometry: { box: [4, 0.3, 4] },
          material: 0,
          position: [0, -0.15, 0],
        },
        { geometry: { box: [0.3, 2, 4] }, material: 0, position: [2.15, 1, 0] },
      ],
      colliders: [{ shape: { cuboid: [2, 0.15, 2] }, position: [0, -0.15, 0] }],
      materials: [
        { color: [0.5, 0.5, 0.52, 1], specular: [0.02, 0.02, 0.02, 8] },
      ],
      connections: [],
      instances: [],
      origin: [0, 0, 0],
      // Covers the union: floor x/z ∈ [−2, 2], y ∈ [−0.3, 0]; wall x ∈ [2.0, 2.3], y ∈ [0, 2].
      bounds: { min: [-2, -0.3, -2], max: [2.3, 2, 2] },
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
