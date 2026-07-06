import { expect, test } from "bun:test";
import * as binding from "@furnace/core/binding";
import * as geometry from "@furnace/core/geometry";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import * as material from "@furnace/core/material";
import * as meshMod from "@furnace/core/mesh";
import { vec4 } from "@furnace/core/transform";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { makeUnlitMaterial } from "../../core/tests/_helpers/unlit-material.ts";
import { createPreviewHost } from "../src/viewport-host/index.ts";

await ensureBunWebGpu();

test("preview host ctx()/world() throw before init", () => {
  const host = createPreviewHost();
  expect(() => host.ctx()).toThrow();
  expect(() => host.world()).toThrow();
});

test.skipIf(!bunWebGpuAvailable())(
  "preview host inits HDR, adopts a mesh, renders + frames, and disposes with no leaked slots",
  async () => {
    const restore = installMockResizeObserver();
    try {
      const host = createPreviewHost();
      const canvas = await makeOffscreenCanvas(64, 64);
      // Boundary cast: bun-webgpu mock canvas stands in for HTMLCanvasElement.
      // surfaceFormat:linear because the bun-webgpu mock drops the viewFormats
      // array, so the engine's default sRGB surface view fails validation.
      await host.init(canvas as unknown as HTMLCanvasElement, {
        surfaceFormat: "linear",
      });

      // ctx()/world() return live handles once init has resolved.
      const ctx = host.ctx();
      expect(host.world()).toBeDefined();

      // Build ONE tiny cube directly against the host's ctx and adopt it as the
      // preview content (mirrors what the panel does with realize's output).
      const geo = geometry.cube(ctx);
      const { material: mat, binding: bind } = await makeUnlitMaterial(
        ctx,
        vec4.fromValues(1, 0.5, 0.2, 1),
      );
      const cube = meshMod.create(ctx, { geometry: geo, material: mat });
      host.adopt({
        meshes: [cube],
        instanced: [],
        destroy: () => {
          meshMod.destroy(ctx, cube);
          material.destroy(ctx, mat);
          binding.destroy(ctx, bind);
          geometry.destroy(ctx, geo);
        },
      });

      expect(() => host.render()).not.toThrow();
      expect(() => host.frame([-1, -1, -1], [1, 1, 1])).not.toThrow();

      // Leak check: capture teardown logs; a clean shutdown emits no
      // "leak suspected" warn (the established gpu.dispose leak-check convention).
      const entries: LogEntry[] = [];
      setSink((e) => entries.push(e));
      try {
        await host.clear();
        host.destroy();
      } finally {
        setSink(consoleSink);
      }
      const leakWarn = entries.find(
        (e) =>
          e.module === "gpu" &&
          e.message.includes(
            "context disposed with live resource-manager slots",
          ),
      );
      expect(leakWarn).toBeUndefined();
    } finally {
      restore();
    }
  },
);
