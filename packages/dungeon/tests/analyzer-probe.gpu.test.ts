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
import { columnPass } from "../scripts/analyzer-probe/column-pass.ts";
import {
  deepPitGeometry,
  FIXTURE_VOXEL_SIZE,
  type Fixture,
  fixtureControlProxy,
  fixtureProxy,
  fixtureProxyPosition,
  fixtures,
  lowHeadroomLedgeGeometry,
  tallRimGeometry,
  walkableLedgeGeometry,
} from "../scripts/analyzer-probe/fixtures.ts";
import {
  type Occupancy,
  occupancyFromProxy,
} from "../scripts/analyzer-probe/occupancy.ts";
import {
  confirmedTraps,
  type SweepScene,
  sweepFlags,
} from "../scripts/analyzer-probe/sweep.ts";
import type { Field } from "../src/field.ts";
import {
  type VoxelsProxy,
  voxelProxyPosition,
  voxelsFromField,
} from "../src/proxy.ts";
import type { GridConfig } from "../src/surface-nets.ts";
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

// ── the HYBRID pass: stage 1 (flags) → stage 2 (real-mover confirm/clear) ──────────────
//
// Stage 2's job changed when Task 2 measured the mover. It was specified as a DETECTOR of the
// one class stage 1 structurally cannot see (the sub-step-height two-contact wedge) — and that
// class does not reproduce against this mover. What Task 2 did find is that the real climb
// ceiling is ~0.7 m, not STEP_HEIGHT 0.4, so stage 1 over-flags `ledge` across the whole
// 0.4–0.7 m band. Stage 2 is therefore a FILTER, and it has to be trustworthy BOTH ways:
//   - CONFIRM a real trap (`traps the real mover`, below) — a false CLEAR is a MISS, F0's P1
//     stop condition, and the only outcome that can ship a broken floor;
//   - CLEAR a false positive (`the 0.5 m walkable ledge`, below) — a filter that cannot drop a
//     MEASURED false positive adds nothing to the flags stage 1 already emits, and stage 2
//     costs a real-mover walk per flag per direction.
// The second test is the load-bearing one: it is stage 2's only evidence of value.

/** Stage 1 over a proxy: the occupancy it sees and the flags it raises. */
function stage1(proxy: VoxelsProxy, position: [number, number, number]) {
  const occ: Occupancy = occupancyFromProxy(proxy, position);
  const { walkable, flags } = columnPass(occ);
  const scene: SweepScene = { occ, walkable };
  return { occ, scene, flags };
}

/** Proxy + body position for a stage-2 control geometry, at the production cave voxel size —
 *  the same collider the corpus fixtures are voxelized into. */
function controlProxy(geom: { field: Field; grid: GridConfig }): {
  proxy: VoxelsProxy;
  position: [number, number, number];
} {
  return {
    proxy: voxelsFromField(geom.field, geom.grid, FIXTURE_VOXEL_SIZE),
    position: voxelProxyPosition(geom.grid, [0, 0, 0]),
  };
}

for (const f of fixtures()) {
  test.skipIf(!bunWebGpuAvailable())(
    `${f.name} (${f.class}): stage 1 flags it, stage 2 CONFIRMS the trap`,
    async () => {
      const proxy = fixtureProxy(f);
      const position = fixtureProxyPosition(f);
      const { scene, flags } = stage1(proxy, position);
      // Zero flags on a geometry that PROVABLY traps the mover (the test above) is a stage-1
      // MISS — F0's P1 stop condition. It fires here, loudly, or not at all.
      expect(flags.length).toBeGreaterThan(0);
      await withFixtureWorld(proxy, position, (w) => {
        const verdicts = sweepFlags(w.ctx, w.world, scene, flags);
        expect(confirmedTraps(verdicts).length).toBeGreaterThan(0);
      });
    },
  );
}

