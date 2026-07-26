import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "field",
  blurb:
    "dig, paint, and masonry-fill ONE voxel field, then mesh, kit-skin, and walkability-flag it",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "c", action: "toggle the flag legend" },
    { key: "h", action: "toggle help" },
  ],
  features: [
    "field.createFieldStore",
    "field.logApply",
    "field.meshChunkField",
    "field.skinChunkKit",
    "field.analyzeChunk",
  ],
  notes: [
    "The world is ONE sparse chunked density field: a missing 16³ chunk reads as uniform solid rock, so an untouched world costs nothing. The only way it mutates is a brush op through the op log — here a dig sphere carves a cavern, a fill slab buries its bowl under a flat floor, a paint band retints a stripe of its wall moss, and a lattice-snapped box fill writes masonry (a kit class).",
    "The material table is pure DATA, declared inline in this demo: class 0 is always organic rock; masonry is a kit class carrying its KitStyle (piece colours, panel proudness, collar section). logApply validates each op against it — a kit-class fill must be a box on the 0.5 m lattice, so kit pieces stay grid-locked.",
    "Every logApply returns the set of dirty chunk keys. Rebuilding is per chunk: extractFieldAprons copies the 20³ sample window (both channels), meshChunkField runs Surface Nets over it and partitions the surface into per-class buckets (each drawn lit with its class colour — masonry's raw surface is its 'backing' mortar bucket), and skinChunkKit derives the kit pieces (panels, tiles, posts) drawn as ONE instanced mesh, tinted per piece with a deterministic variant jitter.",
    "The little cubes on the floor are WALKABILITY FLAGS. analyzeChunk sweeps ONE chunk's cells, keeps the ones a capsule could stand on (a floor surface with clearance of air above it), and reports what a mover would meet there. A flag is DATA — a kind, a severity, the anchor cell, the world point on the floor under it, the owning chunk — and nothing more: the pass reads the field, writes nothing, blocks no brush, and fixes nothing. It is advice, and the same store meshes identically with or without it. The legend panel [c] tallies exactly what this run produced.",
    "Severity is the point of the pit and the step dug into the flat floor. Both are drops in level ground; only the depth differs. The pit is 1.00 m — past the agent's 0.70 m climbCeiling — so from the bottom the rim is a `ledge` the mover cannot get back over: severity `candidate` (warm, large; shown by default because it is worth a look). The step is 0.50 m: above stepHeight 0.40 m, but within climbCeiling, so its rim is a `ledge` of severity `info` (cool, small; a band this mover is known to handle). Two more kinds turn up unasked — the pit's corners pinch the capsule on two sides (`narrow`), and where the flat floor runs into the curved cavern wall a one-cell lip has rock rising within capsule radius beyond it (`lip-near-wall`, the wedge conjunction). The masonry wall earns candidates of its own: a 2.75 m rise is a ledge like any other.",
    "The thresholds are an AgentProfile — the consuming project's capsule, its step and climb and headroom — passed in as data; core never hard-codes a game's mover. They resolve to CELLS asymmetrically on purpose: ceil on what the capsule REQUIRES, floor on what it is ALLOWED, so every threshold lands strictly tighter than the real mover and borderline geometry surfaces as a flag rather than being rounded away.",
    "Everything here is @furnace/core alone — the same store/ops/mesher/skinner/analyzer the editor's field tools and the dungeon's baked-world loader consume. Undo, selections, smooth, hollow fills, and generator stamps are the same op log exercised further.",
  ],
  gaps: [
    "static rebuild at setup — the editor drives the same pipeline incrementally per stroke via a worker",
    "no collar pieces on show: they appear where a dig suppresses built kit cells (dig into the wall in the editor to see them)",
    "one chunk analysed, not the world: analyzeWorld runs the same pass over every allocated chunk, and markUnreachable then demotes the flags no seed can walk to",
    "no props in the mix: voxelizePlacements rasterizes placement colliders into the same solidity so the analyzer sees what physics sees — this demo places none",
  ],
  order: 47,
} satisfies DemoHelp;
