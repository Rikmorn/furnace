// packages/dungeon/tests/connect.gpu.test.ts
// GPU proof for Task 4's `route` connector: realize a routed ramp (and separately a
// stair-run) into a physics world and drive the custom CharacterMover capsule up it,
// asserting it actually CLIMBS (Y rises, Z advances) without wedging. The connector is
// flanked by a flat bottom pad (ground under the spawn) and a flat top landing pad at the
// connector's exit height — modelling how `route` connectors bridge two regions, so the
// climb ends on real ground rather than walking off a void edge. Also probes the
// connector ENCLOSURE with rays: a tube's ceiling blocks an upward cast, the "open"
// style doesn't, and its guardrail blocks a sideways cast at rail height.
import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { vec3 } from "@furnace/core/transform";
import { aabbOfBoxes } from "../src/aabb.ts";
import { mouthCollar } from "../src/built.ts";
import { CharacterMover } from "../src/char-move.ts";
import { route } from "../src/connect.ts";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import {
  type Connection,
  GENERATOR_VERSION,
  type RegionData,
} from "../src/region.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
const CAP = { halfHeight: 0.6, radius: 0.3 };
const DT = 1 / 60;
const WALK_SPEED = 3; // m/s along +Z
const MAX_FRAMES = 600;
const TOP_PAD_LEN = 3; // flat landing past the connector exit
const STALL_LIMIT = 45; // never wedged for ~0.75 s
const P = (
  position: [number, number, number],
  facing: [number, number, number],
): Connection => ({ position, facing, width: 2, height: 3, kind: "door" });

async function climb(kind: "ramp" | "stairs", dh: number, run: number) {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const cache = new MaterialCache(ctx);

  const bottomPad = route(P([0, 0, -2], [0, 0, 1]), P([0, 0, 0], [0, 0, -1]), {
    kind: "corridor",
  });
  const connector = route(
    P([0, 0, 0], [0, 0, 1]),
    P([0, dh, run], [0, 0, -1]),
    {
      kind,
    },
  );
  const topPad = route(
    P([0, dh, run], [0, 0, 1]),
    P([0, dh, run + TOP_PAD_LEN], [0, 0, -1]),
    { kind: "corridor" },
  );
  const realized = [];
  for (const r of [bottomPad, connector, topPad]) {
    realized.push(await realizeRegion(ctx, world, cache, r));
  }

  const startY = CAP.halfHeight + CAP.radius + 0.1;
  let pos: [number, number, number] = [0, startY, -1];
  const body = physics.createBody(ctx, world, {
    type: "kinematicPosition",
    shape: { capsule: CAP },
    position: pos,
  });
  physics.step(ctx, world, DT);
  const mover = new CharacterMover(CAP, body);
  let maxStall = 0;
  let stall = 0;
  let reachedTop = false;
  for (let i = 0; i < MAX_FRAMES; i++) {
    const prev = pos;
    pos = mover.resolve(ctx, world, pos, [0, 0, WALK_SPEED * DT], DT).pos;
    physics.setBodyNextKinematicTranslation(ctx, body, pos);
    physics.step(ctx, world, DT);
    const advanced = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
    stall = advanced ? 0 : stall + 1;
    maxStall = Math.max(maxStall, stall);
    // Reached the landing: advanced past the connector exit AND risen well above the
    // spawn. Break here so the final sample is the climbed state, not an overshoot.
    if (pos[2] >= run && pos[1] > startY + 0.5) {
      reachedTop = true;
      break;
    }
  }
  const out = physics.getBodyTranslation(ctx, body, vec3.create());
  const result = {
    climbedY: out[1] as number,
    advancedZ: out[2] as number,
    maxStall,
    reachedTop,
  };
  for (const r of realized) r.destroy();
  cache.destroy();
  physics.destroyWorld(ctx, world);
  gpu.dispose(ctx);
  return result;
}

