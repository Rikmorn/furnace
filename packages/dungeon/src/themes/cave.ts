import type { ShapeDescriptor } from "@furnace/core/physics";
import { create as makeRng, type Rng } from "@furnace/core/rng";
import {
  boxCavern,
  capsuleCavern,
  type Field,
  noiseDisplace,
  smoothUnion,
  yTaperedNoiseDisplace,
} from "../field.ts";
import { voxelProxyPosition, voxelsFromField } from "../proxy.ts";
import type {
  Connection,
  MaterialDescriptor,
  RegionData,
  RegionParams,
  ScatterLayerSpec,
  Vec3,
} from "../region.ts";
import {
  instanceGroupsFromLayers,
  type KeepOut,
  meshSurface,
} from "../scatter.ts";
import {
  type GridConfig,
  type MeshData,
  surfaceNets,
} from "../surface-nets.ts";

const CELL = 0.5; // grid cell size (m)
const PROXY_VOXEL_Y = 0.25; // anisotropic-Y voxel height (< STEP_HEIGHT 0.4) — GATE-TUNE
const BLEND = 0.8; // smooth-union k (>= CELL, research §1) — GATE-TUNE
const TUNNEL_R = 1.6; // tunnel radius (>= ~1m Nyquist; sized for capsule + step-up headroom) — GATE-TUNE
const TUNNEL_OVERSHOOT = 6; // metres the tube axis extends past the mouth so its rounded cap lands well outside the grid (> TUNNEL_R + GRID_PAD past the mouth) — the bore stays full-radius across the room seam — GATE-TUNE
const HUB_HALF: Vec3 = [3.5, 2.5, 3.5]; // hub chamber half-extents — GATE-TUNE
const FLOOR_Y = -2; // chamber floor world Y (relative to origin) — GATE-TUNE
const GRID_PAD = 2; // metres of empty-cell margin around the cave on every side — GATE-TUNE
const BRANCH_LEN_MIN = 6; // minimum branch length (m) — GATE-TUNE
const BRANCH_LEN_RANGE = 4; // branch length random range (m) — GATE-TUNE
const ENTRANCE_WIDTH = 3; // entrance passage clear-width (m) — GATE-TUNE
const NOISE_AMP = 0.5; // wall/ceiling roughening amplitude (m) — GATE-TUNE
const NOISE_FREQ = 0.4; // wall/ceiling roughening frequency — GATE-TUNE
const NOISE_FADE = 1.5; // metres above the floor over which noise fades in — GATE-TUNE
const MATERIAL_COLOR: [number, number, number, number] = [0.5, 0.5, 0.52, 1];
const MATERIAL_SPECULAR: [number, number, number, number] = [
  0.02, 0.02, 0.02, 8,
];
const KEEPOUT_MIN_HALF_WIDTH = 1; // floor for a connection's half-width keep-out radius (m) — GATE-TUNE
const KEEPOUT_PADDING = 0.6; // extra clearance added around every doorway/mouth (m) — GATE-TUNE

// Five scatter layers (2 lit + 3 emissive) spanning floor / wall / ceiling. The
// material colours, spacing, and scale are GATE-TUNABLE starting values.
const SCATTER_LAYERS: ScatterLayerSpec[] = [
  // 1. rubble — lit, floor, dense small cubes, earthy tint jitter
  {
    name: "rubble",
    geometry: { primitive: "cube" },
    posture: "lit",
    material: { color: [0.42, 0.36, 0.3, 1], specular: [0.02, 0.02, 0.02, 8] },
    target: "floor",
    spacing: { min: 0.6, max: 0.6 },
    scale: { min: 0.12, max: 0.28 },
    tint: { rgb: [0.55, 0.46, 0.36], jitter: 0.12 },
  },
  // 2. crystal spires — lit, floor, sparser, taller cylinders, cool tint
  {
    name: "spires",
    geometry: { primitive: "cylinder" },
    posture: "lit",
    material: { color: [0.5, 0.6, 0.72, 1], specular: [0.2, 0.2, 0.25, 24] },
    target: "floor",
    spacing: { min: 2.2, max: 2.2 },
    scale: { min: 0.3, max: 0.6 },
    tint: { rgb: [0.6, 0.7, 0.85], jitter: 0.1 },
  },
  // 3. glow fungus — emissive, floor, warm-green glow spheres (bright > 1 for bloom)
  {
    name: "fungus",
    geometry: { primitive: "sphere" },
    posture: "emissive",
    material: { color: [0.3, 1.6, 0.5, 1], specular: [0, 0, 0, 0] },
    target: "floor",
    spacing: { min: 1.1, max: 1.1 },
    scale: { min: 0.1, max: 0.22 },
    tint: { rgb: [0.4, 1.0, 0.5], jitter: 0.2 },
  },
  // 4. wall crystals — emissive, wall, blue/purple glow
  {
    name: "wallCrystals",
    geometry: { primitive: "cube" },
    posture: "emissive",
    material: { color: [0.5, 0.4, 1.7, 1], specular: [0, 0, 0, 0] },
    target: "wall",
    spacing: { min: 1.6, max: 1.6 },
    scale: { min: 0.1, max: 0.2 },
    tint: { rgb: [0.55, 0.45, 1.0], jitter: 0.15 },
  },
  // 5. glow-worms — emissive, CEILING (hangs down via orient + ceiling anchor),
  //    warm strands dangling ~0.3–0.55 m below the rock so they bloom clearly
  {
    name: "glowWorms",
    geometry: { primitive: "cylinder" },
    posture: "emissive",
    material: { color: [1.8, 1.3, 0.55, 1], specular: [0, 0, 0, 0] },
    target: "ceiling",
    spacing: { min: 1.6, max: 1.6 },
    scale: { min: 0.3, max: 0.55 },
    tint: { rgb: [1.0, 0.85, 0.4], jitter: 0.12 },
  },
];

