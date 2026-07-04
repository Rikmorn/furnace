import type { ShapeDescriptor } from "@furnace/core/physics";
import type { Rng } from "@furnace/core/rng";
import { aabbOfBoxes } from "../aabb.ts";
import type {
  Aabb,
  Connection,
  InstanceGroup,
  MaterialDescriptor,
  RegionCollider,
  RegionMesh,
  ScatterLayerSpec,
  Vec3,
} from "../region.ts";
import {
  instanceGroupsFromLayers,
  type KeepOut,
  rectSurface,
} from "../scatter.ts";

export { STEP_HEIGHT } from "../walkability.ts";

import { stepCount } from "../walkability.ts";

/** Cardinal wall side. */
export type Side = "N" | "S" | "E" | "W";

/** Door opening specification for a single wall. */
export type DoorSpec = {
  side: Side;
  /** Lateral offset of the door centre from the wall's own centre. */
  offset: number;
  width: number;
  height: number;
};

/** Parameters for a rectangular room in local frame (floor top at y=0, centred on XZ).
 *  `doors` holds one or more openings, at most one per {@link Side} — a graph-shaped
 *  world needs rooms of degree > 1 (multiple connections in/out). */
export type BoxRoomParams = {
  width: number;
  depth: number;
  height: number;
  wallThick: number;
  floorThick: number;
  doors: DoorSpec[];
};

/** Validates a door list shared by `boxRoom` and `pillarGrid`: at least one door, and
 *  at most one door per cardinal side (a wall can't host two openings). Setup-loud —
 *  throws immediately rather than silently dropping a conflicting door. */
function validateDoors(doors: DoorSpec[], fnName: string): void {
  if (doors.length === 0) {
    throw new Error(`${fnName}: at least one door is required`);
  }
  const seen = new Set<Side>();
  for (const door of doors) {
    if (seen.has(door.side)) {
      throw new Error(
        `${fnName}: at most one door per side (duplicate "${door.side}")`,
      );
    }
    seen.add(door.side);
  }
}

/** A centre+size box (local frame). Exported so theme wrappers can assemble feature
 *  arrays (pillars/steps) for boxRoom. */
export type Box = { center: Vec3; size: Vec3 };

const CAPSULE_R = 0.3;

/** Outward-facing unit normals for each cardinal wall side. */
const SIDE_FACING: Record<Side, Vec3> = {
  N: [0, 0, 1],
  S: [0, 0, -1],
  E: [1, 0, 0],
  W: [-1, 0, 0],
};

function makeBox(center: Vec3, size: Vec3): Box {
  return { center, size };
}

/** Wall segments for one side, split around the doorway opening when present. */
function wallBoxes(p: BoxRoomParams, side: Side): Box[] {
  const { width: w, depth: d, height: h, wallThick: t } = p;
  const isZWall = side === "N" || side === "S";
  const along = isZWall ? w : d;
  const wallCoord = isZWall
    ? side === "N"
      ? d / 2 + t / 2
      : -d / 2 - t / 2
    : side === "E"
      ? w / 2 + t / 2
      : -w / 2 - t / 2;

  /** Place a wall segment: `centerAlong` along the wall axis, `len` wide, `height` tall. */
  const place = (
    centerAlong: number,
    len: number,
    segH: number,
    baseY: number,
  ): Box => {
    const cy = baseY + segH / 2;
    return isZWall
      ? makeBox([centerAlong, cy, wallCoord] as Vec3, [len, segH, t] as Vec3)
      : makeBox([wallCoord, cy, centerAlong] as Vec3, [t, segH, len] as Vec3);
  };

  const door = p.doors.find((candidate) => candidate.side === side);
  if (!door) {
    return [place(0, along, h, 0)];
  }

  const half = door.width / 2;
  const c = door.offset;
  const leftLen = along / 2 + c - half;
  const rightLen = along / 2 - c - half;
  const out: Box[] = [];
  if (leftLen > 1e-3) {
    out.push(place(-(along / 2) + leftLen / 2, leftLen, h, 0));
  }
  if (rightLen > 1e-3) {
    out.push(place(along / 2 - rightLen / 2, rightLen, h, 0));
  }
  const lintelH = h - door.height;
  if (lintelH > 1e-3) {
    out.push(place(c, door.width, lintelH, door.height));
  }
  return out;
}

/** Floor and ceiling slabs. Floor top sits at y=0; ceiling bottom at y=height. */
function slabBoxes(p: BoxRoomParams): Box[] {
  const { width: w, depth: d, height: h, floorThick: ft } = p;
  return [
    makeBox([0, -ft / 2, 0] as Vec3, [w, ft, d] as Vec3), // floor
    makeBox([0, h + ft / 2, 0] as Vec3, [w, ft, d] as Vec3), // ceiling
  ];
}

