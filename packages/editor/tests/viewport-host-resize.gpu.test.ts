import { expect, spyOn, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import {
  fireResize,
  installMockResizeObserver,
} from "../../core/tests/_helpers/mock-resize-observer.ts";
import { createViewportHost } from "../src/viewport-host/index.ts";

await ensureBunWebGpu();

// Scene using ONLY built-in components (no consumer extension) so the unbundled
// host's core registry can load it.
const builtinScene = {
  version: 1,
  settings: { clearColor: [0, 0, 0, 1] },
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
      id: "cube",
      components: {
        transform: {},
        meshRenderer: { geometry: "g", material: "m" },
      },
    },
  ],
};

test.skipIf(!bunWebGpuAvailable())(
  "loadScene issued before init is queued and applied once init completes",
  async () => {
    const restore = installMockResizeObserver();
    try {
      const host = createViewportHost();
      const canvas = await makeOffscreenCanvas(64, 64);
      // loadScene BEFORE init must NOT throw — it queues the document.
      await host.loadScene(builtinScene as never);
      // init resolves → the queued scene is applied.
      // Boundary cast: bun-webgpu mock canvas stands in for HTMLCanvasElement.
      await host.init(canvas as unknown as HTMLCanvasElement, {
        surfaceFormat: "linear",
      });
      // Proof the queued scene actually loaded: render() presents only when a
      // scene is loaded (no-op otherwise).
      const gpuCtx = (canvas as unknown as HTMLCanvasElement).getContext(
        "webgpu",
      );
      if (!gpuCtx)
        throw new Error("expected a webgpu context on the mock canvas");
      const present = spyOn(gpuCtx, "getCurrentTexture");
      const before = present.mock.calls.length;
      host.render();
      expect(present.mock.calls.length).toBeGreaterThan(before);
      host.destroy();
    } finally {
      restore();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "canvas resize re-renders the loaded scene (render happens AFTER the backing-store resize, not before)",
  async () => {
    const restore = installMockResizeObserver();
    try {
      const host = createViewportHost();
      const canvas = await makeOffscreenCanvas(64, 64);
      // Boundary cast: bun-webgpu mock canvas stands in for HTMLCanvasElement.
      await host.init(canvas as unknown as HTMLCanvasElement, {
        surfaceFormat: "linear",
      });
      await host.loadScene(builtinScene as never);

      // Spy on the SAME webgpu context the host renders through. getCurrentTexture
      // is called by frame.render → a present/render.
      const gpuCtx = (canvas as unknown as HTMLCanvasElement).getContext(
        "webgpu",
      );
      if (!gpuCtx)
        throw new Error("expected a webgpu context on the mock canvas");
      const present = spyOn(gpuCtx, "getCurrentTexture");

      const before = present.mock.calls.length;
      fireResize(canvas as unknown as Element, 128, 128); // synthesize a panel/canvas resize
      const after = present.mock.calls.length;

      // The host must re-render on resize. Before the fix this is 0 (the chrome's
      // ResizeObserver — absent in this host-level test — was the only re-render,
      // and it fired BEFORE the backing-store resize anyway). After the fix the
      // host's own onResize subscription renders AFTER the resize.
      expect(after).toBeGreaterThan(before);

      host.destroy();
    } finally {
      restore();
    }
  },
);