type Node = { center: Vec3; half: Vec3 };
type Branch = { mouth: Vec3; dir: Vec3 };
type Graph = { hub: Node; branches: Branch[] };

/** Seeded graph: a hub + 2..3 tunnels, each ending at a mouth where a room attaches.
 *  Branches are tunnels only (no branch-end chamber): the attached room IS the branch
 *  destination, so a cave chamber there would duplicate the room's footprint and bury
 *  the cave's solid far wall inside the walkable room — the dead-end the composed
 *  walk-probe stalled against. The cave therefore tapers out at the mouth and the room
 *  extends beyond it. */
function buildGraph(rng: Rng): Graph {
  const hub: Node = { center: [0, FLOOR_Y + HUB_HALF[1], 0], half: HUB_HALF };
  // The wing attaches to the authored level on its -Z (entrance) and -X (the level
  // extends west of the attachment — corridor/main spine) sides, so branches fan only
  // into the OPEN quadrant +X / +Z. A -X or -Z branch would drive a room back into the
  // authored level (overlapping the spawn corridor → colliding geometry). Only two
  // cardinals are open here, so the wing carries two branches.
  const DIRS: Vec3[] = [
    [1, 0, 0],
    [0, 0, 1],
  ];
  const count = Math.min(rng.int(2, 4), DIRS.length); // branches, capped to open dirs
  const chosen = rng.derive("dirs");
  const pool: Vec3[] = [...DIRS];
  const branches: Branch[] = [];
  for (let i = 0; i < count; i++) {
    const idx = chosen.int(0, pool.length);
    const dir = pool[idx] as Vec3;
    pool.splice(idx, 1);
    const len =
      BRANCH_LEN_MIN + rng.derive(`len${i}`).float() * BRANCH_LEN_RANGE;
    const mouth: Vec3 = [
      hub.center[0] + dir[0] * len,
      FLOOR_Y,
      hub.center[2] + dir[2] * len,
    ];
    branches.push({ mouth, dir });
  }
  return { hub, branches };
}

function chamberField(n: Node): Field {
  return boxCavern(
    n.center[0],
    n.center[1],
    n.center[2],
    n.half[0],
    n.half[1],
    n.half[2],
  );
}

function buildField(rng: Rng, graph: Graph): Field {
  // Route tunnels at floor height (axis Y = FLOOR_Y + TUNNEL_R) so the tube floor
  // (axis − TUNNEL_R) lands at FLOOR_Y, continuous with the hub floor (centre-height
  // routing left a ~1m floor hump the controller stalled on). The tunnel's far endpoint
  // overshoots the mouth by TUNNEL_OVERSHOOT so the bore is at full radius at the mouth
  // plane (the room attaches there) rather than tapering into the rounded capsule cap,
  // which would wall off the doorway. The overshoot cap lands just inside the room's
  // front, where the room's own floor/walls take over.
  const TUNNEL_Y = FLOOR_Y + TUNNEL_R;
  const parts: Field[] = [chamberField(graph.hub)];
  for (const b of graph.branches) {
    const tipX = b.mouth[0] + b.dir[0] * TUNNEL_OVERSHOOT;
    const tipZ = b.mouth[2] + b.dir[2] * TUNNEL_OVERSHOOT;
    // tunnel from the hub centre out past the mouth at floor height (overlaps the hub → connected)
    parts.push(
      capsuleCavern(
        graph.hub.center[0],
        TUNNEL_Y,
        graph.hub.center[2],
        tipX,
        TUNNEL_Y,
        tipZ,
        TUNNEL_R,
      ),
    );
  }
  // Entrance bore: carve the hub's -Z wall so the cave is ENTERABLE from the authored level.
  // The entrance Connection alone is just metadata; without this the -Z wall is solid rock
  // (an invisible wall the player can't cross). Like a branch tunnel but toward -Z, no room —
  // it opens to the authored chamber through the cut doorway. Floor-routed (TUNNEL_Y) so the
  // bore floor is continuous with the hub floor.
  parts.push(
    capsuleCavern(
      graph.hub.center[0],
      TUNNEL_Y,
      graph.hub.center[2],
      graph.hub.center[0],
      TUNNEL_Y,
      graph.hub.center[2] - HUB_HALF[2] - TUNNEL_OVERSHOOT,
      TUNNEL_R,
    ),
  );
  const base = smoothUnion(BLEND, ...parts);
  return yTaperedNoiseDisplace(
    base,
    rng.derive("noise"),
    NOISE_AMP,
    NOISE_FREQ,
    FLOOR_Y,
    NOISE_FADE,
  );
}

