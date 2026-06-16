import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as physics from "../../src/physics/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "a character controller is created and destroyed idempotently, leaving the world clean",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });

    const controller = physics.createCharacterController(ctx, world, {
      offset: 0.01,
      up: [0, 1, 0],
      autostep: { maxHeight: 0.3, minWidth: 0.1 },
      snapToGround: 0.5,
    });

    // Idempotent destroy: two calls, no throw.
    physics.destroyCharacterController(ctx, controller);
    physics.destroyCharacterController(ctx, controller);

    // A fresh controller left undestroyed must be cleaned up by destroyWorld:
    // it marks the controller destroyed and rapier.free() reclaims the backend
    // (controllers aren't resource-pool slots, so gpu.dispose's slot leak-check
    // doesn't count them) — a clean shutdown that does not throw confirms the
    // world teardown freed the live controller without a double-free.
    physics.createCharacterController(ctx, world);
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createCharacterController throws on a destroyed world",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    physics.destroyWorld(ctx, world);
    expect(() => physics.createCharacterController(ctx, world)).toThrow(
      /world handle is invalid or destroyed/,
    );
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "computeMovement slides along a wall, is blocked head-on, and reports grounded",
  async () => {
    const { vec3 } = await import("../../src/transform/index.ts");
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    // Floor (top at y=0) and a wall at x≈1.0 (near face at x=0.8).
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.5, 5] },
      position: [0, -0.5, 0],
    });
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [0.2, 2, 5] },
      position: [1, 1, 0],
    });
    // Player capsule resting on the floor at x=0 (feet at 0, centre at 0.9).
    const player = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: { halfHeight: 0.6, radius: 0.3 } },
      position: [0, 0.9, 0],
    });
    const controller = physics.createCharacterController(ctx, world, {
      offset: 0.01,
      up: [0, 1, 0],
      snapToGround: 0.5,
    });

    const mv = vec3.create();

    // computeColliderMovement queries Rapier's collider/broadphase structures,
    // which are populated by world.step — without a first step the query sees
    // no obstacles and returns the full desired translation. Step once so the
    // wall is in the query pipeline.
    physics.step(ctx, world, 1 / 60);

    // Push toward the wall (+x). Blocked: corrected x is far less than 1.0.
    const groundedIntoWall = physics.computeMovement(
      ctx,
      controller,
      player,
      [1, -0.05, 0],
      mv,
    );
    expect(mv[0]).toBeLessThan(0.6); // wall stopped most of the +x travel
    expect(groundedIntoWall).toBe(true); // standing on the floor

    // Push parallel to the wall (+z). Free: corrected z ≈ requested.
    physics.computeMovement(ctx, controller, player, [0, -0.05, 1], mv);
    expect(mv[2]).toBeGreaterThan(0.9);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "computeMovement on a destroyed controller returns grounded=false and zero movement",
  async () => {
    const { vec3 } = await import("../../src/transform/index.ts");
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const player = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: { halfHeight: 0.6, radius: 0.3 } },
      position: [0, 0.9, 0],
    });
    const controller = physics.createCharacterController(ctx, world);
    physics.destroyCharacterController(ctx, controller);

    const mv = vec3.fromValues(9, 9, 9);
    const grounded = physics.computeMovement(
      ctx,
      controller,
      player,
      [1, 0, 0],
      mv,
    );
    expect(grounded).toBe(false);
    expect(mv[0]).toBe(0);
    expect(mv[1]).toBe(0);
    expect(mv[2]).toBe(0);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a controller with applyImpulsesToDynamicBodies pushes a dynamic body it walks into",
  async () => {
    const { vec3 } = await import("../../src/transform/index.ts");
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });

    // Static floor with its top at y=0.
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.5, 5] },
      position: [0, -0.5, 0],
    });
    // A small dynamic cube resting on the floor, in the player's +x path.
    const cubeStartX = 1.0;
    const cube = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { cuboid: [0.25, 0.25, 0.25] },
      position: [cubeStartX, 0.25, 0],
      friction: 0.8,
    });
    // Kinematic player capsule resting on the floor at x=0 (centre at 0.9).
    const player = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: { halfHeight: 0.6, radius: 0.3 } },
      position: [0, 0.9, 0],
    });
    const controller = physics.createCharacterController(ctx, world, {
      offset: 0.01,
      up: [0, 1, 0],
      snapToGround: 0.5,
      applyImpulsesToDynamicBodies: true,
    });

    const moveOut = vec3.create();
    const playerPos = vec3.fromValues(0, 0.9, 0);

    // Drive the player into the cube along +x, one frame at a time. The
    // broadphase Rapier queries is populated by step, so step every frame.
    for (let frame = 0; frame < 60; frame++) {
      physics.computeMovement(
        ctx,
        controller,
        player,
        [0.05, -0.01, 0],
        moveOut,
      );
      vec3.add(playerPos, playerPos, moveOut);
      physics.setBodyNextKinematicTranslation(ctx, player, [
        playerPos[0] as number,
        playerPos[1] as number,
        playerPos[2] as number,
      ]);
      physics.step(ctx, world, 1 / 60);
    }

    const cubePos = vec3.create();
    physics.getBodyTranslation(ctx, cube, cubePos);
    // A real shove, not numerical noise: the cube must have travelled well
    // beyond its start of 1.0 in +x.
    expect(cubePos[0]).toBeGreaterThan(1.2);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
