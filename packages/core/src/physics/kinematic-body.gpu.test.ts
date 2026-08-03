import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { vec3 } from "../transform/index.ts";
import * as physics from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "a kinematicPosition body ignores gravity (stays put when not driven)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: { halfHeight: 0.6, radius: 0.3 } },
      position: [0, 5, 0],
    });

    for (let i = 0; i < 60; i++) physics.step(ctx, world, 1 / 60);

    const t = vec3.create();
    physics.getBodyTranslation(ctx, body, t);
    expect(t[1]).toBeCloseTo(5, 5); // kinematic: unaffected by gravity

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setBodyNextKinematicTranslation moves a kinematic body on the next step",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: { halfHeight: 0.6, radius: 0.3 } },
      position: [0, 1, 0],
    });

    physics.setBodyNextKinematicTranslation(ctx, body, [2, 1, -1]);
    physics.step(ctx, world, 1 / 60);

    const t = vec3.create();
    physics.getBodyTranslation(ctx, body, t);
    expect(t[0]).toBeCloseTo(2, 4);
    expect(t[1]).toBeCloseTo(1, 4);
    expect(t[2]).toBeCloseTo(-1, 4);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
