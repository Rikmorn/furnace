import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import {
  _allocPhysicsBody,
  _allocPhysicsWorld,
  _destroyPhysicsWorld,
  _lookupPhysicsWorld,
} from "../../src/resources/internal.ts";
import * as stats from "../../src/stats/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "physics resource kinds: alloc/lookup/destroy + stats counts",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    let tornDown = false;
    const worldSlot = {
      _teardown: () => {
        tornDown = true;
      },
    };
    const h = _allocPhysicsWorld(ctx, worldSlot);

    expect(_lookupPhysicsWorld<typeof worldSlot>(ctx, h)).toBe(worldSlot);
    expect(stats.snapshot(ctx).resources.physicsWorlds).toBe(1);

    // A body kind exists and counts independently.
    _allocPhysicsBody(ctx, { _teardown: () => undefined });
    expect(stats.snapshot(ctx).resources.physicsBodies).toBe(1);

    const destroyed = _destroyPhysicsWorld(ctx, h, (s: typeof worldSlot) =>
      s._teardown(),
    );
    expect(destroyed).toBe(true);
    expect(tornDown).toBe(true);
    expect(_lookupPhysicsWorld(ctx, h)).toBe(null);
    expect(stats.snapshot(ctx).resources.physicsWorlds).toBe(0);

    gpu.dispose(ctx);
  },
);
