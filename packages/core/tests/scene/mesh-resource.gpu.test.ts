import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
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
  "a 'mesh' geometry resource loads from a .fmesh sidecar via fetch",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(regionBlob())) as unknown as typeof fetch;
    try {
      // geometry-only: no rigidBody yet (that's Task 11)
      const scene = await loadScene(ctx, regionFloorDoc({ trimesh: false }));
      expect(scene.meshes.length).toBe(1);
      scene.destroy();
    } finally {
      globalThis.fetch = orig;
    }
    gpu.dispose(ctx);
  },
);
