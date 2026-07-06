// Slice 3.1 GATE ARTIFACT (spec §8): the full loop, headless and with teeth.
//   bakeWing (in-test) -> serve the file set through a fetch stub -> loadGeneratedWing
//   -> a CharacterMover WALKS the baked wing (room floor -> doorway -> connector) with no
//   fall-through and no wedge; PLUS dressing determinism (baked-load instanced group count
//   == live-generation instanced group count).
//
// The walk is the gate's teeth: it drives the REAL CharacterMover against the colliders the
// LOADER created (manifest cuboids + the cave voxel proxy regenerated from provenance), so
// a broken load (missing floor bodies) drops the capsule and fails `minY`. The mover harness
// (CAP/DT/spawn/walkPath/along) mirrors traversal.gpu.test.ts — same shapes, same thresholds.
import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { bakeWing } from "../src/bake.ts";
import { CharacterMover } from "../src/char-move.ts";
import { MaterialCache } from "../src/realize.ts";
import type { RegionCollider, RegionData } from "../src/region.ts";
import { buildWorld } from "../src/world.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

// The seed Task 4 verified places on attempt 0 at this config (bake.test.ts's seed): the
// wing is authored/cave/pillarHall/cave/pillarHall. NOT "bake-31-0".
const SEED = "bake-31-1";
const CFG = {
  sectors: [1, 1] as [number, number],
  targetRooms: 4,
  loopChance: 0,
};

const CAP = { halfHeight: 0.6, radius: 0.3 };
const DT = 1 / 60;
const SPEED = 3; // m/s walk speed, matching the game + traversal.gpu.test.ts
const MAX_STALL = 45; // ~0.75s of zero horizontal progress = a wedge (mirrors traversal)
const SPAWN_MARGIN = 0.1; // lift above the floor's top face so step-1 settles cleanly
const PROBE_DIST = 8; // horizontal clearance probe reach
const MIN_CLEAR = 3; // a spawn with less open room than this is too cramped to be a real walk
const MAX_WALK = 5; // cap the walk short of any far wall so a wall-stall never masquerades as a wedge
type V3 = [number, number, number];

/** Map one served entry to a Response: an unmapped path is a real 404; a string hit serves as
 *  text (docs/manifest, read via `.json()`); bytes serve as a body (`.fmesh`, read via
 *  `.arrayBuffer()` — a Response respects the Uint8Array's byteOffset/byteLength). */
function responseFor(hit: string | Uint8Array | undefined): Response {
  if (hit === undefined) return new Response(null, { status: 404 });
  if (typeof hit === "string") return new Response(hit);
  // Boundary cast: our `.fmesh` bytes are always ArrayBuffer-backed (encodeMeshBlob output),
  // but bun-types' BodyInit only accepts ArrayBuffer-backed views, not the wider
  // `Uint8Array<ArrayBufferLike>`. Passing the view directly respects its byteOffset/byteLength.
  return new Response(hit as BodyInit);
}

/** Serve a baked file set through globalThis.fetch. The loader fetches `/${path}` (leading
 *  slash) and checks `res.ok` on artifacts. Returns a restore() the caller runs in `finally`. */
