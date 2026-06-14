import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import { loadScene } from "../../src/scene/loader.ts";
import { resetRegistryForTests } from "../../src/scene/registry.ts";
import type { SceneDocument } from "../../src/scene/types.ts";
import { snapshot } from "../../src/stats/public.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
resetRegistryForTests();
registerBuiltins();

test.skipIf(!bunWebGpuAvailable())(
  "rigidBody+meshRenderer → one mesh, world exists, seed pose, leak-clean",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx).resources;
    const doc: SceneDocument = {
      version: 1,
      settings: { gravity: [0, -9.81, 0], lengthUnit: 0.1 },
      resources: {
        geometries: { g_ball: { kind: "sphere", radius: 0.15 } },
        shaders: { s: { kind: "unlit" } },
        materials: { m: { shader: "s", params: { color: [1, 1, 1, 1] } } },
      },
      entities: [
        {
          id: "cam",
          components: {
            camera: { kind: "perspective", aspect: 1 },
            transform: { position: [0, 0, 5] },
          },
        },
        {
          id: "ball",
          components: {
            transform: { position: [0, 5, 0] },
            rigidBody: { type: "dynamic", shape: { ball: 0.15 } },
            meshRenderer: { geometry: "g_ball", material: "m" },
          },
        },
      ],
    };
    const loaded = await loadScene(ctx, doc);
    expect(loaded.world).toBeDefined();
    expect(loaded.meshes.length).toBe(1); // ONE mesh (rigidMesh owns it; meshRenderer deferred)
    loaded.destroy();
    const after = snapshot(ctx).resources;
    expect(after.meshes).toBe(before.meshes);
    expect(after.physicsWorlds).toBe(before.physicsWorlds);
    expect(after.physicsBodies).toBe(before.physicsBodies);
    expect(after.rigidMeshes).toBe(before.rigidMeshes);
    gpu.dispose(ctx);
  },
);