test.skipIf(!bunWebGpuAvailable())(
  "the 0.5 m walkable ledge: stage 1 flags `ledge`, the mover walks it, stage 2 CLEARS it",
  async () => {
    const { proxy, position } = controlProxy(walkableLedgeGeometry());
    const { scene, flags } = stage1(proxy, position);
    const ledges = flags.filter((f) => f.kind === "ledge");
    // Stage 1 over-flags: a 0.5 m rise is above its STEP_HEIGHT bar and below the mover's real
    // ~0.7 m climb ceiling. The false positive is REAL, not hypothetical.
    expect(ledges.length).toBeGreaterThan(0);

    await withFixtureWorld(proxy, position, (w) => {
      // The mover really does walk it — asserted independently of the sweep, through the same
      // harness the corpus uses (its no-stall / no-teleport / no-launch guards stay ARMED).
      const walk = runWalk(w.ctx, w.world, {
        start: [-4, 1.0, 0],
        dir: [1, 0, 0],
        stopAlong: 4.5,
        floorY: -1.0,
        ceilY: 2.0, // rest on the 0.5 m ledge is y 1.4; a levitating capsule would blow this
      });
      expect(walk.advanced).toBeGreaterThan(4.4);

      // ...and stage 2 says so: not one of stage 1's ledges survives as a confirmed trap.
      const verdicts = sweepFlags(w.ctx, w.world, scene, ledges);
      expect(confirmedTraps(verdicts)).toEqual([]);
      // Actively CLEARED, not merely "not confirmed": an inconclusive verdict keeps the flag,
      // so silence here would leave stage 1's false positive standing and stage 2 worthless.
      expect(verdicts.every((v) => v.outcome === "clear")).toBe(true);
    });
  },
);

// ── the stage-1 blind spot above the old scan cap (a real MISS class, now closed) ─────────
// The rise scan used to stop at `stepCells + 2` = 0.75 m, so a rise TALLER than that emitted no
// `ledge` at all — while stalling the mover just as hard. RIM_H and POCKET_D are both 0.75 m,
// i.e. the corpus passed by sitting exactly on the last value the cap could see; one cell more
// and it saw nothing. These two geometries are the corpus's taller siblings and they FAIL
// against the capped scan (zero flags), which is the only reason they are worth having.
for (const [name, geom] of [
  ["tall rim 1.0 m", tallRimGeometry()],
  ["deep pit 1.0 m", deepPitGeometry()],
] as const) {
  test.skipIf(!bunWebGpuAvailable())(
    `${name} (above the old 0.75 m scan cap): stage 1 flags \`ledge\`, stage 2 CONFIRMS the trap`,
    async () => {
      const { proxy, position } = controlProxy(geom);
      const { scene, flags } = stage1(proxy, position);
      const ledges = flags.filter((f) => f.kind === "ledge");
      expect(ledges.length).toBeGreaterThan(0); // zero here is the MISS the cap used to cause
      await withFixtureWorld(proxy, position, (w) => {
        // Swept from the LEDGE flags alone: the incidental `narrow` flags at the corridor
        // corners must not be what rescues this, or the blind spot would still be open.
        const verdicts = sweepFlags(w.ctx, w.world, scene, ledges);
        expect(confirmedTraps(verdicts).length).toBeGreaterThan(0);
      });
    },
  );
}

test.skipIf(!bunWebGpuAvailable())(
  "the levitation guard: a sub-2.2 m-headroom floor is INCONCLUSIVE, never CLEAR",
  async () => {
    // Same 0.5 m rise, 2.0 m ceiling. Stage 1 calls the floor walkable (2.0 >= the 1.8 m
    // capsule) but `applyGravity`'s rest sweep lifts the capsule to +STEP_HEIGHT before
    // sweeping down, so it needs 2.2 m — the lifted pose starts in the ceiling, castShape
    // (stopAtPenetration) returns toi 0, and the capsule climbs 0.4 m/frame while REPORTING
    // GROUNDED. It keeps advancing horizontally the whole time, so an unguarded sweep would
    // walk it past the flag and call that a CLEAR: a MISS on a floor the mover cannot stand on.
    const { proxy, position } = controlProxy(lowHeadroomLedgeGeometry());
    const { scene, flags } = stage1(proxy, position);
    expect(flags.length).toBeGreaterThan(0);

    await withFixtureWorld(proxy, position, (w) => {
      const verdicts = sweepFlags(w.ctx, w.world, scene, flags);
      // The guard fired: the probe SAW the shipped bug rather than inferring it.
      expect(verdicts.some((v) => v.levitated > 0)).toBe(true);
      // And nothing was blessed on the strength of a levitating walk.
      expect(verdicts.some((v) => v.outcome === "clear")).toBe(false);
    });
  },
);