function stubFetch(
  files: { path: string; contents: string | Uint8Array }[],
): () => void {
  const orig = globalThis.fetch;
  const map = new Map<string, string | Uint8Array>(
    files.map((f) => [`/${f.path}`, f.contents]),
  );
  globalThis.fetch = ((url: string | URL) =>
    Promise.resolve(
      responseFor(map.get(String(url))),
    )) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

/** The floor's [halfX, halfY, halfZ] if the collider is a cuboid; else null. */
function cuboidHalf(c: RegionCollider): V3 | null {
  return "cuboid" in c.shape ? (c.shape.cuboid as V3) : null;
}

/** A box-room region's floor: its lowest thin-Y cuboid (floor and ceiling share the thin-Y
 *  slab shape; the floor is the lower of the two). Throws setup-loud if the region has none. */
function floorCollider(region: RegionData): {
  collider: RegionCollider;
  half: V3;
} {
  const FLOOR_HALF_Y = 0.3; // slabs (floor/ceiling) are 0.15 half-Y; walls are ~2+ half-Y
  const slabs = region.colliders
    .map((c) => ({ collider: c, half: cuboidHalf(c) }))
    .filter(
      (s): s is { collider: RegionCollider; half: V3 } =>
        s.half !== null && s.half[1] < FLOOR_HALF_Y,
    );
  const floor = slabs.reduce<{ collider: RegionCollider; half: V3 } | null>(
    (lowest, s) =>
      lowest === null || s.collider.position[1] < lowest.collider.position[1]
        ? s
        : lowest,
    null,
  );
  if (!floor)
    throw new Error("wing-roundtrip: box room has no floor slab collider");
  return floor;
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

/** Walk the mover from `start` along unit `dir` for `frames` ticks, stepping the world each
 *  tick. Returns the end position, deepest Y (fall-through witness), and the longest run of
 *  consecutive no-progress frames (a wedge shows as a long stall run mid-floor). */
function walkPath(
  ctx: gpu.Context,
  world: physics.World,
  body: physics.Body,
  mover: CharacterMover,
  start: V3,
  dir: V3,
  frames: number,
): { end: V3; minY: number; maxStall: number } {
  let pos: V3 = [start[0], start[1], start[2]];
  let minY = pos[1];
  let stall = 0;
  let maxStall = 0;
  const move: V3 = [dir[0] * SPEED * DT, 0, dir[2] * SPEED * DT];
  for (let i = 0; i < frames; i++) {
    const prev = pos;
    pos = mover.resolve(ctx, world, pos, move, DT).pos;
    physics.setBodyNextKinematicTranslation(ctx, body, pos);
    physics.step(ctx, world, DT);
    minY = Math.min(minY, pos[1]);
    const advanced = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
    stall = advanced ? 0 : stall + 1;
    maxStall = Math.max(maxStall, stall);
  }
  return { end: pos, minY, maxStall };
}

/** Distance travelled along unit `dir` from `from` to `to`. */
function along(from: V3, to: V3, dir: V3): number {
  return (to[0] - from[0]) * dir[0] + (to[2] - from[2]) * dir[2];
}

/** Pick the most open of the four cardinal horizontal headings from `start`, so the walk
 *  runs into open floor (through a doorway into the connector) rather than dead-ending on a
 *  wall — a wall-stall would read as a wedge. Asserts the spawn is genuinely open (>MIN_CLEAR)
 *  so the walk can never be vacuous. */
function bestHeading(
  ctx: gpu.Context,
  world: physics.World,
  body: physics.Body,
  start: V3,
): { dir: V3; clear: number } {
  const dirs: V3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let best: { dir: V3; clear: number } = { dir: dirs[0] as V3, clear: -1 };
  for (const dir of dirs) {
    const hit = physics.castShape(ctx, world, {
      shape: { capsule: CAP },
      position: start,
      dir,
      maxDistance: PROBE_DIST,
      excludeBody: body,
    });
    const clear = hit ? hit.toi : PROBE_DIST;
    if (clear > best.clear) best = { dir, clear };
  }
  return best;
}

test.skipIf(!bunWebGpuAvailable())(
  "baked wing loads, collides, and dressing matches live generation",
  async () => {
    const { files } = bakeWing(SEED, CFG, {});
    const restore = stubFetch(files);
    let ctx: gpu.Context | null = null;
    let world: physics.World | null = null;
    try {
      const canvas = await makeOffscreenCanvas();
      ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
      world = await physics.createWorld(ctx, {
        gravity: [0, -9.81, 0],
        lengthUnit: 1,
      });
      const matCache = new MaterialCache(ctx);

      const { loadGeneratedWing } = await import("../src/wing-loader.ts");
      const wing = await loadGeneratedWing(ctx, world, matCache);
      expect(wing).not.toBeNull();

      // The same frozen world the bake serialized (bakeWing forces attempts:1 internally, so
      // this reproduces its layout byte-for-byte) — used to locate a floor + as the dressing
      // baseline. The LOADED colliders in `world` are these same world-frame cuboids.
      const live = buildWorld(SEED, { ...CFG, attempts: 1 }, {});
      const genRegions = live.layout.regions.filter(
        (r) => r.provenance.theme !== "authored",
      );

      // --- Dressing determinism: the loader re-expanded the same instanced groups the live
      // generation produced (same seed -> same scatter). Group count is the gate assertion.
      const liveGroups = genRegions
        .flatMap((r) => r.instances)
        .filter((g) => g.transforms.length > 0);
      // Non-vacuity guard: the equality below is the SOLE lost-scatter detector (the walk +
      // ray-grid can't catch dropped decoration), so 0 === 0 must not pass silently.
      expect(liveGroups.length).toBeGreaterThan(0);
      expect(wing?.instanced.length ?? 0).toBe(liveGroups.length);

      // --- WALK (the teeth): stand a capsule on a box-room floor and walk the most open
      // heading (through the doorway into the connector). All colliders under the capsule were
      // created by the LOADER; a broken load drops the capsule and fails `minY`.
      const room = genRegions.find((r) => r.provenance.theme === "pillarHall");
      if (!room)
        throw new Error("wing-roundtrip: no pillarHall room in the baked wing");
      const { collider: floor, half } = floorCollider(room);
      const floorTopY = floor.position[1] + half[1];
      const start: V3 = [
        floor.position[0],
        floorTopY + CAP.halfHeight + CAP.radius + SPAWN_MARGIN,
        floor.position[2],
      ];

      const { body, mover } = spawn(ctx, world, start);
      const { dir, clear } = bestHeading(ctx, world, body, start);
      // Guard against a vacuous walk: the spawn must have real room to move.
      expect(clear).toBeGreaterThan(MIN_CLEAR);
      // Walk short of the far wall so a wall-stall can never read as a wedge.
      const walkDist = Math.min(clear * 0.65, MAX_WALK);
      const frames = Math.round(walkDist / (SPEED * DT));
      const { end, minY, maxStall } = walkPath(
        ctx,
        world,
        body,
        mover,
        start,
        dir,
        frames,
      );

      // Teeth 1 — no wedge: never permanently stuck on walkable floor.
      expect(maxStall).toBeLessThan(MAX_STALL);
      // Teeth 2 — real traction: advanced meaningfully along the heading (a stuck-at-spawn
      // capsule fails; well below `walkDist` so friction/slide has margin).
      expect(along(start, end, dir)).toBeGreaterThan(1.5);
      // Teeth 3 — no fall-through: stayed on/near the floor (a dropped capsule sinks far below).
      expect(minY).toBeGreaterThan(floorTopY - 2);
      physics.destroyBody(ctx, body);

      // Belt-and-suspenders no-hole proof: a downward-ray grid over the central floor (inside
      // the room, below the ceiling, clear of walls/pillars) always hits the floor slab.
      const gx = floor.position[0];
      const gz = floor.position[2];
      const voids: string[] = [];
      for (let dx = -1.5; dx <= 1.5001; dx += 0.75)
        for (let dz = -1.5; dz <= 1.5001; dz += 0.75) {
          const hit = physics.castRay(ctx, world, {
            origin: [gx + dx, floorTopY + 1, gz + dz],
            dir: [0, -1, 0],
            maxDistance: 3,
          });
          if (hit === null || hit.point[1] < floorTopY - 0.5)
            voids.push(
              `(${(gx + dx).toFixed(1)},${(gz + dz).toFixed(1)})=${hit ? hit.point[1].toFixed(2) : "VOID"}`,
            );
        }
      expect(voids).toEqual([]);

      wing?.destroy();
    } finally {
      if (ctx && world) physics.destroyWorld(ctx, world);
      if (ctx) gpu.dispose(ctx);
      restore();
    }
  },
);
