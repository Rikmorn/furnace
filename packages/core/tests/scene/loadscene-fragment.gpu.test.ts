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
  "loadScene({ fragment: true }) loads a doc with no camera entity",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(regionBlob())) as unknown as typeof fetch;
    try {
      const scene = await loadScene(ctx, regionFloorDoc({ camera: false }), {
        world,
        fragment: true,
      });
      expect(scene.meshes.length).toBe(1);
      scene.destroy();
    } finally {
      globalThis.fetch = orig;
    }
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "without fragment, a cameraless doc still throws (default unchanged)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(regionBlob())) as unknown as typeof fetch;
    try {
      await expect(
        loadScene(ctx, regionFloorDoc({ camera: false }), { world }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = orig;
    }
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
