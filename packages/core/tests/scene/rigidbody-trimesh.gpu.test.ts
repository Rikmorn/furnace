import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as physics from "../../src/physics/index.ts";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import { loadScene } from "../../src/scene/loader.ts";
import { resetRegistryForTests } from "../../src/scene/registry.ts";
import { vec3 } from "../../src/transform/index.ts";
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
  "a rigidBody shape.trimesh builds a WORKING static trimesh body from its mesh geometry",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(regionBlob())) as unknown as typeof fetch;
    try {
      const scene = await loadScene(ctx, regionFloorDoc()); // trimesh floor (y=0 quad) + camera
      expect(scene.world).toBeDefined(); // lazy world created for the rigidBody
      expect(scene.meshes.length).toBe(1);
      // Interaction: a dynamic ball dropped above the loaded trimesh floor must REST on it.
      const world = scene.world;
      if (!world) throw new Error("expected a physics world");
      const ball = physics.createBody(ctx, world, {
        type: "dynamic",
        shape: { ball: 0.5 },
        position: [0, 3, 0],
      });
      for (let i = 0; i < 180; i++) physics.step(ctx, world, 1 / 60);
      const pos = physics.getBodyTranslation(ctx, ball, vec3.create());
      expect(pos[1]).toBeGreaterThan(0.3); // rested ~radius above the y=0 floor (did NOT fall through)
      expect(pos[1]).toBeLessThan(1.0);
      scene.destroy(); // frees the world (and the ball + trimesh body)
    } finally {
      globalThis.fetch = orig;
    }
    gpu.dispose(ctx);
  },
);
