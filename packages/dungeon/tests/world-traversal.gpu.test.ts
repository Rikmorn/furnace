// W1 Task 8 — THE PROBE. The slice's fail-fast reason to exist in this order: walk the
// player capsule cave A → tunnel → cave B on the FULL default-world collider set, built
// exactly as the game builds it (`loadWorld` against an IN-MEMORY bake, NOT a hand-picked
// subset — the 2.2.1 lesson: subset repros hide the seam wedge). It converts the
// region↔connector seam class into a hard headless assert: NO WEDGE/STALL, NO GHOST-LAUNCH,
// NO FALL-THROUGH — forward, reverse, and along both tunnel walls. It is WALK-IN, not
// drop-in: dropping a capsule rests it on top and hides the wedge, so this drives the real
// CharacterMover along the path across the two cave↔tunnel seams.
import { expect, test } from "bun:test";
import type { Context } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { type BakeFile, bakeWorld, type WorldManifest } from "../src/bake.ts";
import { CharacterMover } from "../src/char-move.ts";
import { MaterialCache } from "../src/realize.ts";
import type { Connection, Vec3 } from "../src/region.ts";
import { loadWorld } from "../src/world-loader.ts";
import { DEFAULT_WORLD } from "../src/world-spec.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const CAPSULE = { halfHeight: 0.6, radius: 0.3 };
const REST_OFFSET = CAPSULE.halfHeight + CAPSULE.radius; // capsule centre height when grounded
const SPEED = 3; // m/s — the game walk speed
const DT = 1 / 60;
const FRAME_STEP = SPEED * DT; // ≈0.05 m nominal horizontal advance per frame
const MAX_STALL_FRAMES = 45; // ~0.75 s of no horizontal progress = wedged
// Ghost-launch / teleport guards, split by axis: a HORIZONTAL single-frame jump over 0.3 m is a
// lateral teleport; a single-frame RISE over 0.55 m is a launch. The rise bar sits above one
// legitimate step-up (walkability STEP_HEIGHT 0.4, so a floor riser lands the capsule ≤~0.4 m
// higher in one frame) plus margin, so climbing organic terrain does not read as a launch, while
// a real voxel-ghost fling (metres) still trips it. Downward fall-through is caught by the minY
// floor envelope, so no separate descent bar is needed.
const MAX_FRAME_HORIZ = 0.3;
const MAX_FRAME_RISE = 0.55;
const SETTLE_FRAMES = 3; // ignore the first few frames while the spawn drops onto rest
const MAX_ITERS = 800; // ~13 s at 3 m/s — ample for the ~14 m centre-lane cave→tunnel→cave path
// Off-centre lanes cross the seam cleanly but then grind slowly through the cave's shovable
// dressing (no wedge — the stall guard never trips — just repeated shoves), so they need a
// larger budget to reach the far exit than the obstacle-free centre lane.
const WALL_HUG_ITERS = 1800;
const WALL_HUG_OFFSET = 0.55; // lateral offset (m): an off-axis lane that crosses both seams off-centre
const SPAWN_RISE = 0.1; // start a touch above rest so the first frame settles, not teleports

/** The manifest is the LAST file `bakeWorld` emits (crash-safety contract). */
const manifestOf = (files: BakeFile[]): WorldManifest =>
  JSON.parse(files[files.length - 1]?.contents as string) as WorldManifest;

/** A fetch stub over the baked file set (mirrors world-loader.gpu.test.ts): the worlds index
 *  we synthesize here, each baked path (leading-slash) → its contents, everything else → 404.
 *  JSON resolves as text; `.fmesh` bytes resolve as a fresh (never Shared) ArrayBuffer. */
function bakedFetchStub(files: BakeFile[]): typeof fetch {
  const byPath = new Map<string, string | Uint8Array>();
  for (const f of files) byPath.set(`/${f.path}`, f.contents);
  const index = JSON.stringify({ version: 1, default: "default" });
  const respond = (url: string): Response => {
    if (url === "/worlds/index.json") return new Response(index);
    const contents = byPath.get(url);
    if (contents === undefined)
      return new Response("Not found", { status: 404 });
    if (typeof contents === "string") return new Response(contents);
    return new Response(new Uint8Array(contents).buffer);
  };
  return ((input: RequestInfo | URL) =>
    Promise.resolve(
      respond(typeof input === "string" ? input : input.toString()),
    )) as unknown as typeof fetch;
}

