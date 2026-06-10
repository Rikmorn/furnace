import { afterEach, expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import * as scene from "../../src/scene/index.ts";
import { resetRegistryForTests } from "../../src/scene/registry.ts";
import type { SceneDocument } from "../../src/scene/types.ts";
import * as stats from "../../src/stats/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

afterEach(() => {
  resetRegistryForTests();
  registerBuiltins();
});

// The "consumer extension": a custom component registered through the SAME
// public API built-ins use. Contributes a second mesh from existing resources.
function registerGhostExtension() {
  scene.defineComponent("ghost", {
    params: {
      geometry: scene.t.resource("geometries"),
      material: scene.t.resource("materials"),
      offset: scene.t.vec3(),
    },
    build(ctx, bx) {
      const m = mesh.create(ctx, {
        geometry: bx.params.geometry,
        material: bx.params.material,
      });
      mesh.setPosition(
        ctx,
        m,
        // offset is a validated [x,y,z] tuple
        new Float32Array([
          bx.params.offset[0],
          bx.params.offset[1],
          bx.params.offset[2],
        ]),
      );
      bx.out.addMesh(m);
      return m;
    },
    destroy: (ctx, m) => mesh.destroy(ctx, m),
  });
}

const GHOST_SCENE: SceneDocument = {
  version: 1,
  resources: {
    geometries: { g: { kind: "cube" } },
    shaders: { s: { kind: "unlit" } },
    materials: { m: { shader: "s", params: { color: [0, 1, 0, 1] } } },
  },
  entities: [
    {
      id: "cam",
      components: {
        camera: { kind: "perspective", aspect: 1 },
        transform: { position: [0, 0, 3] },
      },
    },
    {
      id: "thing",
      components: {
        transform: {},
        meshRenderer: { geometry: "g", material: "m" },
        ghost: { geometry: "g", material: "m", offset: [1, 0, 0] },
      },
    },
  ],
};

test.skipIf(!bunWebGpuAvailable())(
  "a custom component loads through the same registry path as built-ins",
  async () => {
    registerGhostExtension();
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const loaded = await scene.loadScene(ctx, GHOST_SCENE);
    expect(loaded.meshes).toHaveLength(2); // meshRenderer's + ghost's
    loaded.destroy();
    const live = stats.snapshot(ctx).resources;
    expect(live.meshes).toBe(0); // custom instances destroyed through the registry path
    expect(live.bindings).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "the same document WITHOUT the extension import fails loud naming the type",
  async () => {
    // No registerGhostExtension() — simulates the missing import.
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    await expect(scene.loadScene(ctx, GHOST_SCENE)).rejects.toThrow(
      /entity "thing".*"ghost".*not registered.*imported/i,
    );
    gpu.dispose(ctx);
  },
);
