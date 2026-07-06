import type { ShapeDescriptor } from "@furnace/core/physics";
import { create as makeRng, type Rng } from "@furnace/core/rng";
import { aabbUnion } from "../aabb.ts";
import { mouthCap, mouthCollar } from "../built.ts";
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
  Aabb,
  Connection,
  InstanceGroup,
  MaterialDescriptor,
  RegionCollider,
  RegionData,
  RegionMesh,
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
// Tunnels route at floor height (axis Y) so the tube floor (axis − TUNNEL_R) lands at
// FLOOR_Y, continuous with the hub floor. Module-level (not local to buildField) so
// caveEnvelopes single-sources the same value for its bore slabs' vertical span.
const TUNNEL_Y = FLOOR_Y + TUNNEL_R;
// Compound-envelope claim padding: the voxelized shell (one CELL of quantization slop)
// plus the noise-displacement amplitude (the field's surface can bulge by up to
// NOISE_AMP in any direction away from the smooth-unioned math surface — see
// yTaperedNoiseDisplace) — the worst-case distance a carved feature's real geometry can
// reach beyond its nominal (HUB_HALF/TUNNEL_R) extent. BLOCK 2 (2026-07-04): caves claim
// their real carved footprint via compound `envelopes` instead of the whole-grid
// `bounds` (93–96% air), which over-claimed under placement Rule 1.
const SHELL_PAD = CELL + NOISE_AMP;

// Built-interface doctrine: every organic mouth grows a masonry collar presenting a
// standardized door-class portal, so heterogeneous cave↔room seams collapse to the
// proven built↔built case.
const DOOR_OPENING = { width: 2, height: 2.8 }; // standardized presented door — GATE-TUNE
const BORE_ENVELOPE = {
  width: 2 * TUNNEL_R + 2 * NOISE_AMP, // bore + noise: what the collar must mask
  // height adds 1×NOISE_AMP (not 2×): the y-tapered noise pins the floor and only
  // displaces the ceiling, so height spans a single (ceiling) rise, not two walls.
  height: 2 * TUNNEL_R + NOISE_AMP,
};
const MASONRY_MATERIAL: MaterialDescriptor = {
  color: [0.42, 0.42, 0.45, 1],
  specular: [0.02, 0.02, 0.02, 8],
};

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
    collision: "solid",
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

const ALL_DIRS: Vec3[] = [
  [1, 0, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, 0, -1],
];

/** Params for the `cave` theme. Absent `mouths`/`capped` (both) selects the LEGACY
 *  single-quadrant + hardcoded entrance path; either present selects the new
 *  free-cardinal path. See `cave`'s TSDoc for the full contract. */
export type CaveParams = RegionParams & {
  /** Usable (door-presenting) mouths, 1..4. Absent (with `capped` absent) = legacy path. */
  mouths?: number;
  /** Extra sealed bores (collar + plug, excluded from connections). Default 0. */
  capped?: number;
};

/** New-path graph builder: `total` bores fanned onto DISTINCT cardinals (all four, no
 *  quadrant restriction). PREFIX-STABLE by construction: the cardinal pool is shuffled
 *  once over ALL FOUR cardinals (the shuffle loop always runs `ALL_DIRS.length` times,
 *  regardless of `total`) and each bore's length draws from a stream keyed by its INDEX
 *  (`len${i}`, on the same parent rng — `Rng.derive` is a pure function of its label, so
 *  it doesn't matter how many bores are ultimately requested). So the same seed with a
 *  different `total` (or the same `total` split differently between usable/sealed by the
 *  caller) reproduces an identical bore prefix — capping a bore never reshuffles the
 *  others' geometry. */
function buildGraphN(rng: Rng, total: number): Graph {
  const hub: Node = { center: [0, FLOOR_Y + HUB_HALF[1], 0], half: HUB_HALF };
  const chosen = rng.derive("dirs");
  const pool: Vec3[] = [...ALL_DIRS];
  const order: Vec3[] = [];
  for (const _ of ALL_DIRS) {
    const idx = chosen.int(0, pool.length);
    order.push(pool[idx] as Vec3);
    pool.splice(idx, 1);
  }
  const branches: Branch[] = [];
  for (let i = 0; i < total; i++) {
    const dir = order[i] as Vec3;
    const len =
      BRANCH_LEN_MIN + rng.derive(`len${i}`).float() * BRANCH_LEN_RANGE;
    branches.push({
      mouth: [
        hub.center[0] + dir[0] * len,
        FLOOR_Y,
        hub.center[2] + dir[2] * len,
      ],
      dir,
    });
  }
  return { hub, branches };
}