test.skipIf(!bunWebGpuAvailable())(
  "CharacterMover climbs a routed ramp",
  async () => {
    const r = await climb("ramp", 1.5, 4);
    expect(r.reachedTop).toBe(true); // climbed the whole ramp, never fell off
    expect(r.climbedY).toBeGreaterThan(1.0); // rose most of the 1.5m
    expect(r.advancedZ).toBeGreaterThan(3); // reached the top
    expect(r.maxStall).toBeLessThan(STALL_LIMIT);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "CharacterMover climbs a routed stair-run",
  async () => {
    const r = await climb("stairs", 1.5, 3);
    expect(r.reachedTop).toBe(true);
    expect(r.climbedY).toBeGreaterThan(1.0);
    expect(r.advancedZ).toBeGreaterThan(2);
    expect(r.maxStall).toBeLessThan(STALL_LIMIT);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "enclosure rays: tube ceiling blocks upward, open style doesn't, rails block sideways",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const tube = route(P([0, 0, 0], [0, 0, 1]), P([0, 0, 6], [0, 0, -1]), {
      kind: "corridor",
    });
    const open = route(P([20, 0, 0], [0, 0, 1]), P([20, 0, 6], [0, 0, -1]), {
      kind: "corridor",
      enclosure: "open",
    });
    const realized = [];
    for (const r of [tube, open]) {
      realized.push(await realizeRegion(ctx, world, cache, r));
    }
    physics.step(ctx, world, DT);
    const upTube = physics.castRay(ctx, world, {
      origin: [0, 1, 3],
      dir: [0, 1, 0],
      maxDistance: 10,
    });
    expect(upTube).not.toBeNull(); // the tube ceiling
    expect(upTube ? upTube.point[1] : -1).toBeCloseTo(3, 3); // underside at headroom
    const upOpen = physics.castRay(ctx, world, {
      origin: [20, 1, 3],
      dir: [0, 1, 0],
      maxDistance: 10,
    });
    expect(upOpen).toBeNull(); // no ceiling on the open style
    const sideOpen = physics.castRay(ctx, world, {
      origin: [20, 0.5, 3],
      dir: [1, 0, 0],
      maxDistance: 10,
    });
    expect(sideOpen).not.toBeNull(); // the guardrail wall
    expect(sideOpen ? sideOpen.point[0] : -1).toBeCloseTo(21.1, 2); // inner face: w/2 − WALL_T = 1.1 out
    for (const r of realized) r.destroy();
    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "mouth collar: lintel blocks an upward cast, the opening passes a through cast",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const { boxes, door } = mouthCollar(
      {
        position: [0, 0, 0],
        facing: [0, 0, 1],
        width: 3.2,
        height: 3.2,
        kind: "tunnel-mouth",
      },
      {
        opening: { width: 2, height: 2.8 },
        envelope: { width: 4.2, height: 3.7 },
      },
    );
    const region: RegionData = {
      meshes: [],
      colliders: boxes.map((b) => ({
        shape: {
          cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] as [
            number,
            number,
            number,
          ],
        },
        position: b.center,
        ...(b.rotation ? { rotation: b.rotation } : {}),
      })),
      materials: [],
      connections: [door],
      instances: [],
      origin: [0, 0, 0],
      bounds: aabbOfBoxes(boxes),
      provenance: {
        generatorId: "dungeon",
        generatorVersion: GENERATOR_VERSION,
        theme: "cave",
        seed: "collar-probe",
      },
    };
    const realized = await realizeRegion(ctx, world, cache, region);
    physics.step(ctx, world, DT);
    const upUnderLintel = physics.castRay(ctx, world, {
      origin: [0, 1, -0.2],
      dir: [0, 1, 0],
      maxDistance: 10,
    });
    expect(upUnderLintel).not.toBeNull();
    expect(upUnderLintel ? upUnderLintel.point[1] : -1).toBeCloseTo(2.8, 2); // lintel underside
    const through = physics.castRay(ctx, world, {
      origin: [0, 1.4, -3],
      dir: [0, 0, 1],
      maxDistance: 6,
    });
    expect(through).toBeNull(); // the opening prism is clear end to end
    const intoJamb = physics.castRay(ctx, world, {
      origin: [0, 1, -0.2],
      dir: [1, 0, 0],
      maxDistance: 10,
    });
    expect(intoJamb).not.toBeNull();
    expect(intoJamb ? intoJamb.point[0] : -1).toBeCloseTo(1.0, 2); // jamb inner face
    for (const r of [realized]) r.destroy();
    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
