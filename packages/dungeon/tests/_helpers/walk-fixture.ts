// The v1 (region/theme `WorldSpec`) half of the GPU walk harness: the in-memory bake → stub
// fetch → `loadWorld` fixture that world-traversal.gpu.test.ts and the W2 interior / seam probes
// share, plus the off-centre lane budget those probes drive. `withLoadedWorld` bakes ANY
// `WorldSpec` (was DEFAULT_WORLD-only).
//
// The world-class-agnostic half — the capsule/lane constants, `bakedFetchStub`, `along`, and the
// `runWalk` drive loop — moved to `field-walk.ts`, which imports nothing from the v1 world path.
// The four names this file's own consumers need are re-exported below so a v1 probe still has a
// single import site.
import type { Context } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import {
  type BakeFile,
  bakeWorld,
  type WorldManifest,
} from "../../src/world/bake.ts";
import { MaterialCache } from "../../src/world/realize.ts";
import { loadWorld } from "../../src/world/world-loader.ts";
import type { WorldSpec } from "../../src/world/world-spec.ts";
import { bakedFetchStub } from "./field-walk.ts";
import { makeOffscreenCanvas } from "./gpu-fixture.ts";

export { along, REST_OFFSET, runWalk, SPAWN_RISE } from "./field-walk.ts";

// Off-centre lanes cross the seam cleanly but then grind slowly through the cave's shovable
// dressing (no wedge — the stall guard never trips — just repeated shoves), so they need a
// larger budget to reach the far exit than the obstacle-free centre lane.
export const WALL_HUG_ITERS = 1800;
export const WALL_HUG_OFFSET = 0.55; // lateral offset (m): an off-axis lane that crosses both seams off-centre

/** The manifest is the LAST file `bakeWorld` emits (crash-safety contract). */
export const manifestOf = (files: BakeFile[]): WorldManifest =>
  JSON.parse(files[files.length - 1]?.contents as string) as WorldManifest;

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
