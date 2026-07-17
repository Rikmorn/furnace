import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "field",
  blurb:
    "dig, paint, and masonry-fill ONE voxel field, then mesh + kit-skin it",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
  ],
  features: [
    "field.createFieldStore",
    "field.logApply",
    "field.meshChunkField",
    "field.skinChunkKit",
  ],
  notes: [
    "The world is ONE sparse chunked density field: a missing 16³ chunk reads as uniform solid rock, so an untouched world costs nothing. The only way it mutates is a brush op through the op log — here a dig sphere carves a cavern, a paint band retints a stripe of its wall moss, and a lattice-snapped box fill writes masonry (a kit class).",
    "The material table is pure DATA, declared inline in this demo: class 0 is always organic rock; masonry is a kit class carrying its KitStyle (piece colours, panel proudness, collar section). logApply validates each op against it — a kit-class fill must be a box on the 0.5 m lattice, so kit pieces stay grid-locked.",
    "Every logApply returns the set of dirty chunk keys. Rebuilding is per chunk: extractFieldAprons copies the 20³ sample window (both channels), meshChunkField runs Surface Nets over it and partitions the surface into per-class buckets (each drawn lit with its class colour — masonry's raw surface is its 'backing' mortar bucket), and skinChunkKit derives the kit pieces (panels, tiles, posts) drawn as ONE instanced mesh, tinted per piece with a deterministic variant jitter.",
    "Everything here is @furnace/core alone — the same store/ops/mesher/skinner the editor's field tools and the dungeon's baked-world loader consume. Undo, selections, smooth, hollow fills, and generator stamps are the same op log exercised further.",
  ],
  gaps: [
    "static rebuild at setup — the editor drives the same pipeline incrementally per stroke via a worker",
    "no collar pieces on show: they appear where a dig suppresses built kit cells (dig into the wall in the editor to see them)",
  ],
  order: 47,
} satisfies DemoHelp;
