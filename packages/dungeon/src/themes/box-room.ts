import type { ShapeDescriptor } from "@furnace/core/physics";
import type {
  Connection,
  RegionCollider,
  RegionMesh,
  Vec3,
} from "../region.ts";

/** Maximum auto-step height. Must match `STEP_HEIGHT` in `char-move.ts`. */
export const STEP_HEIGHT = 0.4;
/** Keep step rises strictly below `STEP_HEIGHT` to guarantee traversability. */
const STEP_MARGIN = 0.05;

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

/** Parameters for a rectangular room in local frame (floor top at y=0, centred on XZ). */
export type BoxRoomParams = {
  width: number;
  depth: number;
  height: number;
  wallThick: number;
  floorThick: number;
  door: DoorSpec;
};

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

  if (p.door.side !== side) {
    return [place(0, along, h, 0)];
  }

  const half = p.door.width / 2;
  const c = p.door.offset;
  const leftLen = along / 2 + c - half;
  const rightLen = along / 2 - c - half;
  const out: Box[] = [];
  if (leftLen > 1e-3) {
    out.push(place(-(along / 2) + leftLen / 2, leftLen, h, 0));
  }
  if (rightLen > 1e-3) {
    out.push(place(along / 2 - rightLen / 2, rightLen, h, 0));
  }
  const lintelH = h - p.door.height;
  if (lintelH > 1e-3) {
    out.push(place(c, p.door.width, lintelH, p.door.height));
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
 *  steps 0..i above it so the collider stack is solid. */
export function stepBoxes(
  top: number,
  frontZ: number,
  width: number,
  treadDepth: number,
): Box[] {
  const n = Math.ceil(top / (STEP_HEIGHT - STEP_MARGIN));
  const rise = top / n;
  const out: Box[] = [];
  for (let i = 0; i < n; i++) {
    const h = rise * (i + 1);
    out.push(
      makeBox(
        [0, h / 2, frontZ - i * treadDepth] as Vec3,
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

/** Build a rectangular room as boxes in local frame (floor top at y=0, centred on XZ).
 *  Extra feature boxes (pillars, platforms, steps) are appended via the `features` param.
 *  Returns local-frame mesh and collider arrays plus outward door connections.
 *  World placement is the caller's responsibility (compose.ts applies origin). */
export function boxRoom(
  p: BoxRoomParams,
  features: Box[],
): {
  meshes: RegionMesh[];
  colliders: RegionCollider[];
  connections: Connection[];
} {
  const boxes: Box[] = [
    ...slabBoxes(p),
    ...wallBoxes(p, "N"),
    ...wallBoxes(p, "S"),
    ...wallBoxes(p, "E"),
    ...wallBoxes(p, "W"),
    ...features,
  ];

  const facing = SIDE_FACING[p.door.side];
  const isZWall = p.door.side === "N" || p.door.side === "S";
  const doorPos: Vec3 = isZWall
    ? [
        p.door.offset,
        0,
        (facing[2] as number) * (p.depth / 2 + p.wallThick / 2),
      ]
    : [
        (facing[0] as number) * (p.width / 2 + p.wallThick / 2),
        0,
        p.door.offset,
      ];

  return {
    meshes: boxes.map(toMesh),
    colliders: boxes.map(toCollider),
    connections: [
      {
        position: doorPos,
        facing,
        width: p.door.width,
        height: p.door.height,
        kind: "door",
      },
    ],
  };
}

/** Parameters for a centred pillar grid. */
export type PillarGridParams = {
  width: number;
  depth: number;
  bay: number;
  section: number;
  door: DoorSpec;
};

/** Centred grid of pillar positions, culling any that fall inside the doorway walk
 *  corridor. Rooms are always generated with a centered, South-facing door (compose.ts
 *  rotates the placed room into world orientation), so the corridor runs along -Z from
 *  the door to room centre; the cull is correct only for that generation-frame convention.
 *  `door.side`/`door.offset` are not consulted here — adding direction-handling would be
 *  speculative and unused. */
export function pillarGrid(p: PillarGridParams): { x: number; z: number }[] {
  const margin = p.bay;
  const usableW = p.width - 2 * margin;
  const usableD = p.depth - 2 * margin;
  const cols = Math.max(0, Math.floor(usableW / p.bay) + 1);
  const rows = Math.max(0, Math.floor(usableD / p.bay) + 1);
  const corridorHalf = p.door.width / 2 + CAPSULE_R + p.section / 2;
  const out: { x: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -((cols - 1) * p.bay) / 2 + c * p.bay;
      const z = -((rows - 1) * p.bay) / 2 + r * p.bay;
      // Rooms are always generated with a centered, South-facing door (compose.ts rotates
      // the placed room into world orientation), so the walk corridor runs along -Z from
      // the door to room centre. This cull is correct only for that generation-frame
      // convention.
      const inDoorCorridor = Math.abs(x) < corridorHalf && z < 0;
      if (inDoorCorridor) continue;
      out.push({ x, z });
    }
  }
  return out;
}
