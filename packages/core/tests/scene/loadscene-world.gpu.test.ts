import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as physics from "../../src/physics/index.ts";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import { loadScene } from "../../src/scene/loader.ts";
import { resetRegistryForTests } from "../../src/scene/registry.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { regionBlob, regionFloorDoc } from "./_helpers/region-doc.ts";

await ensureBunWebGpu();
resetRegistryForTests();
registerBuiltins();

test.skipIf(!bunWebGpuAvailable())(
  "loadScene({ world }) builds bodies into the caller's world and does not destroy it",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });

    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(regionBlob())) as unknown as typeof fetch;
    try {
      const scene = await loadScene(ctx, regionFloorDoc(), { world });
      expect(scene.world).toBe(world); // same world object — injected, not a new one
      scene.destroy();
      // World STILL USABLE after the region's teardown (injected world NOT destroyed).
      physics.step(ctx, world, 1 / 60);
    } finally {
      globalThis.fetch = orig;
    }

    // Caller owns + frees it — must not double-free or warn.
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
