import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import * as stats from "@furnace/core/stats";
import { mat4, quat, vec3 } from "@furnace/core/transform";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import type { InstanceGroup, RegionData } from "../src/region.ts";
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

test.skipIf(!bunWebGpuAvailable())(
  "solid scatter realizes a static collider per instance that supports a dropped ball",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, {
      gravity: [0, -9.81, 0],
      lengthUnit: 1,
    });
    const cache = new MaterialCache(ctx);

    const xform = mat4.fromRotationTranslationScale(
      mat4.create(),
      quat.create(),
      vec3.fromValues(0, 0.5, 0),
      vec3.fromValues(1, 1, 1),
    );
    const group: InstanceGroup = {
      geometry: { primitive: "cube" },
      material: 0,
      posture: "lit",
      transforms: new Float32Array(xform),
      tints: new Float32Array([1, 1, 1, 1]),
      collision: "solid",
      placements: [
        {
          position: [0, 0.5, 0],
          rotation: [0, 0, 0, 1],
          scale: 1,
          tint: [1, 1, 1, 1],
        },
      ],
    };
    const data: RegionData = {
      meshes: [],
      colliders: [],
      materials: [{ color: [0.6, 0.6, 0.6, 1], specular: [0, 0, 0, 0] }],
      connections: [],
      instances: [group],
      origin: [0, 0, 0],
      provenance: {
        generatorId: "dungeon",
        generatorVersion: 2,
        theme: "cave",
        seed: "t",
      },
    };

    const region = await realizeRegion(ctx, world, cache, data);

    // A ball dropped straight onto the solid cube (half 0.5, top at y=1.0) rests on it,
    // not through it. (Interaction asserted, not just body count.)
    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.2 },
      position: [0, 3, 0],
    });
    for (let i = 0; i < 180; i++) physics.step(ctx, world, 1 / 60);
    const p = physics.getBodyTranslation(ctx, ball, vec3.create());
    expect(p[1] as number).toBeGreaterThan(1.0); // resting on top of the fixture, well above the y=0 void

    region.destroy();
    physics.destroyWorld(ctx, world);
    cache.destroy();
    gpu.dispose(ctx);
  },
);
