// Traversal regression / fuzz harness. Builds the FULL main.ts collider world
// (every LEVEL_BOXES cuboid + all three region voxel proxies + props) and WALKS a
// capsule across it from many start points, asserting the invariants that the
// gate rounds kept violating: never permanently wedged on the walkable floor, and
// no fall-through outside the designed pits. The hard lesson baked in: the bug is
// WALK-IN only (dropping a capsule in rests it on top and hides the wedge), so this
// must drive the real CharacterMover along real paths — not place-and-probe.
import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/char-move.ts";
import { generateProxy, generateRegion } from "../src/generator.ts";
import { LEVEL_BOXES } from "../src/level.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const CAP = { halfHeight: 0.6, radius: 0.3 };
const DT = 1 / 60;
const SPEED = 3; // m/s walk speed, matching the game
type V3 = [number, number, number];

/** The exact collider set main.ts builds: authored cuboids + cavern (render-only,
 *  proxy regenerated) + shaft + chamber voxel proxies. Kept in sync with main.ts. */
async function buildFullWorld() {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, {
    gravity: [0, -9.81, 0],
    lengthUnit: 1,
  });
  for (const b of LEVEL_BOXES)
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
      position: b.center,
    });
  const cav = generateProxy({
    seed: "cavern-1",
    kind: "cavern",
    origin: [0, 0, -24],
  });
  physics.createBody(ctx, world, {
    type: "static",
    shape: cav.proxy,
    position: cav.proxyPosition,
  });
  const shaft = generateRegion({
    seed: "shaft-1",
    kind: "shaft",
    origin: [13, 0, -6],
  });
  physics.createBody(ctx, world, {
    type: "static",
    shape: shaft.proxy,
    position: shaft.proxyPosition,
  });
  const chamber = generateRegion({
    seed: "chamber-1",
    kind: "chamber",
    origin: [0, 0, -19],
  });
  physics.createBody(ctx, world, {
    type: "static",
    shape: chamber.proxy,
    position: chamber.proxyPosition,
  });
  return { ctx, world };
}

function disposeWorld(ctx: gpu.Context, world: physics.World) {
  physics.destroyWorld(ctx, world);
  gpu.dispose(ctx);
}

/** Walk a mover by `dir` for `frames` ticks, stepping the world each tick. */
function walk(
  ctx: gpu.Context,
  world: physics.World,
  body: physics.Body,
  mover: CharacterMover,
  start: V3,
  dir: V3,
  frames: number,
): V3 {
  let pos = start;
  for (let i = 0; i < frames; i++) {
    pos = mover.resolve(ctx, world, pos, dir, DT).pos;
    physics.setBodyNextKinematicTranslation(ctx, body, pos);
    physics.step(ctx, world, DT);
  }
  return pos;
}

function spawn(ctx: gpu.Context, world: physics.World, at: V3) {
  const body = physics.createBody(ctx, world, {
    type: "kinematicPosition",
    shape: { capsule: CAP },
    position: at,
  });
  physics.step(ctx, world, DT);
  return { body, mover: new CharacterMover(CAP, body) };
}

test.skipIf(!bunWebGpuAvailable())(
  "regression: the exact spots that wedged the capsule are now traversable",
  async () => {
    const { ctx, world } = await buildFullWorld();
    // Spots captured live via the in-game G-probe across the three gate rounds.
    const spots: V3[] = [
      [0.28, 0.4, -19.49],
      [3.18, 0.4, -20.1],
    ];
    for (const at of spots) {
      const { body, mover } = spawn(ctx, world, at);
      const settled = walk(ctx, world, body, mover, at, [0, 0, 0], 30);
      let best = 0;
      for (const d of [
        [SPEED * DT, 0, 0],
        [-SPEED * DT, 0, 0],
        [0, 0, SPEED * DT],
        [0, 0, -SPEED * DT],
      ] as V3[]) {
        const end = walk(ctx, world, body, mover, settled, d, 20);
        best = Math.max(
          best,
          Math.hypot(end[0] - settled[0], end[2] - settled[2]),
        );
        physics.setBodyNextKinematicTranslation(ctx, body, settled);
        physics.step(ctx, world, DT);
      }
      // A wedged capsule moves ~0 in every direction; a free one travels freely.
      expect(best).toBeGreaterThan(0.5);
      physics.destroyBody(ctx, body);
    }
    disposeWorld(ctx, world);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "fuzz: no lane wedges walking -Z across the chamber",
  async () => {
    const { ctx, world } = await buildFullWorld();
    const stalls: string[] = [];
    // One lane per 0.75m of chamber width, each walking the full depth.
    for (let x = -5; x <= 5.001; x += 0.75) {
      const { body, mover } = spawn(ctx, world, [x, 1.5, -16.5]);
      let pos: V3 = [x, 1.5, -16.5];
      for (let i = 0; i < 600; i++) {
        const prev = pos;
        pos = mover.resolve(ctx, world, pos, [0, 0, -SPEED * DT], DT).pos;
        physics.setBodyNextKinematicTranslation(ctx, body, pos);
        physics.step(ctx, world, DT);
        if (pos[1] < -1) break; // dropped into the central grotto (by design)
        if (pos[2] < -31) break; // reached the back wall (legitimate stop)
        const advanced = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]);
        // Mid-chamber (well clear of the back wall), on the floor, not advancing
        // while pushing forward = a wedge.
        if (pos[2] < -17 && pos[2] > -30 && advanced < 0.002) {
          stalls.push(
            `x=${x.toFixed(2)} @ (${pos.map((n) => n.toFixed(2)).join(",")})`,
          );
          break;
        }
      }
      physics.destroyBody(ctx, body);
    }
    expect(stalls).toEqual([]);
    disposeWorld(ctx, world);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "no fall-through: the chamber floor is solid everywhere outside the grotto pit",
  async () => {
    const { ctx, world } = await buildFullWorld();
    physics.step(ctx, world, DT); // init the broad-phase before queries
    const voids: string[] = [];
    for (let x = -5; x <= 5.001; x += 1)
      for (let z = -17; z >= -21.001; z -= 1) {
        if (Math.abs(x) <= 2 && z <= -21.5) continue; // the designed grotto pit
        const hit = physics.castRay(ctx, world, {
          origin: [x, 4, z],
          dir: [0, -1, 0],
          maxDistance: 16,
        });
        // Floor must exist and be near walking height (not the grotto bottom).
        if (hit === null || hit.point[1] < -1)
          voids.push(`(${x},${z})=${hit ? hit.point[1].toFixed(2) : "VOID"}`);
      }
    expect(voids).toEqual([]);
    disposeWorld(ctx, world);
  },
);