// MIGRATION (until B2 Task 9): legacy +X/+Z quadrant path for the hand-authored world;
// delete once that world moves onto `buildGraphN`'s free-cardinal path.
/** Seeded graph: a hub + 2..3 tunnels, each ending at a mouth where a room attaches.
 *  Branches are tunnels only (no branch-end chamber): the attached room IS the branch
 *  destination, so a cave chamber there would duplicate the room's footprint and bury
 *  the cave's solid far wall inside the walkable room — the dead-end the composed
 *  walk-probe stalled against. The cave therefore tapers out at the mouth and the room
 *  extends beyond it. */
function buildGraphLegacy(rng: Rng): Graph {
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

function buildField(rng: Rng, graph: Graph, legacyEntrance: boolean): Field {
  // Route tunnels at floor height (axis Y = FLOOR_Y + TUNNEL_R) so the tube floor
  // (axis − TUNNEL_R) lands at FLOOR_Y, continuous with the hub floor (centre-height
  // routing left a ~1m floor hump the controller stalled on). The tunnel's far endpoint
  // overshoots the mouth by TUNNEL_OVERSHOOT so the bore is at full radius at the mouth
  // plane (the room attaches there) rather than tapering into the rounded capsule cap,
  // which would wall off the doorway. The overshoot cap lands just inside the room's
  // front, where the room's own floor/walls take over.
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
  // bore floor is continuous with the hub floor. // MIGRATION (until B2 Task 9): legacy-only.
  if (legacyEntrance) {
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

/** World-space AABB of a generation grid: the mesh's local vertices span
 *  `[grid.min, grid.min + grid.dims * grid.cellSize)`, and `realize.ts` positions the
 *  custom-geometry mesh at `origin` (`mesh.setPosition`) on top of those local
 *  coordinates — so the world envelope is the local grid extent offset by `origin`. */
function gridWorldBounds(grid: GridConfig, origin: Vec3): Aabb {
  return {
    min: [
      origin[0] + grid.min[0],
      origin[1] + grid.min[1],
      origin[2] + grid.min[2],
    ],
    max: [
      origin[0] + grid.min[0] + grid.dims[0] * grid.cellSize,
      origin[1] + grid.min[1] + grid.dims[1] * grid.cellSize,
      origin[2] + grid.min[2] + grid.dims[2] * grid.cellSize,
    ],
  };
}

/** BLOCK 2 (2026-07-04): the cave's compound placement claim — honest coverage of what
 *  is actually carved, in place of `bounds` (the whole-grid AABB, measured 93–96% air).
 *  Three box families, all padded by `SHELL_PAD` past their nominal (un-noised,
 *  un-voxelized) extent:
 *  - the **hub box**: `hub.center ± (hub.half + SHELL_PAD)`.
 *  - **one slab per bore** (`mouths` — every branch, PLUS the legacy hardcoded −Z
 *    entrance when present, since that is a real carved corridor too): from the hub
 *    centre to the grid face along the bore's cardinal direction (cross-section half =
 *    `TUNNEL_R + SHELL_PAD` around the perpendicular axis through the hub centre;
 *    vertical span = the grid bottom to `TUNNEL_Y + TUNNEL_R + SHELL_PAD`). Starting the
 *    along-axis span AT the hub centre (not the hub wall) deliberately overlaps the hub
 *    box generously across the hub/bore seam (where `smoothUnion`'s blend can lift the
 *    surface slightly past either shape's own boundary).
 *  - each **collar's own `bounds`** (already an honest per-collar envelope; plug boxes
 *    nest inside their collar's boxes, so no separate plug entry is needed).
 *  `bounds` is UNCHANGED (still the coarse conservative cover — it already contains all
 *  of this by construction, since it's a superset union of the same grid + collars). */
function caveEnvelopes(
  hub: Node,
  mouths: Connection[],
  gridBounds: Aabb,
  origin: Vec3,
  collarBounds: Aabb[],
): Aabb[] {
  const hubWorld: Vec3 = [
    origin[0] + hub.center[0],
    origin[1] + hub.center[1],
    origin[2] + hub.center[2],
  ];
  const hubBox: Aabb = {
    min: [
      hubWorld[0] - (hub.half[0] + SHELL_PAD),
      hubWorld[1] - (hub.half[1] + SHELL_PAD),
      hubWorld[2] - (hub.half[2] + SHELL_PAD),
    ],
    max: [
      hubWorld[0] + (hub.half[0] + SHELL_PAD),
      hubWorld[1] + (hub.half[1] + SHELL_PAD),
      hubWorld[2] + (hub.half[2] + SHELL_PAD),
    ],
  };
  const crossHalf = TUNNEL_R + SHELL_PAD;
  const yMin = gridBounds.min[1];
  const yMax = origin[1] + TUNNEL_Y + TUNNEL_R + SHELL_PAD;
  const boreSlabs: Aabb[] = mouths.map((m): Aabb => {
    // Bores are always cardinal: exactly one horizontal facing component is non-zero.
    const axis: 0 | 2 = m.facing[0] !== 0 ? 0 : 2;
    const other: 0 | 2 = axis === 0 ? 2 : 0;
    const sign = m.facing[axis];
    const face = sign > 0 ? gridBounds.max[axis] : gridBounds.min[axis];
    const min: Vec3 = [0, yMin, 0];
    const max: Vec3 = [0, yMax, 0];
    min[axis] = Math.min(hubWorld[axis], face);
    max[axis] = Math.max(hubWorld[axis], face);
    min[other] = hubWorld[other] - crossHalf;
    max[other] = hubWorld[other] + crossHalf;
    return { min, max };
  });
  return [hubBox, ...boreSlabs, ...collarBounds];
}

/** Everything cave() computes before meshing — shared by the full generator and the
 *  runtime proxy/dressing paths so the three cannot drift. Throws the same setup-loud
 *  validation as `cave` on an invalid new-path `mouths`/`capped`. */
function caveSkeleton(p: CaveParams): {
  graph: Graph;
  field: Field;
  grid: GridConfig;
  legacy: boolean;
} {
  const rng = makeRng(p.seed);
  const legacy = p.mouths === undefined && p.capped === undefined; // MIGRATION (until B2 Task 9)
  const mouths = p.mouths ?? 0;
  const capped = p.capped ?? 0;
  if (!legacy) {
    if (mouths < 1) throw new Error("cave: mouths must be >= 1");
    if (capped < 0 || mouths + capped > ALL_DIRS.length) {
      throw new Error(
        `cave: mouths + capped must fit the ${ALL_DIRS.length} distinct cardinals (got ${mouths}+${capped})`,
      );
    }
  }
  const graph = legacy
    ? buildGraphLegacy(rng.derive("graph"))
    : buildGraphN(rng.derive("graph"), mouths + capped);
  const field = buildField(rng, graph, legacy);
  const grid = buildGrid(graph);
  return { graph, field, grid, legacy };
}

/** The RAW organic mouths (bore-sized, pre-collar) plus the scatter keep-outs derived
 *  from them — extracted verbatim from cave() so the full generator and caveDressing
 *  compute identical keep-outs. Legacy prepends the hardcoded -Z entrance; the new path
 *  has no separate entrance (every mouth is a branch-style bore). */
function caveMouthData(
  graph: Graph,
  legacy: boolean,
  origin: Vec3,
): { rawMouths: Connection[]; keepOut: KeepOut[] } {
  const branchConnections: Connection[] = graph.branches.map(
    (b): Connection => ({
      position: [
        origin[0] + b.mouth[0],
        origin[1] + b.mouth[1],
        origin[2] + b.mouth[2],
      ],
      facing: b.dir,
      width: TUNNEL_R * 2,
      height: TUNNEL_R * 2,
      kind: "tunnel-mouth",
    }),
  );

  // The RAW organic mouths (bore-sized), before collaring. Keep-outs and collars both
  // derive from these same centres/facings. Legacy prepends the hardcoded -Z entrance;
  // the new path has no separate entrance — every mouth is a branch-style bore.
  let rawMouths: Connection[];
  if (legacy) {
    // Entrance: -Z mouth of the hub, where the area attaches to the authored level.
    // MIGRATION (until B2 Task 9): legacy-only.
    const entrance: Connection = {
      position: [origin[0], origin[1] + FLOOR_Y, origin[2] - HUB_HALF[2]],
      facing: [0, 0, -1],
      width: ENTRANCE_WIDTH,
      height: HUB_HALF[1] * 2,
      kind: "tunnel-mouth",
    };
    rawMouths = [entrance, ...branchConnections];
  } else {
    rawMouths = branchConnections;
  }

  // Scatter keep-outs: convert each WORLD connection centre back to the cave's
  // LOCAL frame (scatter samples the local mesh), with a generous radius so
  // doorways and tunnel mouths stay clear of decoration.
  const keepOut: KeepOut[] = rawMouths.map((c) => ({
    center: [
      c.position[0] - origin[0],
      c.position[1] - origin[1],
      c.position[2] - origin[2],
    ] as Vec3,
    radius: Math.max(c.width / 2, KEEPOUT_MIN_HALF_WIDTH) + KEEPOUT_PADDING,
  }));
  return { rawMouths, keepOut };
}

/** The field-derived voxel collision proxy + the world position to seat its body. Shared
 *  by cave() and the runtime caveProxy path so the meshed and meshless proxies cannot
 *  drift. */
function caveVoxels(
  field: Field,
  grid: GridConfig,
  origin: Vec3,
): { shape: ShapeDescriptor; position: Vec3 } {
  return {
    shape: {
      voxels: voxelsFromField(field, grid, [CELL, PROXY_VOXEL_Y, CELL]),
    },
    position: voxelProxyPosition(grid, origin),
  };
}

/** The scatter dressing: the wall material at index 0 plus the GPU-instanced decoration
 *  groups (each layer appends its material after the wall). Shared by cave() and the
 *  runtime caveDressing path — the `derive("scatter")` stream is state-independent (core
 *  rng.ts), so it reproduces from the seed alone regardless of the graph/field draws. */
function caveScatter(
  seed: string,
  mesh: MeshData,
  keepOut: KeepOut[],
  origin: Vec3,
): { instances: InstanceGroup[]; materials: MaterialDescriptor[] } {
  // Materials start with the wall material at index 0 (the mesh references it); each
  // scatter layer appends its material at index >= 1. Bake WORLD transforms (offset =
  // origin) so instances align with the mesh rendered at local+origin.
  const materials: MaterialDescriptor[] = [
    { color: MATERIAL_COLOR, specular: MATERIAL_SPECULAR },
  ];
  const instances = instanceGroupsFromLayers(
    meshSurface(mesh),
    SCATTER_LAYERS,
    makeRng(seed).derive("scatter"),
    keepOut,
    materials,
    origin,
  );
  return { instances, materials };
}

/** Branching cave region: a hub chamber with 2–4 smooth-union capsule tunnels fanning
 *  out to mouths where rooms attach (or where a masonry cap seals an unused mouth),
 *  roughened by Y-tapered noise. Produces the rock mesh, a voxel collision proxy, and —
 *  per the built-interface doctrine — a masonry COLLAR at every raw mouth: each collar's
 *  boxes are masonry meshes/cuboid colliders, and the region's `connections` are the
 *  USABLE collars' door-class portals at the collar mid-depth, so every cave seam
 *  collapses to the proven built↔built (door) case.
 *
 *  Two paths, selected by whether `mouths`/`capped` are given:
 *  - **New path** (either present): `mouths + capped` bores on DISTINCT cardinals, chosen
 *    from all four — the +X/+Z-only quadrant restriction was a property of the
 *    hand-authored world this theme originally served, not of the theme itself. Every
 *    bore is collared; the LAST `capped` collars are sealed with a `mouthCap` plug and
 *    excluded from `connections`. There is no separate hardcoded entrance bore on this
 *    path — every mouth is a branch-style bore.
 *  - **Legacy path** (both absent): byte-identical to the original single-quadrant
 *    (+X/+Z) + hardcoded -Z entrance behaviour.
 *    // MIGRATION (until B2 Task 9): kept only for the hand-authored world; delete once
 *    that world moves onto the new path.
 *
 *  PREFIX-STABILITY (new path): the cardinal pool is shuffled once over all four
 *  cardinals and per-bore rng streams are keyed by bore INDEX (not by the usable/sealed
 *  split), so the same seed with different `mouths`/`capped` counts sharing the same
 *  total produces an identical bore prefix — capping a bore never reshuffles the
 *  others' geometry.
 *
 * @throws if the new path's `mouths` is < 1, or `mouths + capped` exceeds the 4
 *   available cardinals. */
export function cave(p: CaveParams): RegionData {
  const { graph, field, grid, legacy } = caveSkeleton(p);
  const mouths = p.mouths ?? 0;
  const mesh = surfaceNets(field, grid);
  const { shape, position } = caveVoxels(field, grid, p.origin);

  const { rawMouths, keepOut } = caveMouthData(graph, legacy, p.origin);

  // Built-interface doctrine: grow a masonry collar at each raw mouth. Each presents a
  // standardized door-class portal at the collar mid-depth. On the new path, the LAST
  // `capped` collars are sealed (plugged, excluded from connections); legacy has none.
  const collars = rawMouths.map((m) =>
    mouthCollar(m, { opening: DOOR_OPENING, envelope: BORE_ENVELOPE }),
  );
  const usable = legacy ? collars : collars.slice(0, mouths);
  const sealed = legacy ? [] : collars.slice(mouths);

  const { instances, materials } = caveScatter(p.seed, mesh, keepOut, p.origin);

  // Append the masonry material (after scatter has appended its own materials) and bake
  // the collar sleeves + any seal plugs as box meshes + cuboid colliders. The collar/plug
  // boxes are authored in the caller (world) frame by `mouthCollar`/`mouthCap`, so they
  // need no origin offset here.
  const masonryIndex = materials.length;
  materials.push(MASONRY_MATERIAL);
  const plugBoxes = sealed.flatMap((cl) => mouthCap(cl.door).boxes);
  const boxes = [...collars.flatMap((cl) => cl.boxes), ...plugBoxes];
  const collarMeshes = boxes.map((b) => {
    const boxMesh: RegionMesh = {
      geometry: { box: b.size },
      material: masonryIndex,
      position: b.center,
    };
    if (b.rotation) boxMesh.rotation = b.rotation;
    return boxMesh;
  });
  const collarColliders = boxes.map((b) => {
    const col: RegionCollider = {
      shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
      position: b.center,
    };
    if (b.rotation) col.rotation = b.rotation;
    return col;
  });

  const gridBounds = gridWorldBounds(grid, p.origin);

  return {
    meshes: [
      { geometry: { custom: mesh }, material: 0, position: p.origin },
      ...collarMeshes,
    ],
    colliders: [{ shape, position }, ...collarColliders],
    materials,
    connections: usable.map((cl) => cl.door), // order preserved
    instances,
    origin: p.origin,
    bounds: collars.reduce((acc, cl) => aabbUnion(acc, cl.bounds), gridBounds),
    envelopes: caveEnvelopes(
      graph.hub,
      rawMouths,
      gridBounds,
      p.origin,
      collars.map((cl) => cl.bounds),
    ),
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "cave",
      seed: p.seed,
    },
  };
}

/** Field-derived voxel collision proxy WITHOUT meshing — the wing-loader's collision
 *  path (the `bakedCavernProxy` pattern generalized to the branching cave). Reproduces
 *  cave()'s `colliders[0]` (shape + body position) byte-for-byte from the seed/params
 *  alone, so a baked wing collides with exactly what it rendered.
 *
 * @throws if `p`'s new-path `mouths`/`capped` are invalid (same as {@link cave}). */
export function caveProxy(p: CaveParams): {
  shape: ShapeDescriptor;
  position: Vec3;
} {
  // Re-runs caveSkeleton, rebuilding and discarding the graph it doesn't need —
  // deliberate: single source of truth with cave() over micro-optimization (only paid
  // on the load-time runtime path). Do NOT split caveSkeleton to save the graph draw.
  const { field, grid } = caveSkeleton(p);
  return caveVoxels(field, grid, p.origin);
}

/** Scatter re-expansion from an ALREADY-DECODED render mesh — no field, no meshing.
 *  Sound because `rng.derive` is state-independent (core rng.ts): the `"scatter"` stream
 *  reproduces from the seed alone. Returns the wall material + scatter-appended materials
 *  (a strict prefix of cave()'s materials — cave() appends the masonry material AFTER),
 *  reproducing cave()'s `instances` byte-for-byte from the baked `.fmesh`.
 *
 * @throws if `p`'s new-path `mouths`/`capped` are invalid (same as {@link cave}). */
export function caveDressing(
  p: CaveParams,
  mesh: MeshData,
): { instances: InstanceGroup[]; materials: MaterialDescriptor[] } {
  // Re-runs caveSkeleton, rebuilding and discarding the field/grid it doesn't need —
  // deliberate: single source of truth with cave() over micro-optimization (only paid
  // on the load-time runtime path). Do NOT split caveSkeleton to save the field build.
  const { graph, legacy } = caveSkeleton(p);
  const { keepOut } = caveMouthData(graph, legacy, p.origin);
  return caveScatter(p.seed, mesh, keepOut, p.origin);
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
