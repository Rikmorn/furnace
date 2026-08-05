// Repro + regression guard for the applyGravity levitation bug surfaced by the F0
// analyzer probe (docs/learnings/2026-07-15-analyzer-corpus-probe.md §"Surfaced
// shipped-code bug"): the rest sweep lifted the capsule by STEP_HEIGHT before
// sweeping down; on any walkable floor with < CAPSULE_HEIGHT + STEP_HEIGHT (2.2 m)
// of clearance the lifted pose starts inside rock, castShape (stopAtPenetration)
// returns toi 0, and restY = pos.y + STEP_HEIGHT — the capsule climbs 0.4 m/frame
// while REPORTING GROUNDED. F1 digs low tunnels, so this is the new normal case.
import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import { boxCavern } from "../field/field.ts";
import { voxelProxyPosition, voxelsFromField } from "../field/proxy.ts";
import type { GridConfig } from "../field/surface-nets.ts";
import { CharacterMover } from "./char-move.ts";

await ensureBunWebGpu();

const CAPSULE = { halfHeight: 0.6, radius: 0.3 };
const REST_Y = 0.92; // foot offset 0.9 + small drop-in
const DT = 1 / 60;
const FRAME_STEP = 3 * DT; // walk speed 3 m/s

/** A flat-floored room with a LOW ceiling: air y in (0, 2.0) — clearance 2.0 m,
 *  above the 1.8 m capsule, below the 2.2 m the old rest sweep needed. */
const LOW_ROOM_CLEARANCE = 2.0;
const GRID: GridConfig = {
  min: [-4.5, -1, -4.5],
  cellSize: 0.25,
  dims: [36, 16, 36],
};

async function withLowRoom(
  run: (args: {
    ctx: gpu.Context;
    world: physics.World;
    mover: CharacterMover;
    body: physics.Body;
  }) => void,
): Promise<void> {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  try {
    const field = boxCavern(
      0,
      LOW_ROOM_CLEARANCE / 2,
      0,
      4,
      LOW_ROOM_CLEARANCE / 2,
      4,
    );
    const proxy = voxelsFromField(field, GRID, [0.5, 0.25, 0.5]);
    physics.createBody(ctx, world, {
      type: "static",
      shape: { voxels: { coords: proxy.coords, size: proxy.size } },
      position: voxelProxyPosition(GRID, [0, 0, 0]),
    });
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: [0, REST_Y, 0],
    });
    const mover = new CharacterMover(CAPSULE, body);
    run({ ctx, world, mover, body });
  } finally {
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  }
}

test.skipIf(!bunWebGpuAvailable())(
  "standing still on a sub-2.2 m-clearance floor holds height while grounded (no levitation)",
  async () => {
    await withLowRoom(({ ctx, world, mover, body }) => {
      let pos: [number, number, number] = [0, REST_Y, 0];
      for (let i = 0; i < 90; i++) {
        const res = mover.resolve(ctx, world, pos, [0, 0, 0], DT);
        pos = res.pos;
        physics.setBodyNextKinematicTranslation(ctx, body, pos);
        physics.step(ctx, world, DT);
        // Settle window: bodies aren't queryable until the world has stepped
        // (the field-walk harness settles 3 frames for the same reason).
        if (i < 3) continue;
        expect(res.grounded).toBe(true);
        // The levitator climbed +0.4 m/frame; a resting capsule must hold height.
        expect(pos[1]).toBeLessThan(REST_Y + 0.2);
        expect(pos[1]).toBeGreaterThan(REST_Y - 0.3);
      }
    });
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "walking under the low ceiling advances normally and stays on the floor",
  async () => {
    await withLowRoom(({ ctx, world, mover, body }) => {
      let pos: [number, number, number] = [-3, REST_Y, 0];
      let maxY = pos[1];
      for (let i = 0; i < 240; i++) {
        pos = mover.resolve(ctx, world, pos, [FRAME_STEP, 0, 0], DT).pos;
        physics.setBodyNextKinematicTranslation(ctx, body, pos);
        physics.step(ctx, world, DT);
        maxY = Math.max(maxY, pos[1]);
        if (pos[0] > 3) break;
      }
      expect(pos[0]).toBeGreaterThan(2); // no stationarity regression from the fix
      expect(maxY).toBeLessThan(REST_Y + 0.3); // and no climb along the way
    });
  },
);
