// Repro + regression guard for the applyGravity levitation bug surfaced by the F0
// analyzer probe (docs/learnings/2026-07-15-analyzer-corpus-probe.md §"Surfaced
// shipped-code bug"): the rest sweep lifted the capsule by STEP_HEIGHT before
// sweeping down; on any walkable floor with < CAPSULE_HEIGHT + STEP_HEIGHT (2.2 m)
// of clearance the lifted pose starts inside rock, castShape (stopAtPenetration)
// returns toi 0, and restY = pos.y + STEP_HEIGHT — the capsule climbs 0.4 m/frame
// while REPORTING GROUNDED. F1 digs low tunnels, so this is the new normal case.
//
// The fixture rides the FIELD path: one box `dig` into a `createFieldStore`, then one
// static shell voxel collider per allocated chunk — `field-world.ts`'s
// `createColliderBodies` in behaviour, so this guards the collision the runtime loader
// actually builds. Its load-bearing property is the LOW ceiling, and a port that
// silently widened the gap would leave every assertion below passing while guarding
// nothing — so the first test MEASURES the headroom against the built colliders rather
// than trusting the construction.
import { expect, test } from "bun:test";
import * as field from "@furnace/core/field";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import { CharacterMover } from "./char-move.ts";
import { STEP_HEIGHT } from "./walkability.ts";

await ensureBunWebGpu();

const CAPSULE = { halfHeight: 0.6, radius: 0.3 };
const CAPSULE_HEIGHT = 2 * (CAPSULE.halfHeight + CAPSULE.radius); // 1.8 m
const REST_Y = 0.92; // foot offset 0.9 + small drop-in
const DT = 1 / 60;
const FRAME_STEP = 3 * DT; // walk speed 3 m/s

/** A flat-floored room with a LOW ceiling: clearance 2.0 m, above the 1.8 m capsule,
 *  below the 2.2 m the old rest sweep needed. */
const LOW_ROOM_CLEARANCE = 2.0;
const CELL = field.DEFAULT_CELL_SIZE; // 0.25 m — the store's sample spacing
/** Free-gap arithmetic, and the reason the dug box is NOT 2.0 m tall. Samples live at
 *  `index * CELL`, and `chunkColliders` emits CORNER-anchored voxels — solid sample `s`
 *  spans `[s * CELL, (s + 1) * CELL]` — so the gap between the floor's top face and the
 *  ceiling's underside is (air samples) × CELL. Eight air samples (y = 0 … 1.75) is what
 *  buys the 2.0 m. */
const AIR_SAMPLES_Y = LOW_ROOM_CLEARANCE / CELL;
/** Slack that keeps each dug face strictly BETWEEN two sample planes, so no sample lands
 *  on an exact face (where `sdf === 0` decides air-vs-rock on a float compare). */
const FACE_SLACK = CELL / 5;
const AIR_LO_Y = -FACE_SLACK; // floor voxels' top face lands at y = 0
const AIR_HI_Y = (AIR_SAMPLES_Y - 1) * CELL + FACE_SLACK;
const ROOM_HALF_XZ = 4 + FACE_SLACK; // ±4 m of floor, as the retired boxCavern fixture had

/** Dig the low room into a fresh store with one public box brush, the same op the editor
 *  and the generators write through. An untouched store reads uniform SOLID, so the dig's
 *  own +1-sample margin lays the enclosing rock down in the same pass. */
function digLowRoom(): field.FieldStore {
  const store = field.createFieldStore(CELL);
  field.applyOp(
    store,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: {
        kind: "box",
        center: [0, (AIR_LO_Y + AIR_HI_Y) / 2, 0],
        halfExtents: [ROOM_HALF_XZ, (AIR_HI_Y - AIR_LO_Y) / 2, ROOM_HALF_XZ],
      },
    },
    field.BUILTIN_TABLE,
  );
  return store;
}

/** One static shell voxel collider per allocated chunk — `field-world.ts`'s
 *  `createColliderBodies`, so the mover below casts against the collision the runtime
 *  loader builds. Bodies die with the world; nothing is tracked for teardown. */
function createChunkColliderBodies(
  ctx: gpu.Context,
  world: physics.World,
  store: field.FieldStore,
): void {
  for (const key of store.chunks.keys()) {
    const col = field.chunkColliders(store, key);
    if (col === null) continue;
    physics.createBody(ctx, world, {
      type: "static",
      shape: { voxels: { coords: col.coords, size: col.size } },
      position: col.position,
    });
  }
}

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
    createChunkColliderBodies(ctx, world, digLowRoom());
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: [0, REST_Y, 0],
    });
    physics.step(ctx, world, DT); // colliders aren't queryable until the world has stepped
    const mover = new CharacterMover(CAPSULE, body);
    run({ ctx, world, mover, body });
  } finally {
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  }
}

/** The floor height and free headroom over one (x, z) column, read off the built
 *  colliders rather than off the fixture arithmetic. `capsule` is excluded — the mover's
 *  own body straddles the probe origin and would answer both casts itself.
 *
 *  @throws if either cast misses — an unenclosed room is a broken fixture, not a result. */
function measureColumn(
  ctx: gpu.Context,
  world: physics.World,
  column: [number, number],
  capsule: physics.Body,
): { floorY: number; clearance: number } {
  const [x, z] = column;
  const probe = {
    origin: [x, LOW_ROOM_CLEARANCE / 2, z] as [number, number, number],
    maxDistance: 10,
    excludeBody: capsule,
  };
  const floor = physics.castRay(ctx, world, { ...probe, dir: [0, -1, 0] });
  const ceiling = physics.castRay(ctx, world, { ...probe, dir: [0, 1, 0] });
  if (floor === null || ceiling === null)
    throw new Error(`low room: column (${x}, ${z}) is not enclosed`);
  return {
    floorY: floor.point[1],
    clearance: ceiling.point[1] - floor.point[1],
  };
}

/** Columns spanning the walked lane and the room's quadrants — a floor that sagged or a
 *  ceiling that lifted anywhere the capsule goes shows up here. */
const PROBE_COLUMNS: [number, number][] = [
  [0, 0],
  [-3, 0],
  [3, 0],
  [0, -3],
  [0, 3],
  [2, 2],
];

test.skipIf(!bunWebGpuAvailable())(
  "fixture validity: the dug room is flat-floored with 2.0 m of headroom — enough for the capsule, not for the lifted pose",
  async () => {
    await withLowRoom(({ ctx, world, body }) => {
      const columns = PROBE_COLUMNS.map((c) =>
        measureColumn(ctx, world, c, body),
      );
      const clearances = columns.map((c) => c.clearance);
      for (const c of columns) expect(c.floorY).toBeCloseTo(0, 6); // flat floor
      for (const c of clearances) expect(c).toBeCloseTo(LOW_ROOM_CLEARANCE, 6);
      // THE property this whole file rests on, asserted on the MEASURED gap: the capsule
      // fits, and the pose the buggy sweep lifted to does not. Widen the room past 2.2 m
      // and the tests below still pass while guarding nothing — so this fails first.
      expect(Math.min(...clearances)).toBeGreaterThan(CAPSULE_HEIGHT);
      expect(Math.max(...clearances)).toBeLessThan(
        CAPSULE_HEIGHT + STEP_HEIGHT,
      );
    });
  },
);

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
        // Settle window: the spawn drops onto rest over the first few frames
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