/** Scalar advance of a point along a horizontal direction (its projection onto `dir`). */
const along = (p: Vec3, dir: Vec3): number => p[0] * dir[0] + p[2] * dir[2];

/** The tunnel's two placed portals + its axis, from the baked manifest. `a` is cave A's door
 *  (facing OUTWARD toward the tunnel), `b` is cave B's door; `dir = a.facing` is the cardinal
 *  tunnel axis pointing A → B. */
function tunnelPortals(manifest: WorldManifest): {
  a: Connection;
  b: Connection;
  dir: Vec3;
} {
  const c = manifest.connectors[0];
  if (!c) throw new Error("world-traversal: manifest has no connector");
  return { a: c.a, b: c.b, dir: [c.a.facing[0], c.a.facing[1], c.a.facing[2]] };
}

type WalkResult = {
  pos: Vec3;
  minY: number;
  maxY: number;
  advanced: number;
  frames: number;
};

/** Options describing one headless walk lane. */
type WalkOpts = {
  /** Where the capsule spawns (world). */
  start: Vec3;
  /** Unit horizontal direction the capsule walks. */
  dir: Vec3;
  /** `pos·dir` past which the lane stops early (well beyond the target, so per-frame asserts
   *  cover the whole seam without walking into a far wall). */
  stopAlong: number;
  /** Floor guard: `minY` must stay above this (no fall-through). */
  floorY: number;
  /** Ceiling guard: `maxY` must stay below this (no launch up). */
  ceilY: number;
  /** Iteration budget (default `MAX_ITERS`). Off-centre lanes grind slowly through the cave's
   *  shovable dressing, so they need a larger budget than the centre lanes. */
  maxIters?: number;
};

/** Drive the real `CharacterMover` along one lane on the loaded world, asserting EVERY frame:
 *  no wedge/stall (`stalls < MAX_STALL_FRAMES`), no ghost-launch/teleport (single-frame
 *  displacement `< MAX_FRAME_DISP`), no fall-through / launch in Y (`minY`/`maxY` bounds).
 *  Creates + destroys its own capsule body so lanes can share one loaded world. */
function runWalk(
  ctx: Context,
  world: physics.World,
  opts: WalkOpts,
): WalkResult {
  const { start, dir } = opts;
  let pos: Vec3 = [start[0], start[1], start[2]];
  const body = physics.createBody(ctx, world, {
    type: "kinematicPosition",
    shape: { capsule: CAPSULE },
    position: pos,
  });
  physics.step(ctx, world, DT); // one settle step before the measured walk
  const mover = new CharacterMover(CAPSULE, body);

  let minY = pos[1];
  let maxY = pos[1];
  let stalls = 0;
  let frames = 0;
  const iters = opts.maxIters ?? MAX_ITERS;
  for (let i = 0; i < iters; i++) {
    frames = i + 1;
    const prev = pos;
    pos = mover.resolve(
      ctx,
      world,
      pos,
      [dir[0] * FRAME_STEP, 0, dir[2] * FRAME_STEP],
      DT,
    ).pos;
    physics.setBodyNextKinematicTranslation(ctx, body, pos);
    physics.step(ctx, world, DT);

    const horizStep = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]);
    const rise = pos[1] - prev[1];
    if (i >= SETTLE_FRAMES) {
      expect(horizStep).toBeLessThan(MAX_FRAME_HORIZ); // (b) no horizontal teleport
      expect(rise).toBeLessThan(MAX_FRAME_RISE); // (b) no upward ghost-launch (step-ups OK)
    }
    minY = Math.min(minY, pos[1]);
    maxY = Math.max(maxY, pos[1]);
    expect(minY).toBeGreaterThan(opts.floorY); // (c) no fall-through
    expect(maxY).toBeLessThan(opts.ceilY); // (c) no launch up
    const progressed = horizStep > 0.005;
    stalls = progressed ? 0 : stalls + 1;
    expect(stalls).toBeLessThan(MAX_STALL_FRAMES); // (a) never wedged

    if (along(pos, dir) > opts.stopAlong) break;
  }
  physics.destroyBody(ctx, body);
  return { pos, minY, maxY, advanced: along(pos, dir), frames };
}

/** Build the FULL default-world collider set exactly as the game does — bake `DEFAULT_WORLD`
 *  in memory, stub fetch by path, `loadWorld` — then run `body` against it, restoring fetch
 *  and tearing down the GPU/physics resources afterwards. */
