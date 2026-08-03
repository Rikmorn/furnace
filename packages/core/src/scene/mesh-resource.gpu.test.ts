import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import {
  regionBlob,
  regionFloorDoc,
} from "../../tests/scene/_helpers/region-doc.ts";
import * as gpu from "../gpu/index.ts";
import { registerBuiltins } from "./builtins.ts";
import { loadScene } from "./loader.ts";
import { resetRegistryForTests } from "./registry.ts";

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
