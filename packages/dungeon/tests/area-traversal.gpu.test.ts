// Headless seam walk-probe. Builds the FULL placed world graph's collider set (cave
// voxels + connector cuboids + room cuboids) and WALKS the player capsule from inside
// the cave hub, out through a tunnel mouth, across the cave->connector->room seams, and
// into the room — asserting it never wedges, never falls through a seam, and actually
// enters the room. This converts the 2.2.1 gate-only seam class (curved-wall stall /
// floor stall / hall<->chamber fall-through) into a hard headless assert. It is
// WALK-IN, not drop-in: dropping a capsule rests it on top and hides the wedge, so this
// drives the real CharacterMover along a path.
import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/char-move.ts";
import { layoutWorld } from "../src/layout.ts";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import type { Connection, RegionData } from "../src/region.ts";
import { buildWorldGraph, WORLD_SEED } from "../src/world.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
const CAPSULE = { halfHeight: 0.6, radius: 0.3 };

test.skipIf(!bunWebGpuAvailable())(
  "player walks cave -> corridor -> room across a seam, no fall/stall",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const { regions, connectors } = layoutWorld(
      buildWorldGraph(WORLD_SEED),
      WORLD_SEED,
    );
    for (const r of [
      ...regions.filter((x) => x.provenance.theme !== "authored"),
      ...connectors,
    ])
      await realizeRegion(ctx, world, cache, r);

    const caveRegion = regions.find(
      (r) => r.provenance.theme === "cave",
    ) as RegionData;
    const mouth = (caveRegion.connections.find(
      (c) => c.kind === "door" && c.facing[0] === 1,
    ) ??
      caveRegion.connections.find(
        (c) => c.kind === "door" && c.facing[2] === 1,
      )) as Connection;

    // start just inside the cave hub (at its PLACED origin — layoutWorld no longer
    // guarantees the hub sits at world origin), walk toward the mouth
    const startY =
      mouth.position[1] + CAPSULE.halfHeight + CAPSULE.radius + 0.1;
    let pos: [number, number, number] = [
      caveRegion.origin[0],
      startY,
      caveRegion.origin[2],
    ];
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

test.skipIf(!bunWebGpuAvailable())(
  "player walks into greatHall and climbs onto the dais platform",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const { regions, connectors } = layoutWorld(
      buildWorldGraph(WORLD_SEED),
      WORLD_SEED,
    );
    for (const r of [
      ...regions.filter((x) => x.provenance.theme !== "authored"),
      ...connectors,
    ])
      await realizeRegion(ctx, world, cache, r);

    const caveRegion = regions.find(
      (r) => r.provenance.theme === "cave",
    ) as RegionData;
    const ghRegion = regions.find(
      (r) => r.provenance.theme === "greatHall",
    ) as RegionData;
    // The placed greatHall's door is its real entrance. The player walks from the cave hub
    // INTO the room — i.e. OPPOSITE the door's outward facing. (placePiece sets a placed
    // region's origin generically to xf(local origin), so we key off the door connection,
    // not origin, which also survives the Task-7 room gap.)
    const ghDoor = ghRegion.connections.find(
      (c) => c.kind === "door",
    ) as Connection;

    // capsule rest height on flat floor at mouth Y
    const flatFloorRestY =
      ghDoor.position[1] + CAPSULE.halfHeight + CAPSULE.radius;
    const startY = flatFloorRestY + 0.1;
    // start just inside the cave hub (at its PLACED origin) as in the first test above.
    let pos: [number, number, number] = [
      caveRegion.origin[0],
      startY,
      caveRegion.origin[2],
    ];
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: pos,
    });
    physics.step(ctx, world, 1 / 60);
    const mover = new CharacterMover(CAPSULE, body);
    // toward the room = opposite the door's outward facing
    const dir: [number, number, number] = [
      -ghDoor.facing[0],
      0,
      -ghDoor.facing[2],
    ];
    const mouthAlong =
      ghDoor.position[0] * dir[0] + ghDoor.position[2] * dir[2];
    // platTop ∈ [0.3, 0.8); 0.25 m is a robust threshold that any seed must reach
    const DAIS_RISE_THRESHOLD = 0.25;
    let minY = pos[1];
    let stalls = 0;
    let climbedDais = false;
    // greatHall depth up to ~31 m; walk at 3 m/s for 900 iterations (15 s) to
    // reach and climb onto the dais at the far end. Break early once the dais is
    // confirmed so the player does not continue into the far wall.
    for (let i = 0; i < 900; i++) {
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
      // stop as soon as we confirm the dais has been climbed — avoids walking into the far wall.
      // Guard with "past mouthAlong + 5" so cave/connector terrain variation cannot trigger this early.
      const depthNow = pos[0] * dir[0] + pos[2] * dir[2];
      if (
        depthNow > mouthAlong + 5 &&
        pos[1] > flatFloorRestY + DAIS_RISE_THRESHOLD
      ) {
        climbedDais = true;
        break;
      }
    }
    // entered the room (advanced past the mouth)
    const advanced = pos[0] * dir[0] + pos[2] * dir[2];
    expect(advanced).toBeGreaterThan(mouthAlong + 2);
    // climbed onto the dais: Y rose above flat-floor rest height
    expect(climbedDais).toBe(true);
    // never fell through the floor
    expect(minY).toBeGreaterThan(ghDoor.position[1] - 1);

    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
