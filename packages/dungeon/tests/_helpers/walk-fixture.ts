// Shared GPU walk harness (W2 Task 10) — the constants, bake/fetch plumbing, per-frame
// drive loop, and world-loading fixture that world-traversal.gpu.test.ts and the W2 interior
// / seam probes share. Lifted VERBATIM from world-traversal.gpu.test.ts so the forward-lane
// semantics (no wedge/stall, no teleport, no ghost-launch, no fall-through) are byte-identical;
// `withLoadedWorld` is the one generalization — it now bakes ANY `WorldSpec` (was
// DEFAULT_WORLD-only) so a probe can load its own fixture world.
import { expect } from "bun:test";
import type { Context } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import {
  type BakeFile,
  bakeWorld,
  type WorldManifest,
} from "../../src/bake.ts";
import { CharacterMover } from "../../src/char-move.ts";
import { MaterialCache } from "../../src/realize.ts";
import type { Vec3 } from "../../src/region.ts";
import { loadWorld } from "../../src/world-loader.ts";
import type { WorldSpec } from "../../src/world-spec.ts";
import { makeOffscreenCanvas } from "./gpu-fixture.ts";

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
// Off-centre lanes cross the seam cleanly but then grind slowly through the cave's shovable
// dressing (no wedge — the stall guard never trips — just repeated shoves), so they need a
// larger budget to reach the far exit than the obstacle-free centre lane.
export const WALL_HUG_ITERS = 1800;
export const WALL_HUG_OFFSET = 0.55; // lateral offset (m): an off-axis lane that crosses both seams off-centre
export const SPAWN_RISE = 0.1; // start a touch above rest so the first frame settles, not teleports

/** The manifest is the LAST file `bakeWorld` emits (crash-safety contract). */
export const manifestOf = (files: BakeFile[]): WorldManifest =>
  JSON.parse(files[files.length - 1]?.contents as string) as WorldManifest;

/** A fetch stub over the baked file set (mirrors world-loader.gpu.test.ts): the worlds index
 *  we synthesize here (its `default` = the baked world's name), each baked path (leading-slash)
 *  → its contents, everything else → 404. JSON resolves as text; `.fmesh` bytes resolve as a
 *  fresh (never Shared) ArrayBuffer. */
export function bakedFetchStub(
  files: BakeFile[],
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
 *  no wedge/stall (`stalls < MAX_STALL_FRAMES`), no teleport (single-frame horizontal step
 *  `< MAX_FRAME_HORIZ`), no upward ghost-launch (single-frame rise `< MAX_FRAME_RISE`, above one
 *  legitimate step-up), no fall-through / launch in Y (`minY`/`maxY` bounds).
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

/** Build the FULL collider set for `spec` exactly as the game does — bake it in memory, stub
 *  fetch by path (index `default` = the world's name), `loadWorld` — then run `body` against
 *  it, restoring fetch and tearing down the GPU/physics resources afterwards. */
export async function withLoadedWorld(
  spec: WorldSpec,
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
  const files = bakeWorld(spec);
  const manifest = manifestOf(files);
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = bakedFetchStub(files, spec.name);
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
