import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/char-move.ts";
import { generateRegion } from "../src/generator.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
const CAPSULE = { halfHeight: 0.6, radius: 0.3 };

function addRegionBody(
  ctx: gpu.Context,
  world: physics.World,
  seed: string,
  kind: "chamber" | "shaft",
  origin: [number, number, number],
) {
  const region = generateRegion({ seed, kind, origin });
  physics.createBody(ctx, world, {
    type: "static",
    shape: region.proxy,
    position: region.proxyPosition,
  });
}

test.skipIf(!bunWebGpuAvailable())(
  "player walks across the chamber voxel floor without stalling",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    addRegionBody(ctx, world, "chamber-1", "chamber", [0, 0, 0]);
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: [-2, 2, 0],
    });
    physics.step(ctx, world, 1 / 60);

    const mover = new CharacterMover(CAPSULE, body);
    let pos: [number, number, number] = [-2, 2, 0];
    for (let i = 0; i < 60; i++) {
      pos = mover.resolve(ctx, world, pos, [0, 0, 0], 1 / 60).pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, 1 / 60);
    }
    expect(pos[1]).toBeGreaterThan(-1); // grounded, not fallen
    const startX = pos[0];
    for (let i = 0; i < 60; i++) {
      pos = mover.resolve(ctx, world, pos, [3 / 60, 0, 0], 1 / 60).pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, 1 / 60);
    }
    expect(pos[0]).toBeGreaterThan(startX + 1.5); // real horizontal progress

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "player dropped into the shaft is caught by the voxel proxy (no fall-through)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    addRegionBody(ctx, world, "shaft-1", "shaft", [0, 0, 0]);
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: [0, 1, 0],
    });
    physics.step(ctx, world, 1 / 60);

    const mover = new CharacterMover(CAPSULE, body);
    let pos: [number, number, number] = [0, 1, 0];
    for (let i = 0; i < 240; i++) {
      pos = mover.resolve(ctx, world, pos, [0, 0, 0], 1 / 60).pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, 1 / 60);
    }
    // Caught on the shaft floor (top solid voxel ~world y=-6 → body centre ~-5.1,
    // noise can deepen it to ~-5.6). `> -6` brackets the real floor and excludes
    // both the grid bottom (-7) and a fall-through (would be tens of metres down).
    expect(pos[1]).toBeGreaterThan(-6);
    expect(pos[1]).toBeLessThan(0);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
