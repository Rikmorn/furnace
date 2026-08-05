// The load-agnostic half of the GPU walk harness: the capsule/lane constants, the baked-file
// fetch stub, and the per-frame drive loop. Every walking test shares these so the forward-lane
// semantics (no wedge/stall, no teleport, no ghost-launch, no fall-through) stay byte-identical
// across all of them.
//
// Nothing here loads a world — a caller brings its own `loadWorld` call (or its own hand-built
// scene) and drives it through `runWalk`, so this file stays usable by tests that never touch
// the world loader at all.
import { expect } from "bun:test";
import type { BakedFile } from "@furnace/core/field";
import type { Context } from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../../src/agent/char-move.ts";
import type { Vec3 } from "../../src/world/region.ts";

export const CAPSULE = { halfHeight: 0.6, radius: 0.3 };
export const REST_OFFSET = CAPSULE.halfHeight + CAPSULE.radius; // capsule centre height when grounded
export const SPEED = 3; // m/s — the game walk speed
export const DT = 1 / 60;
export const FRAME_STEP = SPEED * DT; // ≈0.05 m nominal horizontal advance per frame
export const MAX_STALL_FRAMES = 45; // ~0.75 s of no horizontal progress = wedged
// Ghost-launch / teleport guards, split by axis: a HORIZONTAL single-frame jump over 0.3 m is a
// lateral teleport; a single-frame RISE over 0.55 m is a launch. The rise bar sits above one
// legitimate step-up (walkability STEP_HEIGHT 0.4, so a floor riser lands the capsule ≤~0.4 m
// higher in one frame) plus margin, so climbing organic terrain does not read as a launch, while
// a real voxel-ghost fling (metres) still trips it. Downward fall-through is caught by the minY
// floor envelope, so no separate descent bar is needed.
export const MAX_FRAME_HORIZ = 0.3;
export const MAX_FRAME_RISE = 0.55;
export const SETTLE_FRAMES = 3; // ignore the first few frames while the spawn drops onto rest
export const MAX_ITERS = 800; // ~13 s at 3 m/s — ample for the ~14 m centre-lane cave→tunnel→cave path
export const SPAWN_RISE = 0.1; // start a touch above rest so the first frame settles, not teleports

/** A fetch stub over the baked file set (mirrors world-loader.gpu.test.ts): the worlds index
 *  we synthesize here (its `default` = the baked world's name), each baked path (leading-slash)
 *  → its contents, everything else → 404. JSON resolves as text; `.fmesh` bytes resolve as a
 *  fresh (never Shared) ArrayBuffer. */
export function bakedFetchStub(
  files: BakedFile[],
  defaultWorld: string,
): typeof fetch {
  const byPath = new Map<string, string | Uint8Array>();
  for (const f of files) byPath.set(`/${f.path}`, f.contents);
  const index = JSON.stringify({ version: 1, default: defaultWorld });
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
export const along = (p: Vec3, dir: Vec3): number =>
  p[0] * dir[0] + p[2] * dir[2];

export type WalkResult = {
  pos: Vec3;
  minY: number;
  maxY: number;
  advanced: number;
  frames: number;
};

/** Options describing one headless walk lane. */
export type WalkOpts = {
  /** Where the capsule spawns (world). */
  start: Vec3;
  /** Unit horizontal direction the capsule walks. */
  dir: Vec3;
  /** `pos·dir` past which the lane stops early (well beyond the target, so per-frame asserts
   *  cover the whole seam without walking into a far wall). Omit for `expectStop` lanes (they
   *  drive the full budget) — defaults to no early break. */
  stopAlong?: number;
  /** Floor guard: `minY` must stay above this (no fall-through). */
  floorY: number;
  /** Ceiling guard: `maxY` must stay below this (no launch up). */
  ceilY: number;
  /** Iteration budget (default `MAX_ITERS`). Off-centre lanes grind slowly through the cave's
   *  shovable dressing, so they need a larger budget than the centre lanes. */
  maxIters?: number;
  /** A lane that walks straight INTO an obstacle SHOULD stall (the wall stopping it is the
   *  point). When set, `runWalk` drives the full `maxIters` budget WITHOUT the no-stall assert
   *  and ignores `stopAlong`; the per-frame teleport / ghost-launch / fall-through guards still
   *  hold. The caller asserts where the mover settled (`res.pos` / `res.advanced`). */
  expectStop?: boolean;
};

/** Drive the real `CharacterMover` along one lane on the loaded world, asserting EVERY frame:
 *  no wedge/stall (`stalls < MAX_STALL_FRAMES`), no teleport (single-frame horizontal step
 *  `< MAX_FRAME_HORIZ`), no upward ghost-launch (single-frame rise `< MAX_FRAME_RISE`, above one
 *  legitimate step-up), no fall-through / launch in Y (`minY`/`maxY` bounds). With
 *  `opts.expectStop`, the no-stall assert + the `stopAlong` early-break are skipped so a lane
 *  can walk into a wall and settle (the caller asserts the stop); the other guards still hold.
 *  Creates + destroys its own capsule body so lanes can share one loaded world. */
export function runWalk(
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
  // A per-frame guard's `expect` throws mid-walk; the `finally` guarantees the kinematic
  // body + collider are torn down so a failing lane never leaks a phantom into the shared
  // `world` (which a subsequent lane's shapecasts would then hit).
  try {
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
      // A lane walking INTO a wall legitimately stalls; expectStop lanes drive the full budget
      // and let the caller assert where the mover settled. Forward lanes keep the exact
      // no-stall + stopAlong-break semantics.
      if (!opts.expectStop) {
        const progressed = horizStep > 0.005;
        stalls = progressed ? 0 : stalls + 1;
        expect(stalls).toBeLessThan(MAX_STALL_FRAMES); // (a) never wedged

        if (opts.stopAlong !== undefined && along(pos, dir) > opts.stopAlong)
          break;
      }
    }
    return { pos, minY, maxY, advanced: along(pos, dir), frames };
  } finally {
    physics.destroyBody(ctx, body);
  }
}
