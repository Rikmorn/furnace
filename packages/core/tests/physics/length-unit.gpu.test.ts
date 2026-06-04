import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as physics from "../../src/physics/index.ts";
import type { WorldSlot } from "../../src/physics/types.ts";
import { _lookupPhysicsWorld } from "../../src/resources/internal.ts";
import { vec3 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

// furnace's meter-scale default. Mirrors DEFAULT_LENGTH_UNIT in world.ts; the
// wrapper always forwards an explicit value, so this is what the backend reads
// back when the descriptor omits lengthUnit.
const FURNACE_DEFAULT_LENGTH_UNIT = 1;
const SUB_METER_LENGTH_UNIT = 0.1;

test.skipIf(!bunWebGpuAvailable())(
  "createWorld forwards an explicit lengthUnit to the backend and a sub-meter sim stays stable",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    // Sub-meter scene (bowling pins/ball are ~0.3m); lengthUnit scales the
    // solver's length tolerances down to match.
    const world = await physics.createWorld(ctx, {
      gravity: [0, -9.81, 0],
      lengthUnit: SUB_METER_LENGTH_UNIT,
    });

    // The descriptor value reaches the backend verbatim (pass-through).
    const slot = _lookupPhysicsWorld<WorldSlot>(ctx, world);
    expect(slot?.rapier.lengthUnit).toBeCloseTo(SUB_METER_LENGTH_UNIT, 5);

    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [1, 0.05, 1] },
      position: [0, 0, 0],
    });
    // A sub-meter sphere settling on the floor: rest centre = 0.05 + 0.03 = 0.08.
    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.03 },
      position: [0, 0.5, 0],
      linearDamping: 0.2,
      angularDamping: 0.4,
    });
    for (let i = 0; i < 180; i++) physics.step(ctx, world, 1 / 60);

    // It settled on the ground (didn't sink through or fly off to NaN).
    const t = vec3.create();
    physics.getBodyTranslation(ctx, ball, t);
    expect(t[1]).toBeGreaterThan(0.05); // above the floor surface, not sunk through
    expect(t[1]).toBeLessThan(0.2); // came to rest, not still airborne
    expect(Number.isFinite(t[0] as number)).toBe(true);
    expect(Number.isFinite(t[2] as number)).toBe(true);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createWorld applies the furnace default lengthUnit when the descriptor omits it",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });

    // Omitted -> furnace's own default is set explicitly on the backend; we
    // never rely on Rapier's built-in default.
    const slot = _lookupPhysicsWorld<WorldSlot>(ctx, world);
    expect(slot?.rapier.lengthUnit).toBeCloseTo(FURNACE_DEFAULT_LENGTH_UNIT, 5);

    physics.step(ctx, world, 1 / 60); // world steps fine with the default
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
