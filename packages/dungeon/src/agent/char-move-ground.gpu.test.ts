import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import { CharacterMover } from "./char-move.ts";

await ensureBunWebGpu();
const CAPSULE = { halfHeight: 0.6, radius: 0.3 };

test.skipIf(!bunWebGpuAvailable())(
  "applyGravity keeps the capsule resting just above a floor and reports grounded",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.1, 5] },
      position: [0, 0, 0], // top face y=0.1
    });
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: [0, 1.0, 0],
    });
    physics.step(ctx, world, 1 / 60);

    const mover = new CharacterMover(CAPSULE, body);
    // Foot rests at floorTop + halfHeight + radius = 0.1 + 0.9 = 1.0.
    let pos: [number, number, number] = [0, 1.0, 0];
    let grounded = false;
    for (let i = 0; i < 30; i++) {
      const r = mover.applyGravity(ctx, world, pos, 1 / 60);
      pos = r.pos;
      grounded = r.grounded;
    }
    expect(grounded).toBe(true);
    expect(pos[1]).toBeCloseTo(1.0, 1); // rests, doesn't sink or fall

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
