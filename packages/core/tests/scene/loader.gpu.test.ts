import { expect, test } from "bun:test";
import { FurnaceError } from "../../src/errors.ts";
import * as frame from "../../src/frame/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import * as scene from "../../src/scene/index.ts";
import {
  defineComponent,
  resetRegistryForTests,
} from "../../src/scene/registry.ts";
import type { SceneDocument } from "../../src/scene/types.ts";
import * as stats from "../../src/stats/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const CUBE_SCENE: SceneDocument = {
  version: 1,
  settings: { clearColor: [0, 0, 0, 1] },
  resources: {
    geometries: { g_cube: { kind: "cube" } },
    shaders: { s_unlit: { kind: "unlit" } },
    materials: {
      m_red: { shader: "s_unlit", params: { color: [1, 0, 0, 1] } },
    },
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
      id: "cube",
      components: {
        transform: { position: [0, 0, 0] },
        meshRenderer: { geometry: "g_cube", material: "m_red" },
      },
    },
  ],
};

// `surfaceFormat: "linear"` works around a bun-webgpu 0.1.7 mock limitation
// where the configured viewFormats are dropped, causing srgb view-format
// upcasts to fail validation. See gpu-fixture.ts for the full explanation.

test.skipIf(!bunWebGpuAvailable())(
  "loadScene → frame.render draws the loaded mesh headlessly",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    const loaded = await scene.loadScene(ctx, CUBE_SCENE);
    expect(loaded.meshes).toHaveLength(1);
    expect(loaded.settings.clearColor).toEqual([0, 0, 0, 1]); // settings round-trips through the loader

    // Headless gate: proves the load→render path issues the draw. Pixel/visual correctness is a separate browser/visual gate (see docs/learnings/shadow-mapping-stage4-silent-bugs.md).
    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: loaded.meshes, camera: loaded.camera });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);

    // drawCalls increments once per drawIndexed; no markFrameBoundary/loop has reset it since context creation, so one render of one mesh → 1, proving the loaded mesh actually drew.
    expect(stats.snapshot(ctx).gpu.drawCalls).toBe(1);

    loaded.destroy();
    const live = stats.snapshot(ctx).resources;
    expect(live.bindings).toBe(0); // per-material color binding freed (regression guard: was leaking)
    expect(live.meshes).toBe(0);
    expect(live.materials).toBe(0);
    expect(live.geometries).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "loadScene rejects a bad version before touching the GPU",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    await expect(
      scene.loadScene(ctx, { ...CUBE_SCENE, version: 999 }),
    ).rejects.toThrow(/version/i);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a second camera fails loud naming the entity",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const doc: SceneDocument = {
      ...CUBE_SCENE,
      entities: [
        ...CUBE_SCENE.entities,
        {
          id: "cam2",
          components: { camera: { kind: "perspective", aspect: 1 } },
        },
      ],
    };
    await expect(scene.loadScene(ctx, doc)).rejects.toThrow(
      /cam2.*second camera/i,
    );
    // Partial-load cleanup freed everything the failed load built:
    const live = stats.snapshot(ctx).resources;
    expect(live.meshes).toBe(0);
    expect(live.materials).toBe(0);
    expect(live.bindings).toBe(0);
    expect(live.geometries).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a camera-less scene fails loud",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const doc: SceneDocument = {
      ...CUBE_SCENE,
      entities: [
        {
          id: "cube",
          components: {
            transform: { position: [0, 0, 0] },
            meshRenderer: { geometry: "g_cube", material: "m_red" },
          },
        },
      ],
    };
    await expect(scene.loadScene(ctx, doc)).rejects.toThrow(
      /no entity carries a camera/i,
    );
    const live = stats.snapshot(ctx).resources;
    expect(live.meshes).toBe(0); // cleanup is loadScene's job even on post-build failure
    expect(live.materials).toBe(0);
    expect(live.bindings).toBe(0);
    expect(live.geometries).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "fault injection: a throwing component build leaks nothing (partial-load cleanup)",
  async () => {
    resetRegistryForTests();
    registerBuiltins();
    defineComponent("boom", {
      build() {
        throw new FurnaceError("scene: boom (test fault injection)");
      },
    });
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const doc: SceneDocument = {
      ...CUBE_SCENE,
      entities: [
        ...CUBE_SCENE.entities,
        { id: "grenade", components: { boom: {} } },
      ],
    };
    // All resources + the first entity's mesh were built before the throw.
    await expect(scene.loadScene(ctx, doc)).rejects.toThrow(/boom/);
    const live = stats.snapshot(ctx).resources;
    expect(live.meshes).toBe(0);
    expect(live.materials).toBe(0);
    expect(live.bindings).toBe(0);
    expect(live.geometries).toBe(0);
    gpu.dispose(ctx);
    resetRegistryForTests();
    registerBuiltins();
  },
);
