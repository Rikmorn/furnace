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

// F2a Task 13's 3-class fixture table (rock id0 organic, dirt id1 organic, masonry id2 kit).
const WALL_TABLE: field.MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
    {
      id: 2,
      name: "masonry",
      kind: "kit",
      color: [0.5, 0.5, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.4, 0.4, 0.4, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
};

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

// F2a Task 13 — THE SLICE PAYOFF: a baked field world with a masonry wall + a coarse gap must be
// WALKABLE (cross the gap) and BLOCKING (a wall segment stops you), both against the UNCHANGED
// density collider (masonry fills solid density, so it blocks with no collision-path change).
//
// Fixture: a room (air x 0..6, y 0..3.5, z 0..7; ~3.5 m clearance, clear of the levitation bug)
// with a masonry wall at x 3.0..3.5 in two z segments (1..3 and 4.5..6.5) leaving a 1.5 m gap
// (z 3.0..4.5). Every wall face lands on the 0.5 m coarse lattice so the wall skins cleanly.
describe("field world: masonry wall walk probe", () => {
  test.skipIf(!bunWebGpuAvailable())(
    "crosses the gap and is blocked by a wall segment",
    async () => {
      const store = field.createFieldStore();
      const log = field.createOpLog();
      // Room: air x 0..6, y 0..3.5, z 0..7.
      field.logApply(
        store,
        log,
        {
          id: 0,
          kind: "brush",
          effect: "dig",
          shape: {
            kind: "box",
            center: [3, 1.75, 3.5],
            halfExtents: [3, 1.75, 3.5],
          },
        },
        WALL_TABLE,
      );
      // Masonry wall segment 1: x 3.0..3.5, y 0..2.5, z 1..3.
      field.logApply(
        store,
        log,
        {
          id: 0,
          kind: "brush",
          effect: "fill",
          material: 2,
          shape: {
            kind: "box",
            center: [3.25, 1.25, 2],
            halfExtents: [0.25, 1.25, 1],
          },
        },
        WALL_TABLE,
      );
      // Masonry wall segment 2: x 3.0..3.5, y 0..2.5, z 4.5..6.5 (a 1.5 m gap at z 3.0..4.5).
      field.logApply(
        store,
        log,
        {
          id: 0,
          kind: "brush",
          effect: "fill",
          material: 2,
          shape: {
            kind: "box",
            center: [3.25, 1.25, 5.5],
            halfExtents: [0.25, 1.25, 1],
          },
        },
        WALL_TABLE,
      );
      const files = field.bakeFieldWorld(store, log, WALL_TABLE, {
        name: "wallgap",
        playerStart: [2, 1.5, 3.75],
        playerYaw: 0,
      });

      const canvas = await makeOffscreenCanvas();
      const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
      const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
      const matCache = new MaterialCache(ctx);
      const orig = globalThis.fetch;
      try {
        globalThis.fetch = bakedFetchStub(files, "wallgap");
        const loaded = await loadWorld(ctx, world, matCache);
        globalThis.fetch = orig; // the walks cast against the world; no more fetches

        // The masonry wall skinned to at least one instanced kit chunk.
        expect(loaded.instanced.length).toBeGreaterThan(0);

        // (a) WALKABLE: spawn at the gap centre (z=3.75) and walk +x through it — crossing the
        // wall plane (x~=3.25) and reaching the far side (advanced > 4.5), with no wedge/stall/
        // teleport/launch/fall-through (runWalk asserts those every frame).
        const through = runWalk(ctx, world, {
          start: [2, 1.5, 3.75],
          dir: [1, 0, 0],
          stopAlong: 5,
          floorY: -1,
          ceilY: 4,
        });
        expect(through.advanced).toBeGreaterThan(4.5);

        // (b) BLOCKING: spawn in front of wall segment 1 (z=2.0) and drive +x into it. The wall
        // stops the mover before its near face (x=3.0) — expectStop drives the full budget while
        // still asserting no teleport/launch/fall-through per frame.
        const blocked = runWalk(ctx, world, {
          start: [2, 1.5, 2],
          dir: [1, 0, 0],
          expectStop: true,
          floorY: -1,
          ceilY: 4,
        });
        expect(blocked.pos[0]).toBeLessThan(3);

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
