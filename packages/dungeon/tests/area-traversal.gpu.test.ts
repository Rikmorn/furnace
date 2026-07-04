// Headless seam walk-probe. Builds the FULL placed world graph's collider set (cave
// voxels + connector cuboids + room cuboids) and WALKS the player capsule from inside
// the cave hub, out through a tunnel mouth, across the cave->connector->room seams, and
// into the room — asserting it never wedges, never falls through a seam, and actually
// enters the room. This converts the 2.2.1 gate-only seam class (curved-wall stall /
// floor stall / hall<->chamber fall-through) into a hard headless assert. It is
// WALK-IN, not drop-in: dropping a capsule rests it on top and hides the wedge, so this
// drives the real CharacterMover along a path.
import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/char-move.ts";
import { layoutWorld } from "../src/layout.ts";
import { LEVEL_BOXES } from "../src/level.ts";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import type { Connection, RegionData } from "../src/region.ts";
import { buildWorldGraph, WORLD_SEED } from "../src/world.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
const CAPSULE = { halfHeight: 0.6, radius: 0.3 };

test.skipIf(!bunWebGpuAvailable())(
  "player walks cave -> corridor -> room across a seam, no fall/stall",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const { regions, connectors } = layoutWorld(
      buildWorldGraph(WORLD_SEED),
      WORLD_SEED,
    );
    for (const r of [
      ...regions.filter((x) => x.provenance.theme !== "authored"),
      ...connectors,
    ])
      await realizeRegion(ctx, world, cache, r);

    const caveRegion = regions.find(
      (r) => r.provenance.theme === "cave",
    ) as RegionData;
    const mouth = (caveRegion.connections.find(
      (c) => c.kind === "door" && c.facing[0] === 1,
    ) ??
      caveRegion.connections.find(
        (c) => c.kind === "door" && c.facing[2] === 1,
      )) as Connection;

    // start just inside the cave hub (at its PLACED origin — layoutWorld no longer
    // guarantees the hub sits at world origin), walk toward the mouth
    const startY =
      mouth.position[1] + CAPSULE.halfHeight + CAPSULE.radius + 0.1;
    let pos: [number, number, number] = [
      caveRegion.origin[0],
      startY,
      caveRegion.origin[2],
    ];
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: pos,
    });
    physics.step(ctx, world, 1 / 60);
    const mover = new CharacterMover(CAPSULE, body);
    const dir = mouth.facing; // unit toward the mouth/room
    let minY = pos[1];
    let stalls = 0;
    for (let i = 0; i < 400; i++) {
      const prev = pos;
      pos = mover.resolve(
        ctx,
        world,
        pos,
        [(dir[0] * 3) / 60, 0, (dir[2] * 3) / 60],
        1 / 60,
      ).pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, 1 / 60);
      minY = Math.min(minY, pos[1]);
      const progressed = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
      stalls = progressed ? 0 : stalls + 1;
      expect(stalls).toBeLessThan(45); // never wedged for ~0.75s
    }
    // crossed past the mouth into the room (advanced well beyond the mouth along `dir`)
    const advanced = pos[0] * dir[0] + pos[2] * dir[2];
    const mouthAlong = mouth.position[0] * dir[0] + mouth.position[2] * dir[2];
    expect(advanced).toBeGreaterThan(mouthAlong + 2); // entered the room
    expect(minY).toBeGreaterThan(mouth.position[1] - 1); // never fell through the seam

    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

// --- Task 9: multi-level showcase (ramp climb + stairs + off-axis upper rooms) ---
// Two elevated rooms attach to the authored 2nd-chamber floor portals: a pillarHall up an
// authored->upperA climb and a pillarHall up a forced-stairs authored->upperB climb. These
// walk the CharacterMover up each climb on the FULL placed-world collider set, and assert
// it actually RISES (proving arbitrary-angle + multi-height joining via `route`) and never
// wedges. The upper rooms' footprints overlap the chamber walls at climb height, so — like
// connect.gpu.test.ts's `climb` helper — we break at the landing (the final sample is the
// climbed state) rather than walking deeper into the room and into a chamber wall.
const MAX_FRAMES = 700;
const STALL_LIMIT = 45; // never wedged for ~0.75 s
const WALK_SPEED = 3; // m/s
const DT = 1 / 60;

/** Build the world graph and lay it out (deterministic — matches what `climbUpper` and the
 *  descent test realize). Returns the per-node placements plus a by-id accessor for the
 *  placed regions, whose `connections` are WORLD-frame (the authored phantom is pinned at
 *  identity, so its connections read straight as world portals). */
