import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { snapshot } from "../stats/public.ts";
import { registerBuiltins } from "./builtins.ts";
import { loadScene } from "./loader.ts";
import { getResourceKind, resetRegistryForTests } from "./registry.ts";
import type { SceneDocument } from "./types.ts";

await ensureBunWebGpu();
resetRegistryForTests();
registerBuiltins();

test.skipIf(!bunWebGpuAvailable())(
  "standard material with texture + sampler builds + frees clean",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    // biome-ignore lint/style/noNonNullAssertion: test-only; undefined surfaces clearly
    const shaderKind = getResourceKind("shaders", "texturedLit")!;
    // biome-ignore lint/style/noNonNullAssertion: test-only; undefined surfaces clearly
    const texKind = getResourceKind("textures", "checkerboard")!;
    // biome-ignore lint/style/noNonNullAssertion: test-only; undefined surfaces clearly
    const matKind = getResourceKind("materials", "standard")!;

    const shaderHandle = await shaderKind.build(ctx, { params: {} });
    const texHandle = await texKind.build(ctx, {
      params: { size: 64, cells: 8 },
    });

    const before = snapshot(ctx).resources.materials;

    const instance = await matKind.build(ctx, {
      params: {
        shader: shaderHandle,
        texture: {
          texture: texHandle,
          sampler: {
            maxAnisotropy: 8,
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "linear",
          },
        },
      },
    });

    expect(instance).toBeDefined();
    expect(snapshot(ctx).resources.materials).toBe(before + 1);

    matKind.destroy?.(ctx, instance);
    expect(snapshot(ctx).resources.materials).toBe(before);

    texKind.destroy?.(ctx, texHandle);
    // No shader destroy: built-in shaders are ctx-cached singletons.
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "standard material rejects texture + color together (XOR enforced)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    // biome-ignore lint/style/noNonNullAssertion: test-only; undefined surfaces clearly
    const shaderKind = getResourceKind("shaders", "texturedLit")!;
    // biome-ignore lint/style/noNonNullAssertion: test-only; undefined surfaces clearly
    const texKind = getResourceKind("textures", "checkerboard")!;
    // biome-ignore lint/style/noNonNullAssertion: test-only; undefined surfaces clearly
    const matKind = getResourceKind("materials", "standard")!;

    const shaderHandle = await shaderKind.build(ctx, { params: {} });
    const texHandle = await texKind.build(ctx, {
      params: { size: 64, cells: 8 },
    });

    await expect(
      matKind.build(ctx, {
        params: {
          shader: shaderHandle,
          texture: { texture: texHandle },
          params: { color: [1, 0, 0, 1] },
        },
      }),
    ).rejects.toBeInstanceOf(gpu.FurnaceError);

    texKind.destroy?.(ctx, texHandle);
    gpu.dispose(ctx);
  },
);

// Regression: the nested `texture.texture` resource ref must be resolved to a
// live Texture handle by the REAL loader path (resolveParams), not only when
// `build` is fed a pre-resolved handle directly. Before the recursive-resolve
// fix, loadScene left `texture.texture` as the id string "tex" and
// material.create threw `texture handle is invalid or destroyed`.
const TEXTURED_SCENE: SceneDocument = {
  version: 1,
  settings: { clearColor: [0, 0, 0, 1] },
  resources: {
    geometries: { g_cube: { kind: "cube" } },
    textures: { tex: { kind: "checkerboard", size: 64, cells: 8 } },
    shaders: { s: { kind: "texturedLit" } },
    materials: { m: { shader: "s", texture: { texture: "tex" } } },
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
        meshRenderer: { geometry: "g_cube", material: "m" },
      },
    },
  ],
};

test.skipIf(!bunWebGpuAvailable())(
  "loadScene resolves a NESTED material texture ref end-to-end (leak-clean)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    const before = snapshot(ctx).resources;

    const loaded = await loadScene(ctx, TEXTURED_SCENE);
    expect(loaded.meshes.length).toBe(1);
    expect(snapshot(ctx).resources.materials).toBe(before.materials + 1);
    expect(snapshot(ctx).resources.textures).toBe(before.textures + 1);

    loaded.destroy();
    expect(snapshot(ctx).resources.materials).toBe(before.materials);
    expect(snapshot(ctx).resources.textures).toBe(before.textures);
    expect(snapshot(ctx).resources.meshes).toBe(before.meshes);

    gpu.dispose(ctx);
  },
);