async function withLoadedWorld(
  run: (args: {
    ctx: Context;
    world: physics.World;
    manifest: WorldManifest;
    loaded: Awaited<ReturnType<typeof loadWorld>>;
  }) => void,
): Promise<void> {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const matCache = new MaterialCache(ctx);
  const files = bakeWorld(DEFAULT_WORLD);
  const manifest = manifestOf(files);
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = bakedFetchStub(files);
    const loaded = await loadWorld(ctx, world, matCache);
    globalThis.fetch = orig; // the walk casts against the world; no more fetches needed
    try {
      run({ ctx, world, manifest, loaded });
    } finally {
      loaded.destroy();
    }
  } finally {
    globalThis.fetch = orig;
    matCache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  }
}

// Probe (i): forward walk cave A → tunnel → cave B, from the game spawn.
test.skipIf(!bunWebGpuAvailable())(
  "forward walk cave A -> tunnel -> cave B: no wedge/launch/fall-through, enters cave B",
  async () => {
    await withLoadedWorld(({ ctx, world, manifest, loaded }) => {
      const { a, b, dir } = tunnelPortals(manifest);
      const bAlong = along(b.position, dir);
      const res = runWalk(ctx, world, {
        start: loaded.playerStart, // the baked game spawn (2 m inside cave A, on the axis)
        dir,
        stopAlong: bAlong + 4, // cave B's far side
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 4,
      });
      // ENTERED cave B: advanced past cave B's door along the axis.
      expect(res.advanced).toBeGreaterThan(bAlong + 2);
    });
  },
);

// Probe (ii): reverse walk cave B → cave A.
test.skipIf(!bunWebGpuAvailable())(
  "reverse walk cave B -> cave A: no wedge/launch/fall-through, enters cave A",
  async () => {
    await withLoadedWorld(({ ctx, world, manifest }) => {
      const { a, b, dir } = tunnelPortals(manifest);
      const revDir: Vec3 = [-dir[0], -dir[1], -dir[2]];
      // Spawn ~2 m inside cave B (along +dir past its door), raised to rest height.
      const start: Vec3 = [
        b.position[0] + dir[0] * 2,
        b.position[1] + REST_OFFSET + SPAWN_RISE,
        b.position[2] + dir[2] * 2,
      ];
      const aAlongRev = along(a.position, revDir); // cave A's door along the reverse axis
      const res = runWalk(ctx, world, {
        start,
        dir: revDir,
        stopAlong: aAlongRev + 4, // cave A's far side
        floorY: b.position[1] - 1,
        ceilY: b.position[1] + 4,
      });
      // ENTERED cave A: advanced past cave A's door along the reverse axis.
      expect(res.advanced).toBeGreaterThan(aAlongRev + 2);
    });
  },
);

// Probe (iii): wall-hug lanes — two forward walks offset ±WALL_HUG_OFFSET perpendicular to the
// axis, so the capsule crosses both connector↔region seams off-centre. Each lane runs in its
// OWN freshly-loaded world: the cave dressing is shovable, so a shared world would let one lane
// displace obstacles for the next, masking that lane's real path.
for (const sign of [1, -1]) {
  test.skipIf(!bunWebGpuAvailable())(
    `wall-hug lane (${sign > 0 ? "+" : "-"}) crosses both seams off-centre: no wedge/launch, reaches the cave B exit`,
    async () => {
      await withLoadedWorld(({ ctx, world, manifest, loaded }) => {
        const { a, b, dir } = tunnelPortals(manifest);
        const perp: Vec3 = [-dir[2], 0, dir[0]]; // unit perpendicular cardinal
        const bAlong = along(b.position, dir);
        const start: Vec3 = [
          loaded.playerStart[0] + perp[0] * WALL_HUG_OFFSET * sign,
          loaded.playerStart[1],
          loaded.playerStart[2] + perp[2] * WALL_HUG_OFFSET * sign,
        ];
        const res = runWalk(ctx, world, {
          start,
          dir,
          stopAlong: bAlong + 1, // just into cave B past the tunnel exit
          floorY: a.position[1] - 1,
          ceilY: a.position[1] + 4,
          maxIters: WALL_HUG_ITERS,
        });
        // Slid the full tunnel off-centre: reached the exit near cave B's door.
        expect(res.advanced).toBeGreaterThan(bAlong - 1);
      });
    },
  );
}