function buildPlacedGraph() {
  const g = buildWorldGraph(WORLD_SEED);
  const { placements, regions } = layoutWorld(g, WORLD_SEED);
  const regionOf = (id: string): RegionData =>
    regions[g.nodes.findIndex((n) => n.id === id)] as RegionData;
  return { placements, regionOf };
}

/** The XZ heading, horizontal run, and height delta from a spawn portal `from` to a placed
 *  seat door `seat` — derives a climb/descent walk's direction + span from real geometry
 *  instead of hand-tuned constants. */
function climbParams(
  from: Connection,
  seat: Connection,
): { run: number; height: number; dir: [number, number, number] } {
  const dx = seat.position[0] - from.position[0];
  const dz = seat.position[2] - from.position[2];
  const run = Math.hypot(dx, dz);
  return {
    run,
    height: seat.position[1] - from.position[1],
    dir: [dx / run, 0, dz / run],
  };
}

/** Realize the authored chamber colliders + the FULL placed world graph, spawn the capsule
 *  on a floor portal at `from`, and walk it along `dir` up a climb of horizontal `run` to a
 *  room sitting `height` above. Returns whether it reached the landing (advanced past `run`
 *  AND rose well above spawn) plus the climb metrics. Callers derive from/dir/run/height from
 *  the PLACED graph portals (`buildPlacedGraph` + `climbParams`), so the walk targets the
 *  layout engine's real placement — no hand-tuned geometry. */
async function climbUpper(
  from: [number, number, number],
  dir: [number, number, number],
  run: number,
  height: number,
): Promise<{
  reachedTop: boolean;
  maxY: number;
  maxStall: number;
  startY: number;
}> {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const cache = new MaterialCache(ctx);
  for (const b of LEVEL_BOXES) {
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
      position: b.center,
    });
  }
  const { regions, connectors } = layoutWorld(
    buildWorldGraph(WORLD_SEED),
    WORLD_SEED,
  );
  const realized: Awaited<ReturnType<typeof realizeRegion>>[] = [];
  for (const r of [
    ...regions.filter((x) => x.provenance.theme !== "authored"),
    ...connectors,
  ]) {
    realized.push(await realizeRegion(ctx, world, cache, r));
  }

  const startY = CAPSULE.halfHeight + CAPSULE.radius + 0.2;
  let pos: [number, number, number] = [from[0], startY, from[2]];
  const body = physics.createBody(ctx, world, {
    type: "kinematicPosition",
    shape: { capsule: CAPSULE },
    position: pos,
  });
  physics.step(ctx, world, DT);
  const mover = new CharacterMover(CAPSULE, body);
  let maxStall = 0;
  let stall = 0;
  let maxY = pos[1];
  let reachedTop = false;
  for (let i = 0; i < MAX_FRAMES; i++) {
    const prev = pos;
    pos = mover.resolve(
      ctx,
      world,
      pos,
      [dir[0] * WALK_SPEED * DT, 0, dir[2] * WALK_SPEED * DT],
      DT,
    ).pos;
    physics.setBodyNextKinematicTranslation(ctx, body, pos);
    physics.step(ctx, world, DT);
    maxY = Math.max(maxY, pos[1]);
    const progressed = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
    stall = progressed ? 0 : stall + 1;
    maxStall = Math.max(maxStall, stall);
    // Reached the landing: advanced past the connector exit along `dir` AND risen well above
    // spawn. Break before walking deeper into the upper room (its footprint overlaps the
    // chamber walls at climb height).
    const advanced = (pos[0] - from[0]) * dir[0] + (pos[2] - from[2]) * dir[2];
    if (advanced >= run && pos[1] > startY + height * 0.5) {
      reachedTop = true;
      break;
    }
  }
  for (const r of realized) r.destroy();
  cache.destroy();
  physics.destroyWorld(ctx, world);
  gpu.dispose(ctx);
  return { reachedTop, maxY, maxStall, startY };
}

// upperA attaches to the authored chamber's floor portal 1 (UPPER_PORTAL_A) via a ramp
// (edge authored->upperA, heightDelta 10 — auto-routed to a single pitched slab since its
// ~47° pitch clears the 55° slope limit). Spawn on the portal, aim at upperA's placed seat
// door, and climb. Off-axis in general: the yaw comes out of layoutWorld, so from/dir/run/
// height are read from the placed portals, not hand-authored.
test.skipIf(!bunWebGpuAvailable())(
  "player climbs the ramp from the chamber floor up to upperA",
  async () => {
    const { regionOf } = buildPlacedGraph();
    const from = regionOf("authored").connections[1] as Connection; // UPPER_PORTAL_A
    const seat = regionOf("upperA").connections[0] as Connection; // placed climb-seat door
    const { run, height, dir } = climbParams(from, seat);
    const r = await climbUpper(from.position, dir, run, height);
    expect(r.reachedTop).toBe(true); // climbed the whole ramp, never fell off
    expect(r.maxY).toBeGreaterThan(r.startY + height * 0.6); // rose most of the ~10 m
    expect(r.maxStall).toBeLessThan(STALL_LIMIT);
  },
);

