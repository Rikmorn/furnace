import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/char-move.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const CAPSULE = { halfHeight: 0.6, radius: 0.3 };

test.skipIf(!bunWebGpuAvailable())(
  "horizontal move into an angled wall slides along it (keeps tangential motion)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    // Wall facing -x at x=1.0.
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [0.1, 2, 5] },
      position: [1.2, 0, 0],
    });
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: [0, 1, 0],
    });
    physics.step(ctx, world, 1 / 60);

    const mover = new CharacterMover(CAPSULE, body);
    // Desired: into the wall (+x) and along it (+z). Should be blocked in x, free in z.
    const r = mover.slideHorizontal(ctx, world, [0, 1, 0], [0.2, 0, 0.2]);
    expect(r[0]).toBeLessThan(0.95); // didn't pass through the wall (face ~0.8 after radius)
    expect(r[2]).toBeCloseTo(0.2, 2); // slid freely along z

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
