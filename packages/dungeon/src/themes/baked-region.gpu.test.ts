import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { loadScene } from "@furnace/core/scene";
import { vec3 } from "@furnace/core/transform";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import { bakedCavernProxy } from "./cave.ts";

// @furnace/core/scene auto-registers built-ins at module import (side-effect in
// scene/index.ts). No explicit registerBuiltins() call is needed for a consumer.

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "the baked region loads via loadScene (render-only) and a field-derived voxel proxy catches a ball",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });

    const regionsDir = join(import.meta.dir, "..", "..", "regions");
    const buf = readFileSync(join(regionsDir, "region-cavern.fmesh"));
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      )) as unknown as typeof fetch;

    try {
      const doc = JSON.parse(
        readFileSync(join(regionsDir, "region-cavern.scene.json"), "utf8"),
      );
      // biome-ignore lint/suspicious/noExplicitAny: test-only JSON boundary
      const scene = await loadScene(ctx, doc as any, { world, fragment: true });

      expect(scene.meshes.length).toBe(1);
      expect(scene.world).toBe(world); // injected world is reused, not a new one

      // The cavern scene is now render-only; collision comes from a field-derived
      // voxel proxy regenerated from the same seed/origin as the baked mesh.
      const cavernProxy = bakedCavernProxy("cavern-1", [0, 0, -24]);
      physics.createBody(ctx, world, {
        type: "static",
        shape: cavernProxy.proxy,
        position: cavernProxy.proxyPosition,
      });

      // Collision proof: a ball dropped above the cavern bowl center (entity placed
      // at world [0,0,-24]) should be caught by the voxel floor, not fall to -infinity.
      const ball = physics.createBody(ctx, world, {
        type: "dynamic",
        shape: { ball: 0.4 },
        position: [0, 2, -24],
      });

      for (let i = 0; i < 240; i++) physics.step(ctx, world, 1 / 60);

      const pos = physics.getBodyTranslation(ctx, ball, vec3.create());
      // The ball must be caught by the voxel floor — NOT fallen through to -infinity.
      // Threshold -4 is generous enough to tolerate any bowl depth while still
      // ruling out an uncollided free-fall (240 steps × 9.81 m/s² ≈ 470 m down).
      expect(pos[1]).toBeGreaterThan(-4);

      scene.destroy(); // leak-free: injected world is NOT destroyed by scene.destroy()
      physics.step(ctx, world, 1 / 60); // world still usable after fragment teardown
    } finally {
      globalThis.fetch = orig;
    }

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
