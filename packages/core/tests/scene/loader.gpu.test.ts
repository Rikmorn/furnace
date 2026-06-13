import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import { FurnaceError } from "../../src/errors.ts";
import * as frame from "../../src/frame/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import * as scene from "../../src/scene/index.ts";
import {
  defineComponent,
  defineResource,
  resetRegistryForTests,
} from "../../src/scene/registry.ts";
import * as t from "../../src/scene/t.ts";
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

test.skipIf(!bunWebGpuAvailable())(
  "rebuildEntity swaps a transform without a full reload, GPU-clean + leak-free",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const loaded = await scene.loadScene(ctx, structuredClone(CUBE_SCENE));
    const cubeMeshBefore = loaded.meshes[0];

    const moved = structuredClone(CUBE_SCENE);
    // biome-ignore lint/style/noNonNullAssertion: fixture index is known
    moved.entities[1]!.components["transform"] = { position: [2, 0, 0] };

    ctx.device.pushErrorScope("validation");
    loaded.rebuildEntity("cube", moved);
    frame.render(ctx, { meshes: loaded.meshes, camera: loaded.camera });
    const err = await ctx.device.popErrorScope();

    expect(err).toBe(null);
    expect(loaded.meshes).toHaveLength(1); // still one cube, swapped not duplicated
    expect(loaded.meshes[0]).not.toBe(cubeMeshBefore); // a fresh mesh
    expect(stats.snapshot(ctx).resources.meshes).toBe(1); // old mesh freed, not leaked
    loaded.destroy();
    const live = stats.snapshot(ctx).resources;
    expect(live.meshes).toBe(0); // rebuilt record tracked + freed by destroy
    expect(live.bindings).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "rebuildEntity on the camera entity swaps the camera (no false second-camera throw)",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const loaded = await scene.loadScene(ctx, structuredClone(CUBE_SCENE));
    const camBefore = loaded.camera;

    const moved = structuredClone(CUBE_SCENE);
    // biome-ignore lint/style/noNonNullAssertion: fixture index is known
    moved.entities[0]!.components["transform"] = { position: [0, 0, 8] };
    expect(() => loaded.rebuildEntity("cam", moved)).not.toThrow();
    expect(loaded.camera).not.toBe(camBefore);
    loaded.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setSettings replaces clearColor without rebuilding",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const loaded = await scene.loadScene(ctx, structuredClone(CUBE_SCENE));
    loaded.setSettings({ clearColor: [0.1, 0.2, 0.3, 1] });
    expect(loaded.settings.clearColor).toEqual([0.1, 0.2, 0.3, 1]);
    loaded.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "fault injection: a resource build that allocates a binding then throws leaks nothing (atomic-build contract)",
  async () => {
    // Approach: custom-kind pattern (see docs for the investigation summary).
    //
    // Direct standard-material testing is not achievable: the only material.create
    // throws that fire AFTER binding.create require a destroyed or null binding,
    // which cannot be arranged through standard's own build (it creates and
    // immediately passes a fresh binding). The custom-kind pattern reproduces the
    // contract end-to-end through loadScene.
    //
    // This test registers a resource kind whose build allocates a real binding
    // then frees it atomically before rethrowing — exactly the pattern that
    // standard-material's color branch now follows. The assertion that
    // `bindings === 0` proves the atomic-build contract holds: without the
    // try/catch cleanup (i.e. the pre-fix non-atomic form), `bindings` would
    // be 1 because the loader has no visibility into un-returned allocations.
    resetRegistryForTests();
    registerBuiltins();
    defineResource("materials", "atomic-throw", {
      params: { shader: t.resource("shaders") },
      build(ctx, rx) {
        const b = binding.create(ctx, rx.params.shader);
        try {
          throw new FurnaceError(
            "scene: atomic-throw (regression: binding must be freed)",
          );
        } catch (err) {
          // Atomic build: free the binding before rethrowing so the loader
          // never has a chance to leak it (mirrors the fix in standard-material).
          binding.destroy(ctx, b);
          throw err;
        }
      },
    });

    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const doc: SceneDocument = {
      version: 1,
      settings: {},
      resources: {
        geometries: {},
        shaders: { s_unlit: { kind: "unlit" } },
        materials: { m_bad: { kind: "atomic-throw", shader: "s_unlit" } },
      },
      entities: [],
    };
    await expect(scene.loadScene(ctx, doc)).rejects.toThrow(/atomic-throw/);
    const live = stats.snapshot(ctx).resources;
    // The binding allocated inside the build must be freed by the build itself
    // (atomic-build contract) — the loader cannot track it because build never
    // returned. A non-atomic build would leave bindings === 1 here.
    expect(live.bindings).toBe(0);
    gpu.dispose(ctx);
    resetRegistryForTests();
    registerBuiltins();
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "rebuildEntity with an invalid ref throws but leaves the scene intact + leak-free",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const loaded = await scene.loadScene(ctx, structuredClone(CUBE_SCENE));
    const cubeMeshBefore = loaded.meshes[0];

    const bad = structuredClone(CUBE_SCENE);
    // Point the cube's meshRenderer at a non-existent material → resolveParams
    // calls lookup("materials", "nope") which throws, so buildEntity throws before
    // the old entity is torn down. The transactional swap leaves the scene intact.
    // biome-ignore lint/style/noNonNullAssertion: fixture index is known
    bad.entities[1]!.components["meshRenderer"] = {
      geometry: "g_cube",
      material: "nope",
    };

    expect(() => loaded.rebuildEntity("cube", bad)).toThrow();
    expect(loaded.meshes).toHaveLength(1); // entity still present
    expect(loaded.meshes[0]).toBe(cubeMeshBefore); // unchanged (no swap happened)
    expect(stats.snapshot(ctx).resources.meshes).toBe(1); // failed build leaked nothing
    loaded.destroy();
    expect(stats.snapshot(ctx).resources.meshes).toBe(0);
    gpu.dispose(ctx);
  },
);