/** Grid bounding the hub + every tunnel MOUTH (not the overshoot tip) + a margin,
 *  snapped to CELL. Bounding at the mouth — while the tunnel field overshoots past it —
 *  keeps the rounded capsule end-cap OUTSIDE the grid, so it is neither voxelized nor
 *  meshed: the cave ends at the mouth as an open bore (voxelsFromField's off-grid-as-solid
 *  shell rule closes no wall there) and leaves no rock dome inside the attached room. */
function buildGrid(graph: Graph): GridConfig {
  // XZ-only extents: the hub footprint + each tunnel-mouth bore cross-section. (Y is
  // bounded separately from the hub ceiling — these points all carry a placeholder y=0.)
  const pts: Vec3[] = [
    [graph.hub.center[0] - HUB_HALF[0], 0, graph.hub.center[2] - HUB_HALF[2]],
    [graph.hub.center[0] + HUB_HALF[0], 0, graph.hub.center[2] + HUB_HALF[2]],
    ...graph.branches.flatMap((b): Vec3[] => [
      [b.mouth[0] - TUNNEL_R, 0, b.mouth[2] - TUNNEL_R],
      [b.mouth[0] + TUNNEL_R, 0, b.mouth[2] + TUNNEL_R],
    ]),
  ];
  const loXZ = (ax: 0 | 2): number =>
    Math.min(...pts.map((p) => p[ax])) - GRID_PAD;
  const hiXZ = (ax: 0 | 2): number =>
    Math.max(...pts.map((p) => p[ax])) + GRID_PAD;
  // Y bounds span the floor (a metre below FLOOR_Y) up to the hub ceiling + pad, so the
  // tallest feature (the hub roof) is enclosed and meshes — the mouth-bore pts carry no
  // real Y, so deriving the Y-top from them would clip the hub ceiling out of the grid.
  const hiY = graph.hub.center[1] + HUB_HALF[1] + GRID_PAD;
  const min: Vec3 = [
    Math.floor(loXZ(0) / CELL) * CELL,
    Math.floor((FLOOR_Y - 1) / CELL) * CELL,
    Math.floor(loXZ(2) / CELL) * CELL,
  ];
  const dims: [number, number, number] = [
    Math.ceil((hiXZ(0) - min[0]) / CELL),
    Math.ceil((hiY - min[1]) / CELL),
    Math.ceil((hiXZ(2) - min[2]) / CELL),
  ];
  return { min, cellSize: CELL, dims };
}

/** Branching cave region: a hub chamber with 2–3 smooth-union capsule tunnels fanning
 *  out to mouths where rooms attach, roughened by Y-tapered noise. Produces a mesh,
 *  a voxel collision proxy, and a `Connection` for each tunnel mouth plus the
 *  entrance facing -Z (where the authored level attaches). */
