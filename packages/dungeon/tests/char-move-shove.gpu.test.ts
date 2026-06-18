import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { vec3 } from "@furnace/core/transform";
import { shoveDynamicBodies } from "../src/char-move.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const CAPSULE = { halfHeight: 0.6, radius: 0.3 };
const SHOVE_SPEED = 3;
const SHOVE_REACH = 0.6;
const TICKS = 20;
const DT = 1 / 60;
// Capsule centre with the feet resting EXACTLY on the floor top (y=0.1) — the
// realistic in-game case, where applyGravity snaps the capsule bottom onto the
// floor. footOffset = halfHeight + radius = 0.9, so centre = 0.1 + 0.9 = 1.0.
// The forward shove cast must clear this resting surface (else its rounded
// bottom grazes the floor and returns the floor instead of the prop ahead).
const CAPSULE_Y = 1.0;

test.skipIf(!bunWebGpuAvailable())(
  "shoveDynamicBodies pushes a shovable prop ahead of the capsule along +x",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    // Floor: top face at y=0.1, so a 0.25-half-extent prop rests centred at y=0.35.
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.1, 5] },
      position: [0, 0, 0],
    });
    // A dynamic prop just ahead of the player along +x.
    const prop = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { cuboid: [0.25, 0.25, 0.25] },
      position: [1, 0.35, 0],
      friction: 0.8,
    });
    // A kinematic capsule whose cylinder body overlaps the prop vertically.
    const player = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: [0, CAPSULE_Y, 0],
    });
    physics.step(ctx, world, DT); // populate broadphase + let the prop settle

    const pos = vec3.create();
    physics.getBodyTranslation(ctx, prop, pos);
    const startX = pos[0] as number;

    const shovable = new Set([prop]);
    for (let i = 0; i < TICKS; i++) {
      shoveDynamicBodies(
        ctx,
        world,
        CAPSULE,
        player,
        [0, CAPSULE_Y, 0],
        [1, 0, 0],
        shovable,
        SHOVE_SPEED,
        SHOVE_REACH,
      );
      physics.step(ctx, world, DT);
    }

    physics.getBodyTranslation(ctx, prop, pos);
    const endX = pos[0] as number;
    expect(endX).toBeGreaterThan(startX + 0.1); // the prop was pushed forward

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "shoveDynamicBodies leaves a prop that is NOT in the shovable set unmoved",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.1, 5] },
      position: [0, 0, 0],
    });
    const prop = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { cuboid: [0.25, 0.25, 0.25] },
      position: [1, 0.35, 0],
      friction: 0.8,
    });
    const player = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: [0, CAPSULE_Y, 0],
    });
    physics.step(ctx, world, DT);

    const pos = vec3.create();
    physics.getBodyTranslation(ctx, prop, pos);
    const startX = pos[0] as number;

    const shovable = new Set<physics.Body>(); // prop is NOT shovable
    for (let i = 0; i < TICKS; i++) {
      shoveDynamicBodies(
        ctx,
        world,
        CAPSULE,
        player,
        [0, CAPSULE_Y, 0],
        [1, 0, 0],
        shovable,
        SHOVE_SPEED,
        SHOVE_REACH,
      );
      physics.step(ctx, world, DT);
    }

    physics.getBodyTranslation(ctx, prop, pos);
    const endX = pos[0] as number;
    expect(Math.abs(endX - startX)).toBeLessThan(0.05); // unshoved → effectively still

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
