// Headless physics — proves `@furnace/core/physics` drives a real Rapier world
// with no GPU context anywhere in the call chain.
//
// Deliberately a plain `bun:test` file: it imports NO gpu fixture and calls NO
// `@furnace/core/gpu` API. If this file ever needs `bun-webgpu` to pass, the
// decoupling it exists to prove has regressed. Every other physics test is a
// `.gpu.test.ts` that goes through `gpu.requestContext`.

import { expect, test } from "bun:test";
import { FurnaceError } from "../errors.ts";
import {
  decodeCtxId,
  decodeGeneration,
  decodeSlotIndex,
} from "../resources/handle.ts";
import * as physics from "./index.ts";

// Floor: 10 × 0.2 × 10 cuboid centred at the origin, so its top face is y = 0.1.
const FLOOR_HALF_EXTENTS: physics.Vec3Tuple = [5, 0.1, 5];
const FLOOR_TOP_Y = 0.1;

// Capsule: halfHeight 0.5 + radius 0.3 → its lowest point sits 0.8 below centre.
const CAPSULE = { halfHeight: 0.5, radius: 0.3 } as const;
const CAPSULE_HALF_LENGTH = CAPSULE.halfHeight + CAPSULE.radius;
const CAST_START_Y = 2;

test("headless context runs createWorld → createBody → castShape/castRay → destroyWorld with no GPU", async () => {
  // No RAPIER.init() here on purpose: createWorld owns the wasm init.
  const ctx = physics.createHeadlessPhysicsContext();
  expect(Object.isFrozen(ctx)).toBe(true); // parity with gpu.requestContext
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });

  const floor = physics.createBody(ctx, world, {
    type: "static",
    shape: { cuboid: FLOOR_HALF_EXTENTS },
    position: [0, 0, 0],
  });
  physics.step(ctx, world, 1 / 60); // populate the broadphase

  const shapeHit = physics.castShape(ctx, world, {
    shape: { capsule: CAPSULE },
    position: [0, CAST_START_Y, 0],
    dir: [0, -1, 0],
    maxDistance: 5,
  });
  expect(shapeHit).not.toBeNull();
  if (shapeHit !== null) {
    // Sweep distance until the capsule's lowest point touches the floor's top face.
    expect(shapeHit.toi).toBeCloseTo(
      CAST_START_Y - CAPSULE_HALF_LENGTH - FLOOR_TOP_Y,
      2,
    );
    expect(shapeHit.normal[1]).toBeGreaterThan(0.9); // opposes downward travel
    expect(shapeHit.body).toBe(floor);
  }

  const rayHit = physics.castRay(ctx, world, {
    origin: [0, CAST_START_Y, 0],
    dir: [0, -1, 0],
    maxDistance: 5,
  });
  expect(rayHit).not.toBeNull();
  if (rayHit !== null) {
    expect(rayHit.point[1]).toBeCloseTo(FLOOR_TOP_Y, 2);
    expect(rayHit.body).toBe(floor);
  }

  const miss = physics.castRay(ctx, world, {
    origin: [0, CAST_START_Y, 0],
    dir: [0, 1, 0], // away from the floor
    maxDistance: 5,
  });
  expect(miss).toBeNull();

  physics.destroyWorld(ctx, world);
  // Post-teardown the handle is stale: runtime-quiet null, not a wrong-slot hit.
  expect(
    physics.castRay(ctx, world, {
      origin: [0, CAST_START_Y, 0],
      dir: [0, -1, 0],
      maxDistance: 5,
    }),
  ).toBeNull();
});

test("each headless context gets a fresh ctxId, so context B rejects context A's world handle", async () => {
  const ctxA = physics.createHeadlessPhysicsContext();
  const ctxB = physics.createHeadlessPhysicsContext();
  const worldA = await physics.createWorld(ctxA, { gravity: [0, -9.81, 0] });
  const worldB = await physics.createWorld(ctxB, { gravity: [0, -9.81, 0] });

  // Both are the first physics-world slot in their own pool, so slot index and
  // generation match and ctxId is the ONLY differing field. Asserted rather
  // than argued: without a fresh id per context these would be one number, and
  // ctxB's lookup would resolve worldA to its own live world.
  expect(decodeSlotIndex(worldA)).toBe(decodeSlotIndex(worldB));
  expect(decodeGeneration(worldA)).toBe(decodeGeneration(worldB));
  expect(decodeCtxId(worldA)).not.toBe(decodeCtxId(worldB));

  physics.createBody(ctxA, worldA, {
    type: "static",
    shape: { cuboid: FLOOR_HALF_EXTENTS },
    position: [0, 0, 0],
  });
  physics.step(ctxA, worldA, 1 / 60);

  const castOpts = {
    origin: [0, CAST_START_Y, 0] as physics.Vec3Tuple,
    dir: [0, -1, 0] as physics.Vec3Tuple,
    maxDistance: 5,
  };
  // Same cast that hits through ctxA...
  expect(physics.castRay(ctxA, worldA, castOpts)).not.toBeNull();
  // ...sees nothing through ctxB, whose own world has no floor in it.
  expect(physics.castRay(ctxB, worldA, castOpts)).toBeNull();

  // Setup-loud path: the wrong-context handle reads as invalid, and throws.
  expect(() =>
    physics.createBody(ctxB, worldA, {
      type: "static",
      shape: { cuboid: FLOOR_HALF_EXTENTS },
      position: [0, 0, 0],
    }),
  ).toThrow(FurnaceError);

  physics.destroyWorld(ctxA, worldA);
  physics.destroyWorld(ctxB, worldB);
});
