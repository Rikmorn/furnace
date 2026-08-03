// packages/dungeon/src/editor-extensions.ts
// The editor's project-first bundle entry for the dungeon (furnace.config.json →
// editor.extensions). No registry extensions today — the dungeon uses only core
// built-ins. The re-exports prove (and keep proving, via the editor-side bundling smoke
// test) that the dungeon's generator import graph is browser-bundlable from the dungeon
// root. The engine bundle may tree-shake unused exports.
//
// WHAT THE EDITOR ACTUALLY CALLS OFF THIS MODULE, as of the F4.5 seal (2026-08-03): exactly
// ONE member, `analyzerVerify`, from `frontend/analyzer-worker.ts`, through a single
// structural boundary cast (`AnalyzerEngine`). The Epic 3 world seam this file was written
// for — runWorld/bakeWorldFiles worker-side, realizeRegion/MaterialCache/worldDir
// panel-side — HAS NO EDITOR CALLER: the generation cockpit that used it (preview host,
// World panel, generation worker) was deleted at F4.5a, and the dungeon's worlds are dug in
// the field editor now rather than assembled from region specs. Those exports stay because
// the bundling proof is worth keeping and because the world-spec path is still the dungeon's
// own; they are not a live editor contract, so do not treat a change to their shape as an
// editor-facing break. `docs/reference/editor-architecture.md` §3a records the same fact
// from the editor's side.
import { type BakeFile, bakeWorld } from "./bake.ts";
import type { RegionData, Vec3 } from "./region.ts";
import { realizeWorldSpec } from "./world-build.ts";
import type { WorldSpec } from "./world-spec.ts";

export {
  type BakeFile,
  // World-bake shapes. The bundle crosses the boundary untyped, so the editor mirrors
  // these structurally rather than importing them — they are what the mirrors track.
  type WorldConnectorEntry,
  type WorldManifest,
  type WorldRegionEntry,
  worldDir,
} from "./bake.ts";
export { MaterialCache, realizeRegion } from "./realize.ts";
export { caveDressing, caveProxy } from "./themes/cave.ts";
// Stage 2 of the walkability advisor. The analyzer worker calls `analyzerVerify` off this same
// untyped view of the module; it needs no GPU context (Task 4's headless physics context) and
// mutates nothing.
export {
  type AnalyzerVerifyOptions,
  analyzerVerify,
  type VerifyLane,
  type VerifyLaneOutcome,
  type VerifyOutcome,
  type VerifyReason,
  type VerifyVerdict,
} from "./walk-probe.ts";
/** The dungeon's agent profile (`catalog/agent.json`) — the argument core's `analyzeChunk` /
 *  `analyzeWorld` / `markUnreachable` are parameterized on, and the one `analyzerVerify` accepts. */
export { AGENT } from "./walkability.ts";
// World-spec surface: the dungeon's default world spec, and the validator that
// `realizeWorldSpec` itself runs over a spec before realizing it.
export {
  DEFAULT_WORLD,
  validateWorldSpec,
  type WorldSpec,
} from "./world-spec.ts";

/** The postMessage-friendly realized world the cockpit previews: the resolved spec plus
 *  every placed region + connector as `{ id, data }` arrays (the worker serializes the
 *  result, so the `RealizedWorld` Maps are flattened; `collectTransferables` still walks
 *  the mesh buffers under `data`). */
export type RealizedWorldPayload = {
  spec: WorldSpec;
  regions: { id: string; data: RegionData }[];
  connectors: { id: string; data: RegionData }[];
  playerStart: Vec3;
  playerYaw: number;
};

/** Realize a world spec for the editor preview (`realizeWorldSpec`, Map→array so the
 *  payload survives a worker postMessage). Deterministic — no search, no attempts. */
export function runWorld(spec: WorldSpec): RealizedWorldPayload {
  const realized = realizeWorldSpec(spec);
  return {
    spec: realized.spec,
    regions: [...realized.regions].map(([id, data]) => ({ id, data })),
    connectors: [...realized.connectors].map(([id, data]) => ({ id, data })),
    playerStart: realized.playerStart,
    playerYaw: realized.playerYaw,
  };
}

/** Bake a declarative world to a file set (`bakeWorld`) — the worker uploads the result
 *  through the daemon's `generation.bake`. Thin wrapper so the worker seam stays
 *  name-stable. */
export function bakeWorldFiles(spec: WorldSpec, name: string): BakeFile[] {
  return bakeWorld(spec, name);
}
