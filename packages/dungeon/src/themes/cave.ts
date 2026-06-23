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
const TUNNEL_R = 1.2; // tunnel radius (>= ~1m Nyquist) — GATE-TUNE
const HUB_HALF: Vec3 = [3.5, 2.5, 3.5]; // hub chamber half-extents — GATE-TUNE
const END_HALF: Vec3 = [2.5, 2.2, 2.5]; // branch-end chamber half-extents — GATE-TUNE
const FLOOR_Y = -2; // chamber floor world Y (relative to origin) — GATE-TUNE
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
type Branch = { end: Node; mouth: Vec3; dir: Vec3 };
type Graph = { hub: Node; branches: Branch[] };

/** Seeded graph: a hub + 2..3 branch-end nodes, each reached by one tunnel. */
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
    const cx = hub.center[0] + dir[0] * len;
    const cz = hub.center[2] + dir[2] * len;
    const end: Node = {
      center: [cx, FLOOR_Y + END_HALF[1], cz],
      half: END_HALF,
    };
    const mouth: Vec3 = [
      cx - dir[0] * END_HALF[0],
      FLOOR_Y,
      cz - dir[2] * END_HALF[2],
    ];
    branches.push({ end, mouth, dir });
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
  const parts: Field[] = [chamberField(graph.hub)];
  for (const b of graph.branches) {
    parts.push(chamberField(b.end));
    // tunnel from hub centre to branch-end centre (overlaps both → connected)
    parts.push(
      capsuleCavern(
        graph.hub.center[0],
        graph.hub.center[1],
        graph.hub.center[2],
        b.end.center[0],
        b.end.center[1],
        b.end.center[2],
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

/** Grid bounding the whole graph + a margin, snapped to CELL. */
function buildGrid(graph: Graph): GridConfig {
  const chambers = [graph.hub, ...graph.branches.map((b) => b.end)];
  const GRID_PAD = 2;
  const lo = (ax: 0 | 1 | 2): number =>
    Math.min(...chambers.map((n) => n.center[ax] - n.half[ax])) - GRID_PAD;
  const hi = (ax: 0 | 1 | 2): number =>
    Math.max(...chambers.map((n) => n.center[ax] + n.half[ax])) + GRID_PAD;
  const min: Vec3 = [
    Math.floor(lo(0) / CELL) * CELL,
    Math.floor((FLOOR_Y - 1) / CELL) * CELL,
    Math.floor(lo(2) / CELL) * CELL,
  ];
  const dims: [number, number, number] = [
    Math.ceil((hi(0) - min[0]) / CELL),
    Math.ceil((hi(1) - min[1]) / CELL),
    Math.ceil((hi(2) - min[2]) / CELL),
  ];
  return { min, cellSize: CELL, dims };
}

/** Branching cave region: a hub chamber connected to 2–3 branch-end chambers via
 *  smooth-union capsule tunnels, roughened by Y-tapered noise. Produces a mesh,
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
      height: END_HALF[1] * 2,
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
