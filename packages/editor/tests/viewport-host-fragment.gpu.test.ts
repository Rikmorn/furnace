import { expect, test } from "bun:test";
import { CURRENT_SCENE_VERSION } from "@furnace/core/scene";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { createViewportHost } from "../src/viewport-host/index.ts";

await ensureBunWebGpu();

// A camera-LESS region-style doc, mirroring the render-only shape the dungeon
// baker emits (bake.ts regionDoc): a lit-shaded box with NO camera component on
// any entity. This is the 3.0-gate case — before the fix the core loader throws
// "no entity carries a camera component"; after, it loads in fragment mode.
const FRAGMENT_SCENE = {
  version: CURRENT_SCENE_VERSION,
  settings: {},
  resources: {
    geometries: { g_cube: { kind: "cube" } },
    shaders: { s_lit: { kind: "lit" } },
    materials: {
      m0: { shader: "s_lit", params: { color: [0.6, 0.6, 0.6, 1] } },
    },
  },
  entities: [
    {
      id: "box",
      components: {
        transform: { position: [0, 0, 0], scale: [2, 2, 2] },
        meshRenderer: { geometry: "g_cube", material: "m0" },
      },
    },
  ],
} as const;

test.skipIf(!bunWebGpuAvailable())(
  "opens a camera-less fragment doc: loads (fragment mode) + renders clean, no throw",
  async () => {
    const restore = installMockResizeObserver();
    try {
      const host = createViewportHost();
      const canvas = await makeOffscreenCanvas(64, 64);
      // Boundary cast: bun-webgpu mock canvas stands in for HTMLCanvasElement.
      await host.init(canvas as unknown as HTMLCanvasElement, {
        surfaceFormat: "linear",
      });
      // The teeth: before the fix, this rejects inside the core loader with
      // "no entity carries a camera component". After, it loads + renders clean.
      await host.loadScene(structuredClone(FRAGMENT_SCENE) as never);
      // A subsequent on-demand render must also run clean (bounds-framed orbit cam).
      expect(() => host.render()).not.toThrow();
      host.destroy();
    } finally {
      restore();
    }
  },
);
