// F0 analyzer probe — the known-bad corpus's VALIDITY PROOF. A fixture only counts as
// known-bad once the REAL `CharacterMover` demonstrably fails there (Walk-Monster
// fidelity: test the code, not the data), so every fixture ships a walk test here and
// stage 3 may only claim a "miss" against geometry that actually traps.
//
// THE ASSERTION IS A DIFFERENTIAL, AND IT HAS TO BE. `runWalk` reports
// `advanced = pos · dir` — the capsule's ABSOLUTE projected coordinate, not the distance
// it travelled. So "advanced is small" is not evidence of a trap on its own: a corridor
// that is simply short, a spawn that never moved, or an exhausted iteration budget all
// read identically to a wedge. Each fixture is therefore walked TWICE:
//
//   CONTROL (hazard removed, `expectStop: false`): the mover must reach `clearAlong`,
//     well past the hazard's x. `expectStop: false` keeps runWalk's own no-stall assert
//     ARMED, so a control that wedges FAILS rather than quietly passing. This proves the
//     room, the spawn, the lane and the budget are sane and the floor is genuinely walkable.
//   HAZARD (`expectStop: true`): the mover must NOT get past `hazardAlong`. `expectStop`
//     suppresses the stall assert — being stuck is the point — while keeping the
//     per-frame teleport / ghost-launch / fall-through guards live, so a "trap" that is
//     really a fall through the floor or a levitating rest sweep still fails the test.
//
// Only the pair proves the GEOMETRY is what stops the mover. Neither half is meaningful
// alone. When a fixture misbehaves the fix is its geometry constant (each is a named
// TUNABLE in `fixtures.ts`), never a looser bar here.
import { expect, test } from "bun:test";
import type { Context } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import {
  type Fixture,
  fixtureControlProxy,
  fixtureProxy,
  fixtureProxyPosition,
  fixtures,
} from "../scripts/analyzer-probe/fixtures.ts";
import type { VoxelsProxy } from "../src/proxy.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";
import { runWalk } from "./_helpers/walk-fixture.ts";

await ensureBunWebGpu();

/** Slack (m) on the control's `clearAlong` bar: `runWalk` breaks the frame AFTER it
 *  passes `stopAlong`, so a clean control lands just beyond it. One frame step. */
const CLEAR_TOL = 0.1;

/** A world holding ONLY the fixture's static voxel proxy — no other collider can mask or
 *  cause a stop, so whatever the mover does is attributable to this geometry alone. */
async function withFixtureWorld(
  proxy: VoxelsProxy,
  position: [number, number, number],
  run: (args: { ctx: Context; world: physics.World }) => void,
): Promise<void> {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  try {
    physics.createBody(ctx, world, {
      type: "static",
      shape: { voxels: { coords: proxy.coords, size: proxy.size } },
      position,
    });
    run({ ctx, world });
  } finally {
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  }
}

const controlWalk = (f: Fixture): Promise<void> =>
  withFixtureWorld(fixtureControlProxy(f), fixtureProxyPosition(f), (w) => {
    const res = runWalk(w.ctx, w.world, {
      start: f.start,
      dir: f.dir,
      stopAlong: f.clearAlong,
      floorY: f.floorY,
      ceilY: f.ceilY,
    });
    expect(res.advanced).toBeGreaterThan(f.clearAlong - CLEAR_TOL);
  });

const hazardWalk = (f: Fixture): Promise<void> =>
  withFixtureWorld(fixtureProxy(f), fixtureProxyPosition(f), (w) => {
    const res = runWalk(w.ctx, w.world, {
      start: f.start,
      dir: f.dir,
      expectStop: true,
      floorY: f.floorY,
      ceilY: f.ceilY,
    });
    expect(res.advanced).toBeLessThan(f.hazardAlong);
  });

for (const f of fixtures()) {
  test.skipIf(!bunWebGpuAvailable())(
    `${f.name} (${f.class}) CONTROL: the mover clears the hazard zone`,
    () => controlWalk(f),
  );

  test.skipIf(!bunWebGpuAvailable())(
    `${f.name} (${f.class}) traps the real mover`,
    () => hazardWalk(f),
  );
}
