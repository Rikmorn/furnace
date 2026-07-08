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

// A camera-less region-style doc (mirrors the baker's render-only shape): a lit box, no
// camera. Loads in fragment mode; the host frames the orbit on content bounds, so the
// grid + headlamp + camera-pose API all have a live orbit camera to exercise.
const SCENE = {
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
  "renders clean with view flags on and off (grid/headlamp/fog)",
  async () => {
    const restore = installMockResizeObserver();
    try {
      // No-opts host: internal defaults (grid/axes/headlamp ON, fog OFF) must render — the
      // GPU-test contract, since these callers never call setViewFlags.
      const host = createViewportHost();
      const canvas = await makeOffscreenCanvas(64, 64);
      // Boundary cast: bun-webgpu mock canvas stands in for HTMLCanvasElement.
      await host.init(canvas as unknown as HTMLCanvasElement, {
        surfaceFormat: "linear",
      });
      await host.loadScene(structuredClone(SCENE) as never);
      // Default flags (grid + headlamp on) rendered on load without throwing.
      expect(() => host.render()).not.toThrow();

      // Everything on, including fog (the LDR-safe lit-shader fog path).
      expect(() =>
        host.setViewFlags({
          grid: true,
          axes: true,
          headlamp: true,
          fog: true,
        }),
      ).not.toThrow();

      // Everything off — the scene alone still renders clean.
      expect(() =>
        host.setViewFlags({
          grid: false,
          axes: false,
          headlamp: false,
          fog: false,
        }),
      ).not.toThrow();

      host.destroy();
    } finally {
      restore();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "camera-pose API: getCameraPose reflects a scene, setCameraPose round-trips, subscribers fire",
  async () => {
    const restore = installMockResizeObserver();
    try {
      const host = createViewportHost();
      const canvas = await makeOffscreenCanvas(64, 64);
      // Before a scene loads, there is no orbit camera yet.
      expect(host.getCameraPose()).toBeNull();

      await host.init(canvas as unknown as HTMLCanvasElement, {
        surfaceFormat: "linear",
      });
      await host.loadScene(structuredClone(SCENE) as never);

      // A framed orbit pose now exists.
      expect(host.getCameraPose()).not.toBeNull();

      // A subscriber is added and returns an unsubscribe; it does NOT fire on the
      // programmatic setCameraPose (that is a restore, not a user gesture).
      let calls = 0;
      const unsub = host.subscribeCameraPose(() => {
        calls++;
      });
      const pose = {
        target: [1, 2, 3],
        distance: 12,
        yaw: 0.5,
        pitch: 0.3,
      } as const;
      host.setCameraPose({ ...pose, target: [...pose.target] });
      expect(host.getCameraPose()).toEqual({
        ...pose,
        target: [...pose.target],
      });
      expect(calls).toBe(0);

      // Unsubscribing is idempotent and never throws.
      expect(() => unsub()).not.toThrow();

      host.destroy();
    } finally {
      restore();
    }
  },
);