/** A square-section pillar, floor→ceiling. `section` is the full side length. */
export function pillarBox(
  x: number,
  z: number,
  height: number,
  section: number,
): Box {
  return makeBox(
    [x, height / 2, z] as Vec3,
    [section, height, section] as Vec3,
  );
}

/** A staircase climbing from y=0 to `top` along the +Z axis, each riser < `STEP_HEIGHT`.
 *  Each step is a cuboid whose top surface is at the cumulative height; step `i` supports
 *  steps 0..i above it so the collider stack is solid.
 *  Step 0 (shortest, one riser) sits at `frontZ - (n-1)*treadDepth` (bottom of staircase,
 *  farthest from the platform); step n-1 (tallest, at `top`) sits at `frontZ` (adjacent to
 *  the platform face). A player walking +Z therefore climbs one riser at a time. */
export function stepBoxes(
  top: number,
  frontZ: number,
  width: number,
  treadDepth: number,
): Box[] {
  const n = stepCount(top);
  const rise = top / n;
  const out: Box[] = [];
  for (let i = 0; i < n; i++) {
    const h = rise * (i + 1);
    out.push(
      makeBox(
        [0, h / 2, frontZ - (n - 1 - i) * treadDepth] as Vec3,
        [width, h, treadDepth] as Vec3,
      ),
    );
  }
  return out;
}

const toMesh = (b: Box): RegionMesh => ({
  geometry: { box: b.size },
  material: 0,
  position: b.center,
});

const toCollider = (b: Box): RegionCollider => ({
  shape: {
    cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2],
  } as ShapeDescriptor,
  position: b.center,
});

/** The outward-facing door `Connection` for one door of a `boxRoom` (position on the
 *  room's own wall, at wall-centre + half wall thickness beyond the room's footprint). */
function doorConnection(p: BoxRoomParams, door: DoorSpec): Connection {
  const facing = SIDE_FACING[door.side];
  const isZWall = door.side === "N" || door.side === "S";
  const position: Vec3 = isZWall
    ? [door.offset, 0, (facing[2] as number) * (p.depth / 2 + p.wallThick / 2)]
    : [(facing[0] as number) * (p.width / 2 + p.wallThick / 2), 0, door.offset];
  return {
    position,
    facing,
    width: door.width,
    height: door.height,
    kind: "door",
  };
}

/** Build a rectangular room as boxes in local frame (floor top at y=0, centred on XZ).
 *  Extra feature boxes (pillars, platforms, steps) are appended via the `features` param.
 *  Returns local-frame mesh and collider arrays plus one outward door connection per
 *  entry in `p.doors` (same order). World placement is the caller's responsibility
 *  (`layout.ts` applies it via `connect.ts placePiece`). Throws setup-loud if `p.doors`
 *  is empty or has more than one door on the same side (see {@link validateDoors}). */
export function boxRoom(
  p: BoxRoomParams,
  features: Box[],
): {
  meshes: RegionMesh[];
  colliders: RegionCollider[];
  connections: Connection[];
  bounds: Aabb;
} {
  validateDoors(p.doors, "boxRoom");
  const boxes: Box[] = [
    ...slabBoxes(p),
    ...wallBoxes(p, "N"),
    ...wallBoxes(p, "S"),
    ...wallBoxes(p, "E"),
    ...wallBoxes(p, "W"),
    ...features,
  ];

  return {
    meshes: boxes.map(toMesh),
    colliders: boxes.map(toCollider),
    connections: p.doors.map((door) => doorConnection(p, door)),
    bounds: aabbOfBoxes(boxes),
  };
}

/** Parameters for a centred pillar grid. */
export type PillarGridParams = {
  width: number;
  depth: number;
  bay: number;
  section: number;
  doors: DoorSpec[];
};

/** The walk-corridor half-width for one door: half the opening plus clearance for a
 *  capsule body plus half a pillar section, so a pillar never overlaps the doorway's
 *  walk-through path. */
function doorCorridorHalf(door: DoorSpec, section: number): number {
  return door.width / 2 + CAPSULE_R + section / 2;
}

/** Whether grid point `(x, z)` falls inside `door`'s walk corridor — the strip running
 *  from the door's own wall toward room centre, `doorCorridorHalf` wide, on the door's
 *  cardinal axis. */
