import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { registerBuiltins } from "./builtins.ts";
import { loadScene } from "./loader.ts";
import { defineComponent, resetRegistryForTests } from "./registry.ts";
import type { SceneDocument } from "./types.ts";

await ensureBunWebGpu();
resetRegistryForTests();
registerBuiltins();

// Probe component: reads its sibling meshRenderer's resolved params and records
// what `geometry` looks like across the load boundary. Pre-T8 the loader only
// resolved a building component's OWN params, so the sibling sees the id STRING;
// post-T8 every component's params are resolved up front, so the sibling sees the
// resolved Geometry handle (a branded number).
let observedSiblingGeometry: unknown;

defineComponent("siblingProbe", {
  params: {},
  build(_ctx, bx) {
    const meshRendererSibling = bx.sibling("meshRenderer") as
      | { geometry: unknown }
      | undefined;
    observedSiblingGeometry = meshRendererSibling?.geometry;
    return undefined;
  },
});

const PROBE_SCENE: SceneDocument = {
  version: 1,
  settings: { clearColor: [0, 0, 0, 1] },
  resources: {
    geometries: { g_cube: { kind: "cube" } },
    shaders: { s: { kind: "unlit" } },
    materials: { m: { shader: "s", params: { color: [1, 1, 1, 1] } } },
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
        siblingProbe: {},
      },
    },
  ],
};

test.skipIf(!bunWebGpuAvailable())(
  "sibling() returns RESOLVED params: meshRenderer.geometry is a handle, not an id string",
  async () => {
    observedSiblingGeometry = undefined;

    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    const loaded = await loadScene(ctx, PROBE_SCENE);

    // Core assertion: the sibling did NOT see the id string "g_cube".
    expect(typeof observedSiblingGeometry).not.toBe("string");
    expect(observedSiblingGeometry).not.toBe("g_cube");
    // A resolved Geometry handle is a branded number (see resources/handle.ts).
    expect(typeof observedSiblingGeometry).toBe("number");

    loaded.destroy();
    gpu.dispose(ctx);
  },
);
