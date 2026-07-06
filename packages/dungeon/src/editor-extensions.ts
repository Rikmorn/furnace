// packages/dungeon/src/editor-extensions.ts
// The editor's project-first bundle entry for the dungeon (furnace.config.json →
// editor.extensions). No registry extensions today — the dungeon uses only core
// built-ins. The re-exports are the Epic 3 cockpit seam: they prove (and keep proving,
// via the editor-side bundling smoke test) that the dungeon's generator import graph
// is browser-bundlable from the dungeon root. Slice 3.1's cockpit-host protocol will
// consume these exports; until then the engine bundle may tree-shake them — the
// bundling proof, not the export surface, is this file's 3.0 job.

export {
  DEFAULT_LAYOUT_BUDGET,
  type LayoutBudget,
  layoutWorld,
} from "./layout.ts";
export { MaterialCache, realizeRegion } from "./realize.ts";
export { DEFAULT_TOPOLOGY, generateWorldGraph } from "./topology.ts";
export { buildWorld, buildWorldGraph, WORLD_SEED } from "./world.ts";
