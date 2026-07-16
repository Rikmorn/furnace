import { describe, expect, test } from "bun:test";
import * as field from "@furnace/core/field";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { MaterialCache } from "../src/realize.ts";
import { loadWorld } from "../src/world-loader.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";
import { bakedFetchStub, runWalk } from "./_helpers/walk-fixture.ts";

// One Field · F1 Task 11 — THE GATE: dig a tunnel in memory, bake it (v2 field artifact), serve
// the bake through the fetch stub, load it through the REAL `loadWorld` (which gates on the v2
// manifest and dispatches to `loadFieldWorld`), then walk the actual `CharacterMover` through the
// dug space against the chunk-derived voxel colliders. This closes the F1 loop: dig -> bake ->
// spawn-in-the-dug-space -> walk-it.
//
// Tunnel geometry (avoid the filed char-move levitation bug that trips on < 2.2 m clearance):
// a chain of r=1.4 m spheres centred at y=1.4, z=1.5 along +x -> a tube with ~2.8 m clearance
// vertically AND laterally (comfortably > 2.2 m). The rock floor sits at y~=0, so a grounded
// capsule (REST_OFFSET 0.9) rides at y~=0.9.

await ensureBunWebGpu();

describe("field world: bake -> load -> walk", () => {
  test.skipIf(!bunWebGpuAvailable())(
    "digs a tunnel, loads it through loadWorld, walks through the dug space",
    async () => {
      const store = field.createFieldStore();
      const log = field.createOpLog();
      for (let x = 1; x <= 7; x += 0.5) {
        field.logApply(
          store,
          log,
          {
            id: 0,
            kind: "brush",
            effect: "dig",
            shape: { kind: "sphere", center: [x, 1.4, 1.5], radius: 1.4 },
          },
          field.BUILTIN_TABLE,
        );
      }
      const files = field.bakeFieldWorld(store, log, field.BUILTIN_TABLE, {
        name: "tunnel",
        playerStart: [1.5, 1.5, 1.5],
        playerYaw: 0,
      });

      const canvas = await makeOffscreenCanvas();
      const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
      const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
      const matCache = new MaterialCache(ctx);
      const orig = globalThis.fetch;
      try {
        globalThis.fetch = bakedFetchStub(files, "tunnel");
        const loaded = await loadWorld(ctx, world, matCache);
        globalThis.fetch = orig; // the walk casts against the world; no more fetches

        // The v2 manifest round-tripped its spawn, and the bake produced render meshes.
        expect(loaded.playerStart).toEqual([1.5, 1.5, 1.5]);
        expect(loaded.playerYaw).toBe(0);
        expect(loaded.meshes.length).toBeGreaterThan(0);

        // Walk +x through the tunnel. `along(pos, [1,0,0]) == pos[0]`; stop past x=5, assert we
        // crossed the tunnel (advanced > 4.5) with no wedge/stall/teleport/launch/fall-through
        // (runWalk asserts those every frame) — floorY/ceilY straddle the ~2.8 m tube.
        const res = runWalk(ctx, world, {
          start: [1.5, 1.5, 1.5],
          dir: [1, 0, 0],
          stopAlong: 5,
          floorY: -1,
          ceilY: 4,
        });
        expect(res.advanced).toBeGreaterThan(4.5);

        loaded.destroy();
      } finally {
        globalThis.fetch = orig;
        matCache.destroy();
        physics.destroyWorld(ctx, world);
        gpu.dispose(ctx);
      }
    },
  );
});
