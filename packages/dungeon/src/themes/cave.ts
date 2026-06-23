import type { ShapeDescriptor } from "@furnace/core/physics";
import { create as makeRng, type Rng } from "@furnace/core/rng";
import {
  boxCavern,
  capsuleCavern,
  type Field,
  smoothUnion,
  yTaperedNoiseDisplace,
} from "../field.ts";
import { voxelProxyPosition, voxelsFromField } from "../proxy.ts";
import type { Connection, RegionData, RegionParams, Vec3 } from "../region.ts";
import { type GridConfig, surfaceNets } from "../surface-nets.ts";

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
  // -Z is reserved for the cave entrance (where the area attaches to the authored level),
  // so branches fan only into +X / -X / +Z — this keeps the entrance the sole -Z mouth and
  // prevents a branch room from overlapping the entrance corridor.
  const DIRS: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
  ];
  const count = rng.int(2, 4); // 2 or 3 branches
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

  return {
    meshes: [{ geometry: { custom: mesh }, material: 0, position: p.origin }],
    colliders: [{ shape, position: voxelProxyPosition(grid, p.origin) }],
    materials: [{ color: MATERIAL_COLOR, specular: MATERIAL_SPECULAR }],
    connections: [entrance, ...branchConnections],
    origin: p.origin,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "cave",
      seed: p.seed,
    },
  };
}
