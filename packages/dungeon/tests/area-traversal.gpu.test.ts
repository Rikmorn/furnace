// Headless seam walk-probe. Builds the FULL composed collider set buildArea
// produces (cave voxels + vestibule cuboid + room cuboids) and WALKS the player
// capsule from inside the cave hub, out through a tunnel mouth, across the
// cave->vestibule->room seams, and into the room — asserting it never wedges, never
// falls through a seam, and actually enters the room. This converts the 2.2.1
// gate-only seam class (curved-wall stall / floor stall / hall<->chamber fall-through)
// into a hard headless assert. It is WALK-IN, not drop-in: dropping a capsule rests
// it on top and hides the wedge, so this drives the real CharacterMover along a path.
import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/char-move.ts";
import { buildArea } from "../src/compose.ts";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import type { Connection, RegionData } from "../src/region.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
const CAPSULE = { halfHeight: 0.6, radius: 0.3 };

test.skipIf(!bunWebGpuAvailable())(
  "player walks cave -> vestibule -> room across a seam, no fall/stall",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const regions = buildArea("walk-1", [0, 0, 0]);
    for (const r of regions) await realizeRegion(ctx, world, cache, r);

    const caveRegion = regions.find(
      (r) => r.provenance.theme === "cave",
    ) as RegionData;
    const mouth = (caveRegion.connections.find(
      (c) => c.kind === "tunnel-mouth" && c.facing[0] === 1,
    ) ??
      caveRegion.connections.find(
        (c) => c.kind === "tunnel-mouth" && c.facing[2] === 1,
      )) as Connection;

    // start just inside the cave hub at the floor, walk toward the mouth
    const startY =
      mouth.position[1] + CAPSULE.halfHeight + CAPSULE.radius + 0.1;
    let pos: [number, number, number] = [0, startY, 0];
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: pos,
    });
    physics.step(ctx, world, 1 / 60);
    const mover = new CharacterMover(CAPSULE, body);
    const dir = mouth.facing; // unit toward the mouth/room
    let minY = pos[1];
    let stalls = 0;
    for (let i = 0; i < 400; i++) {
      const prev = pos;
      pos = mover.resolve(
        ctx,
        world,
        pos,
        [(dir[0] * 3) / 60, 0, (dir[2] * 3) / 60],
        1 / 60,
      ).pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, 1 / 60);
      minY = Math.min(minY, pos[1]);
      const progressed = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
      stalls = progressed ? 0 : stalls + 1;
      expect(stalls).toBeLessThan(45); // never wedged for ~0.75s
    }
    // crossed past the mouth into the room (advanced well beyond the mouth along `dir`)
    const advanced = pos[0] * dir[0] + pos[2] * dir[2];
    const mouthAlong = mouth.position[0] * dir[0] + mouth.position[2] * dir[2];
    expect(advanced).toBeGreaterThan(mouthAlong + 2); // entered the room
    expect(minY).toBeGreaterThan(mouth.position[1] - 1); // never fell through the seam

    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
