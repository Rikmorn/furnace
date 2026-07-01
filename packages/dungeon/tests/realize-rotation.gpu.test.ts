import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { vec3 } from "@furnace/core/transform";
import { aabbOfBoxes } from "../src/aabb.ts";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import type { RegionData } from "../src/region.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "realize applies a region collider's rotation (a 30°-yaw thin slab still supports a ball)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const yaw = Math.PI / 6;
    const q: [number, number, number, number] = [
      0,
      Math.sin(yaw / 2),
      0,
      Math.cos(yaw / 2),
    ];
    const data: RegionData = {
      meshes: [
        {
          geometry: { box: [10, 0.4, 0.4] },
          material: 0,
          position: [0, 0, 0],
          rotation: q,
        },
      ],
      colliders: [
        { shape: { cuboid: [5, 0.2, 0.2] }, position: [0, 0, 0], rotation: q },
      ],
      materials: [{ color: [0.5, 0.5, 0.5, 1], specular: [0, 0, 0, 8] }],
      connections: [],
      instances: [],
      origin: [0, 0, 0],
      bounds: aabbOfBoxes([
        { center: [0, 0, 0], size: [10, 0.4, 0.4], rotation: q },
      ]),
      provenance: {
        generatorId: "dungeon",
        generatorVersion: 2,
        theme: "connector",
        seed: "rot-test",
      },
    };
    const region = await realizeRegion(ctx, world, cache, data);
    // Point at distance 4 along the slab's rotated long axis (world X̂ rotated by yaw):
    // [4cos(yaw), _, -4sin(yaw)] — on the rotated slab, OFF an axis-aligned one (|z| > 0.2).
    const px = 4 * Math.cos(yaw);
    const pz = -4 * Math.sin(yaw);
    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.2 },
      position: [px, 2, pz],
    });
    for (let i = 0; i < 180; i++) physics.step(ctx, world, 1 / 60);
    const out = physics.getBodyTranslation(ctx, ball, vec3.create());
    expect(out[1] as number).toBeGreaterThan(-0.5); // rested on the slab, did not fall to the void

    region.destroy();
    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