function inDoorCorridor(
  x: number,
  z: number,
  door: DoorSpec,
  section: number,
): boolean {
  const half = doorCorridorHalf(door, section);
  switch (door.side) {
    case "S":
      return Math.abs(x - door.offset) < half && z < 0;
    case "N":
      return Math.abs(x - door.offset) < half && z > 0;
    case "E":
      return Math.abs(z - door.offset) < half && x > 0;
    case "W":
      return Math.abs(z - door.offset) < half && x < 0;
  }
}

/** Centred grid of pillar positions, culling any that fall inside the walk corridor of
 *  ANY door in `p.doors` — each door carves its own corridor from its wall toward room
 *  centre, on its own cardinal axis (see {@link inDoorCorridor}). Throws setup-loud on
 *  an invalid door list (see {@link validateDoors}). */
export function pillarGrid(p: PillarGridParams): { x: number; z: number }[] {
  validateDoors(p.doors, "pillarGrid");
  const margin = p.bay;
  const usableW = p.width - 2 * margin;
  const usableD = p.depth - 2 * margin;
  const cols = Math.max(0, Math.floor(usableW / p.bay) + 1);
  const rows = Math.max(0, Math.floor(usableD / p.bay) + 1);
  const out: { x: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -((cols - 1) * p.bay) / 2 + c * p.bay;
      const z = -((rows - 1) * p.bay) / 2 + r * p.bay;
      const blocked = p.doors.some((door) =>
        inDoorCorridor(x, z, door, p.section),
      );
      if (blocked) continue;
      out.push({ x, z });
    }
  }
  return out;
}

/** Box-room floor scatter layers: small rubble cubes plus a sparse emissive glow
 *  fungus (a little life). Shared by both box-room themes (pillarHall, greatHall). */
const ROOM_SCATTER_LAYERS: ScatterLayerSpec[] = [
  {
    name: "roomRubble",
    geometry: { primitive: "cube" },
    posture: "lit",
    material: { color: [0.4, 0.38, 0.34, 1], specular: [0.03, 0.03, 0.03, 10] },
    target: "floor",
    spacing: { min: 1.0, max: 1.0 },
    scale: { min: 0.1, max: 0.22 },
    tint: { rgb: [0.5, 0.46, 0.4], jitter: 0.12 },
  },
  {
    name: "roomGlow",
    geometry: { primitive: "sphere" },
    posture: "emissive",
    material: { color: [0.4, 1.4, 0.6, 1], specular: [0, 0, 0, 0] },
    target: "floor",
    spacing: { min: 2.5, max: 2.5 },
    scale: { min: 0.08, max: 0.16 },
    tint: { rgb: [0.5, 1.0, 0.6], jitter: 0.15 },
  },
  {
    name: "roomCrates",
    geometry: { primitive: "cube" },
    posture: "lit",
    material: { color: [0.45, 0.4, 0.35, 1], specular: [0.05, 0.05, 0.05, 16] },
    target: "floor",
    collision: "dynamic",
    spacing: { min: 1.5, max: 1.5 },
    scale: { min: 0.25, max: 0.35 },
    tint: { rgb: [0.5, 0.45, 0.38], jitter: 0.1 },
  },
];

/** Clearance around the door so the entrance stays walkable (m). */
const ROOM_DOOR_KEEPOUT_PAD = 1.0;

/** The door-keepout centre, on the room's floor rect edge under `door`'s own wall. */
function doorKeepOutCenter(door: DoorSpec, width: number, depth: number): Vec3 {
  switch (door.side) {
    case "S":
      return [door.offset, 0, -depth / 2];
    case "N":
      return [door.offset, 0, depth / 2];
    case "E":
      return [width / 2, 0, door.offset];
    case "W":
      return [-width / 2, 0, door.offset];
  }
}

/** Floor scatter for a box room (rubble + sparse glow) over the room floor rect in
 *  LOCAL frame (floor top y=0), keeping every door's corridor clear. `layout.ts`'s
 *  placement (via `connect.ts placePiece`) transforms the result into world. Appends
 *  layer materials to `materials`. */
export function roomFloorScatter(
  width: number,
  depth: number,
  doors: DoorSpec[],
  rng: Rng,
  materials: MaterialDescriptor[],
): InstanceGroup[] {
  const floor = rectSurface({
    minX: -width / 2,
    maxX: width / 2,
    z0: -depth / 2,
    z1: depth / 2,
    y: 0,
  });
  const keepOut: KeepOut[] = doors.map((door) => ({
    center: doorKeepOutCenter(door, width, depth),
    radius: door.width / 2 + ROOM_DOOR_KEEPOUT_PAD,
  }));
  return instanceGroupsFromLayers(
    floor,
    ROOM_SCATTER_LAYERS,
    rng,
    keepOut,
    materials,
  );
}
