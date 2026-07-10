// packages/dungeon/src/editor-extensions.ts
// The editor's project-first bundle entry for the dungeon (furnace.config.json →
// editor.extensions). No registry extensions today — the dungeon uses only core
// built-ins. The re-exports are the Epic 3 cockpit seam: they prove (and keep proving,
// via the editor-side bundling smoke test) that the dungeon's generator import graph
// is browser-bundlable from the dungeon root. Slice 3.1's cockpit-host protocol will
// consume these exports; until then the engine bundle may tree-shake them — the
// bundling proof, not the export surface, is this file's 3.0 job.

export {
  type BakeFile,
  bakeWing as bake,
  DEFAULT_WING_NAME,
  WING_DIR,
  type WingManifest,
  type WingRegionEntry,
  wingDir,
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
