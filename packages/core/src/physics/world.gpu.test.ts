import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import * as stats from "../stats/index.ts";
import * as physics from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "createWorld → step → destroyWorld lifecycle is clean and idempotent",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    expect(stats.snapshot(ctx).resources.physicsWorlds).toBe(1);

    physics.step(ctx, world, 1 / 60); // empty world steps without throwing

    physics.destroyWorld(ctx, world);
    expect(stats.snapshot(ctx).resources.physicsWorlds).toBe(0);

    physics.destroyWorld(ctx, world); // idempotent — no throw
    physics.step(ctx, world, 1 / 60); // stale handle — silent no-op

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createWorld throws on a malformed gravity descriptor",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    await expect(
      // @ts-expect-error deliberately invalid gravity
      physics.createWorld(ctx, { gravity: [0, Number.NaN] }),
    ).rejects.toThrow(/gravity must be a finite/);
    // Valid-length vector with a non-finite component — exercises the
    // finite-check branch independently of the length-check branch.
    await expect(
      physics.createWorld(ctx, { gravity: [0, Number.NaN, 0] }),
    ).rejects.toThrow(/gravity must be a finite/);
    gpu.dispose(ctx);
  },
);