export function cave(p: RegionParams): RegionData {
  const rng = makeRng(p.seed);
  const graph = buildGraph(rng.derive("graph"));
  const field = buildField(rng, graph);
  const grid = buildGrid(graph);
  const mesh = surfaceNets(field, grid);
  const vox = voxelsFromField(field, grid, [CELL, PROXY_VOXEL_Y, CELL]);
  const shape: ShapeDescriptor = { voxels: vox };

  const branchConnections: Connection[] = graph.branches.map(
    (b): Connection => ({
      position: [
        p.origin[0] + b.mouth[0],
        p.origin[1] + b.mouth[1],
        p.origin[2] + b.mouth[2],
      ],
      facing: b.dir,
      width: TUNNEL_R * 2,
      height: TUNNEL_R * 2,
      kind: "tunnel-mouth",
    }),
  );

  // Entrance: -Z mouth of the hub, where the area attaches to the authored level.
  const entrance: Connection = {
    position: [p.origin[0], p.origin[1] + FLOOR_Y, p.origin[2] - HUB_HALF[2]],
    facing: [0, 0, -1],
    width: ENTRANCE_WIDTH,
    height: HUB_HALF[1] * 2,
    kind: "tunnel-mouth",
  };

  // Scatter keep-outs: convert each WORLD connection centre back to the cave's
  // LOCAL frame (scatter samples the local mesh), with a generous radius so
  // doorways and tunnel mouths stay clear of decoration.
  const keepOut: KeepOut[] = [entrance, ...branchConnections].map((c) => ({
    center: [
      c.position[0] - p.origin[0],
      c.position[1] - p.origin[1],
      c.position[2] - p.origin[2],
    ] as Vec3,
    radius: Math.max(c.width / 2, KEEPOUT_MIN_HALF_WIDTH) + KEEPOUT_PADDING,
  }));
  // Materials start with the wall material at index 0 (the mesh references it);
  // each scatter layer appends its material at index >= 1. Bake WORLD transforms
  // (offset = origin) so instances align with the mesh rendered at local+origin.
  const materials: MaterialDescriptor[] = [
    { color: MATERIAL_COLOR, specular: MATERIAL_SPECULAR },
  ];
  const instances = instanceGroupsFromLayers(
    meshSurface(mesh),
    SCATTER_LAYERS,
    rng.derive("scatter"),
    keepOut,
    materials,
    p.origin,
  );

  return {
    meshes: [{ geometry: { custom: mesh }, material: 0, position: p.origin }],
    colliders: [{ shape, position: voxelProxyPosition(grid, p.origin) }],
    materials,
    connections: [entrance, ...branchConnections],
    instances,
    origin: p.origin,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "cave",
      seed: p.seed,
    },
  };
}

// The preserved single-kind cavern from the retired generator.ts: a rounded-box pit
// sized to the authored floor opening (world x[-2,2], z[-22,-26]). The grid/field/
// derive-label below are the SINGLE SOURCE for both the runtime collision proxy
// (`bakedCavernProxy`) and the baked render mesh (`bakeCavernMesh`, used by the
// throwaway scripts/bake-region.ts) — sharing them is the by-construction parity
// invariant: the `.fmesh` the player sees and the voxel proxy they collide with are
// derived from the exact same field, so they cannot drift.
const CAVERN_GRID: GridConfig = {
  min: [-5, -4, -5],
  cellSize: 0.5,
  dims: [20, 8, 20],
};
const CAVERN_PROXY_VOXEL_Y = 0.25; // anisotropic-Y, matches the branching-cave proxy

/** The shared baked-cavern density field: a rounded-box pit roughened by seeded noise. */
function bakedCavernField(seed: string): Field {
  const r = makeRng(seed);
  return noiseDisplace(
    boxCavern(0, 0, 0, 1.9, 2, 1.9),
    r.derive("geometry"),
    0.3,
    0.4,
  );
}

/** The preserved baked-cavern collision proxy. The cavern renders from a baked `.fmesh`
 *  (render-only scene) and collides against this field-derived voxel proxy regenerated at
 *  runtime — they must agree, so both derive from `bakedCavernField` over `CAVERN_GRID`.
 *
 * @param seed - The bake seed (`"cavern-1"` for the shipped cavern).
 * @param origin - World-space origin (XYZ) at which the cavern was baked.
 * @returns The voxel collision proxy and the world position to seat its body. */
export function bakedCavernProxy(
  seed: string,
  origin: Vec3,
): { proxy: ShapeDescriptor; proxyPosition: Vec3 } {
  const vox = voxelsFromField(bakedCavernField(seed), CAVERN_GRID, [
    CAVERN_GRID.cellSize,
    CAVERN_PROXY_VOXEL_Y,
    CAVERN_GRID.cellSize,
  ]);
  return {
    proxy: { voxels: vox },
    proxyPosition: voxelProxyPosition(CAVERN_GRID, origin),
  };
}

/** The preserved baked-cavern RENDER mesh (Surface-Nets over the same field/grid as
 *  `bakedCavernProxy`). Only the throwaway `scripts/bake-region.ts` calls this, to
 *  regenerate `regions/region-cavern.fmesh`; the live game loads that committed `.fmesh`.
 *
 * @param seed - The bake seed (`"cavern-1"` for the shipped cavern).
 * @returns The triangle mesh for the cavern grotto surface. */
export function bakeCavernMesh(seed: string): MeshData {
  return surfaceNets(bakedCavernField(seed), CAVERN_GRID);
}
