import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { createViewportHost } from "../src/viewport-host/index.ts";

await ensureBunWebGpu();

const SCENE = {
  version: 1,
  settings: { clearColor: [0, 0, 0, 1] },
  resources: {
    geometries: { g: { kind: "cube" } },
    shaders: { s: { kind: "unlit" } },
    materials: { m: { shader: "s", params: { color: [1, 0, 0, 1] } } },
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
        meshRenderer: { geometry: "g", material: "m" },
      },
    },
    {
      id: "sun",
      components: {
        transform: { rotation: [0, 0, 0, 1] },
        light: { type: "directional", color: [1, 1, 1], intensity: 1 },
      },
    },
  ],
} as const;

// A quaternion for a 90° rotation about Y — a rotation that changes a
// directional light's derived direction from -Z to -X.
const QUAT_90_Y = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)] as const;

test.skipIf(!bunWebGpuAvailable())(
  "previewEntity rebuilds without a daemon op and renders clean",
  async () => {
    const restore = installMockResizeObserver();
    try {
      const host = createViewportHost();
      const canvas = await makeOffscreenCanvas(64, 64);
      // Boundary cast: bun-webgpu mock canvas stands in for HTMLCanvasElement.
      await host.init(canvas as unknown as HTMLCanvasElement, {
        surfaceFormat: "linear",
      });
      await host.loadScene(structuredClone(SCENE) as never);
      expect(() =>
        host.previewEntity("cube", "transform", { position: [2, 0, 0] }),
      ).not.toThrow();
      // Coverage ceiling: headless GPU harness has no pixel readback, so non-throw is the limit here.
      expect(() => host.revertEntity("cube")).not.toThrow();
      host.destroy();
    } finally {
      restore();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "previewEntity transform on a light entity routes through rebuild and renders clean",
  async () => {
    // Regression: a light's direction is transform-DERIVED, refreshed only by
    // rebuildEntity — the mesh-only setEntityTransform fast-path would leave it
    // stale. transformEditNeedsRebuild routes light-transform edits through the
    // clone+rebuild path; this exercises that path end-to-end (must not throw).
    // Coverage ceiling: the host exposes no LoadedScene.lights readback, so the
    // direction VALUE change is pinned by the preview-gate predicate test plus
    // core's already-green light-direction + rebuildEntity tests, not here.
    const restore = installMockResizeObserver();
    try {
      const host = createViewportHost();
      const canvas = await makeOffscreenCanvas(64, 64);
      // Boundary cast: bun-webgpu mock canvas stands in for HTMLCanvasElement.
      await host.init(canvas as unknown as HTMLCanvasElement, {
        surfaceFormat: "linear",
      });
      await host.loadScene(structuredClone(SCENE) as never);
      expect(() =>
        host.previewEntity("sun", "transform", { rotation: QUAT_90_Y }),
      ).not.toThrow();
      expect(() => host.revertEntity("sun")).not.toThrow();
      host.destroy();
    } finally {
      restore();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "previewEntity on invalid params is swallowed (keeps last good render)",
  async () => {
    const restore = installMockResizeObserver();
    try {
      const host = createViewportHost();
      const canvas = await makeOffscreenCanvas(64, 64);
      // Boundary cast: bun-webgpu mock canvas stands in for HTMLCanvasElement.
      await host.init(canvas as unknown as HTMLCanvasElement, {
        surfaceFormat: "linear",
      });
      await host.loadScene(structuredClone(SCENE) as never);
      // material ref to a non-existent resource → rebuild throws internally → swallowed
      expect(() =>
        host.previewEntity("cube", "meshRenderer", {
          geometry: "g",
          material: "nope",
        }),
      ).not.toThrow();
      host.destroy();
    } finally {
      restore();
    }
  },
);