// upperB attaches to the authored chamber's floor portal 2 (UPPER_PORTAL_B) via a FORCED
// stairs climb (edge authored->upperB, heightDelta 17, kind:"stairs"). Same shape as the
// ramp climb — derive the walk from upperB's placed seat door (which layoutWorld seats at a
// yaw, so the heading is off-cardinal) and climb the whole flight.
test.skipIf(!bunWebGpuAvailable())(
  "player climbs the forced stairs from the chamber floor up to upperB",
  async () => {
    const { regionOf } = buildPlacedGraph();
    const from = regionOf("authored").connections[2] as Connection; // UPPER_PORTAL_B
    const seat = regionOf("upperB").connections[0] as Connection; // placed climb-seat door
    const { run, height, dir } = climbParams(from, seat);
    const r = await climbUpper(from.position, dir, run, height);
    expect(r.reachedTop).toBe(true);
    expect(r.maxY).toBeGreaterThan(r.startY + height * 0.6); // rose most of the ~17 m
    expect(r.maxStall).toBeLessThan(STALL_LIMIT);
  },
);

// THE WORLD-LEVEL LOOP DESCENT (§4 showcase): the two-hop descending cycle's first hop.
// upperA (elevated ~y10) drops through a forced descending-stairs connector (edge
// upperA->landing, heightDelta -10) into the ground-level `landing` room seated in the void
// east of the authored x=15 wall. Spawn INSIDE upperA at its loop door, walk toward
// landing's descent-seat door down the stairs, and assert a real ~10 m monotonic descent
// that arrives on the landing floor without wedging — end-to-end proof the layout engine's
// descending loop is walkable.
test.skipIf(!bunWebGpuAvailable())(
  "player descends the world-level loop stairs from upperA down to the ground landing",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    for (const b of LEVEL_BOXES) {
      physics.createBody(ctx, world, {
        type: "static",
        shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
        position: b.center,
      });
    }
    const g = buildWorldGraph(WORLD_SEED);
    const { placements, regions, connectors } = layoutWorld(g, WORLD_SEED);
    const realized: Awaited<ReturnType<typeof realizeRegion>>[] = [];
    for (const r of [
      ...regions.filter((x) => x.provenance.theme !== "authored"),
      ...connectors,
    ]) {
      realized.push(await realizeRegion(ctx, world, cache, r));
    }
    const idx = (id: string) => g.nodes.findIndex((n) => n.id === id);
    const upperA = regions[idx("upperA")] as RegionData;
    const landing = regions[idx("landing")] as RegionData;
    const loopDoor = upperA.connections[1] as Connection; // upperA's second (loop/descent) door
    const seat = landing.connections[0] as Connection; // landing's descent-seat door
    const floorY = placements.get("landing")?.translation[1] ?? 0; // ground level (~0)

    // Spawn ~1.5 m inside upperA at its loop door, resting on the elevated floor.
    const spawn: [number, number, number] = [
      loopDoor.position[0] - loopDoor.facing[0] * 1.5,
      loopDoor.position[1] + CAPSULE.halfHeight + CAPSULE.radius + 0.2,
      loopDoor.position[2] - loopDoor.facing[2] * 1.5,
    ];
    const { dir } = climbParams(loopDoor, seat); // XZ heading down the stairs toward landing

    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: spawn,
    });
    physics.step(ctx, world, DT);
    const mover = new CharacterMover(CAPSULE, body);

    const bmin = landing.bounds.min;
    const bmax = landing.bounds.max;
    const insideLanding = (
      p: [number, number, number],
      grow: number,
    ): boolean =>
      p[0] >= bmin[0] - grow &&
      p[0] <= bmax[0] + grow &&
      p[2] >= bmin[2] - grow &&
      p[2] <= bmax[2] + grow;

    let pos = spawn;
    let maxStall = 0;
    let stall = 0;
    let maxY = pos[1];
    let arrived = false;
    // The descent is long (~14 m run, 10 m drop over ~29 treads); give it a generous budget.
    // Break the instant the capsule is on the landing floor inside the room, so it does not
    // walk on into the far wall (a post-arrival stall that would mask the clean descent).
    for (let i = 0; i < 1000; i++) {
      const prev = pos;
      pos = mover.resolve(
        ctx,
        world,
        pos,
        [dir[0] * WALK_SPEED * DT, 0, dir[2] * WALK_SPEED * DT],
        DT,
      ).pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, DT);
      maxY = Math.max(maxY, pos[1]);
      const progressed = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
      stall = progressed ? 0 : stall + 1;
      maxStall = Math.max(maxStall, stall);
      if (insideLanding(pos, 0.5) && pos[1] <= floorY + 1.0) {
        arrived = true;
        break;
      }
    }

    expect(arrived).toBe(true); // reached the landing floor inside the room
    expect(spawn[1] - pos[1]).toBeGreaterThan(8); // genuinely dropped ~10 m
    expect(pos[1]).toBeLessThanOrEqual(floorY + 1.5); // arrived within ~1.5 m of the landing floor
    expect(maxY).toBeLessThanOrEqual(spawn[1] + 1); // monotonic-ish: never climbed above spawn
    expect(maxStall).toBeLessThan(STALL_LIMIT); // no wedge on the way down
    expect(insideLanding(pos, 1)).toBe(true); // ended within the landing's placed bounds

    for (const r of realized) r.destroy();
    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "player walks into greatHall and climbs onto the dais platform",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const { regions, connectors } = layoutWorld(
      buildWorldGraph(WORLD_SEED),
      WORLD_SEED,
    );
    for (const r of [
      ...regions.filter((x) => x.provenance.theme !== "authored"),
      ...connectors,
    ])
      await realizeRegion(ctx, world, cache, r);

    const caveRegion = regions.find(
      (r) => r.provenance.theme === "cave",
    ) as RegionData;
    const ghRegion = regions.find(
      (r) => r.provenance.theme === "greatHall",
    ) as RegionData;
    // The placed greatHall's door is its real entrance. The player walks from the cave hub
    // INTO the room — i.e. OPPOSITE the door's outward facing. (placePiece sets a placed
    // region's origin generically to xf(local origin), so we key off the door connection,
    // not origin, which also survives the Task-7 room gap.)
    const ghDoor = ghRegion.connections.find(
      (c) => c.kind === "door",
    ) as Connection;

    // capsule rest height on flat floor at mouth Y
    const flatFloorRestY =
      ghDoor.position[1] + CAPSULE.halfHeight + CAPSULE.radius;
    const startY = flatFloorRestY + 0.1;
    // start just inside the cave hub (at its PLACED origin) as in the first test above.
    let pos: [number, number, number] = [
      caveRegion.origin[0],
      startY,
      caveRegion.origin[2],
    ];
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: pos,
    });
    physics.step(ctx, world, 1 / 60);
    const mover = new CharacterMover(CAPSULE, body);
    // toward the room = opposite the door's outward facing
    const dir: [number, number, number] = [
      -ghDoor.facing[0],
      0,
      -ghDoor.facing[2],
    ];
    const mouthAlong =
      ghDoor.position[0] * dir[0] + ghDoor.position[2] * dir[2];
    // platTop ∈ [0.3, 0.8); 0.25 m is a robust threshold that any seed must reach
    const DAIS_RISE_THRESHOLD = 0.25;
    let minY = pos[1];
    let stalls = 0;
    let climbedDais = false;
    // greatHall depth up to ~31 m; walk at 3 m/s for 900 iterations (15 s) to
    // reach and climb onto the dais at the far end. Break early once the dais is
    // confirmed so the player does not continue into the far wall.
    for (let i = 0; i < 900; i++) {
      const prev = pos;
      pos = mover.resolve(
        ctx,
        world,
        pos,
        [(dir[0] * 3) / 60, 0, (dir[2] * 3) / 60],
        1 / 60,
      ).pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, 1 / 60);
      minY = Math.min(minY, pos[1]);
      const progressed = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
      stalls = progressed ? 0 : stalls + 1;
      expect(stalls).toBeLessThan(45); // never wedged for ~0.75s
      // stop as soon as we confirm the dais has been climbed — avoids walking into the far wall.
      // Guard with "past mouthAlong + 5" so cave/connector terrain variation cannot trigger this early.
      const depthNow = pos[0] * dir[0] + pos[2] * dir[2];
      if (
        depthNow > mouthAlong + 5 &&
        pos[1] > flatFloorRestY + DAIS_RISE_THRESHOLD
      ) {
        climbedDais = true;
        break;
      }
    }
    // entered the room (advanced past the mouth)
    const advanced = pos[0] * dir[0] + pos[2] * dir[2];
    expect(advanced).toBeGreaterThan(mouthAlong + 2);
    // climbed onto the dais: Y rose above flat-floor rest height
    expect(climbedDais).toBe(true);
    // never fell through the floor
    expect(minY).toBeGreaterThan(ghDoor.position[1] - 1);

    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
