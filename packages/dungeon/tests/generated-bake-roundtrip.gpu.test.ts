import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { decodeMeshBlob, loadScene } from "@furnace/core/scene";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

// The 3.0 gate artifact: generate → bake → load, headless, end to end, using the SAME
// persistence machinery the game already uses (2.1 .fmesh + region scene doc). The
// fixtures are committed (packages/dungeon/scripts/bake-generated-wing.ts baked them
// from a fixed seed — deterministic, re-baking reproduces the same bytes).

// @furnace/core/scene auto-registers built-ins at module import (side-effect in
// scene/index.ts). No explicit registerBuiltins() call is needed for a consumer.

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "a generated cave region round-trips through the .fmesh + scene-doc bake pipeline and loads via loadScene",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });

    const fixturesDir = join(import.meta.dir, "fixtures");
    const fmeshBuf = readFileSync(join(fixturesDir, "generated-wing.fmesh"));
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        fmeshBuf.buffer.slice(
          fmeshBuf.byteOffset,
          fmeshBuf.byteOffset + fmeshBuf.byteLength,
        ),
      )) as unknown as typeof fetch;

    try {
      const doc = JSON.parse(
        readFileSync(join(fixturesDir, "generated-wing.scene.json"), "utf8"),
      );

      const t0 = performance.now();
      // biome-ignore lint/suspicious/noExplicitAny: test-only JSON boundary
      const scene = await loadScene(ctx, doc as any, { world, fragment: true });
      const loadMs = performance.now() - t0;
      // P2 signal: the realize/load half of the generate→bake→load pipeline.
      console.info(
        `[bake-roundtrip] loadScene (fragment) completed in ${loadMs.toFixed(1)}ms`,
      );

      expect(scene.meshes.length).toBeGreaterThanOrEqual(1);
      expect(scene.world).toBe(world); // injected world is reused, not a new one

      // Collision proof: the fixture is render-only (no rigidBody in the scene doc,
      // matching the 2.2.1 render/collision split) — build a static trimesh collider
      // from the SAME decoded local-frame vertices the .fmesh carries, seated with the
      // scene doc's own transform (position/rotation), and confirm a downward raycast
      // from just above the mesh's local-frame top finds real, positioned geometry.
      const blob = decodeMeshBlob(
        fmeshBuf.buffer.slice(
          fmeshBuf.byteOffset,
          fmeshBuf.byteOffset + fmeshBuf.byteLength,
        ),
      );
      const transform = doc.entities[0].components.transform;

      let localYMax = -Infinity;
      for (let i = 1; i < blob.render.positions.length; i += 3) {
        const y = blob.render.positions[i] as number;
        if (y > localYMax) localYMax = y;
      }

      physics.createBody(ctx, world, {
        type: "static",
        shape: {
          trimesh: {
            vertices: blob.render.positions,
            indices: blob.render.indices,
          },
        },
        position: transform.position,
        rotation: transform.rotation,
      });
      physics.step(ctx, world, 1 / 60); // populate broadphase before casting

      const castHeight = (transform.position[1] as number) + localYMax + 2;
      const hit = physics.castRay(ctx, world, {
        origin: [transform.position[0], castHeight, transform.position[2]],
        dir: [0, -1, 0],
        maxDistance: 5,
      });
      expect(hit).not.toBeNull();

      scene.destroy(); // leak-free: injected world is NOT destroyed by scene.destroy()
      physics.step(ctx, world, 1 / 60); // world still usable after fragment teardown
    } finally {
      globalThis.fetch = orig;
    }

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
