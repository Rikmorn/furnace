// packages/dungeon/src/editor-extensions.ts
// The editor's project-first bundle entry for the dungeon (furnace.config.json →
// editor.extensions). No registry extensions today — the dungeon uses only core
// built-ins. The re-exports are the Epic 3 cockpit seam: they prove (and keep proving,
// via the editor-side bundling smoke test) that the dungeon's generator import graph
// is browser-bundlable from the dungeon root. Slice 3.1's cockpit-host protocol consumes
// the wing exports; the W1 world seam (runWorld/bakeWorldFiles + world types) is what the
// generation cockpit's WORLD flow consumes. The engine bundle may tree-shake unused exports.
import { type BakeFile, bakeWorld } from "./bake.ts";
import type { RegionData, Vec3 } from "./region.ts";
import { realizeWorldSpec } from "./world-build.ts";
import type { WorldSpec } from "./world-spec.ts";

export {
  type BakeFile,
  bakeWing as bake,
  DEFAULT_WING_NAME,
  WING_DIR,
  type WingManifest,
  type WingRegionEntry,
  // W1 world-bake surface (types the worker/panel narrow off the untyped bundle).
  type WorldConnectorEntry,
  type WorldManifest,
  type WorldRegionEntry,
  wingDir,
  worldDir,
} from "./bake.ts";
export { placePiece } from "./connect.ts";
export {
  DEFAULT_LAYOUT_BUDGET,
  type LayoutBudget,
  layoutWorld,
} from "./layout.ts";
export { MaterialCache, realizeRegion } from "./realize.ts";
export { themes } from "./region.ts";
export { caveDressing, caveProxy } from "./themes/cave.ts";
export { DEFAULT_TOPOLOGY, generateWorldGraph } from "./topology.ts";
export {
  buildWorld,
  buildWorldGraph,
  COCKPIT_BUDGET,
  COCKPIT_CONFIG,
  COCKPIT_ENVELOPE,
  type CockpitEnvelopeRow,
  WORLD_SEED,
  type WorldAttempt,
  worldAttempts,
} from "./world.ts";
// W1 world-spec surface: the template + validator the panel builds its spec from.
export {
  DEFAULT_WORLD,
  validateWorldSpec,
  type WorldSpec,
} from "./world-spec.ts";

/** The postMessage-friendly realized world the cockpit previews: the resolved spec plus
 *  every placed region + connector as `{ id, data }` arrays (the worker serializes the
 *  result, so the `RealizedWorld` Maps are flattened; `collectTransferables` still walks
 *  the mesh buffers under `data`). Mirrors how the wing flow streams its `layout` opaquely. */
export type RealizedWorldPayload = {
  spec: WorldSpec;
  regions: { id: string; data: RegionData }[];
  connectors: { id: string; data: RegionData }[];
  playerStart: Vec3;
  playerYaw: number;
};

/** Realize a world spec for the editor preview (Task 3's `realizeWorldSpec`, Map→array so
 *  the payload survives a worker postMessage). Deterministic — no search, no attempts. */
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

/** Bake a declarative world to a file set (Task 4's `bakeWorld`) — the worker uploads the
 *  result through the daemon's `generation.bake`. Thin wrapper keeping the seam symmetric
 *  with `bake` (wing). */
export function bakeWorldFiles(spec: WorldSpec, name: string): BakeFile[] {
  return bakeWorld(spec, name);
}
