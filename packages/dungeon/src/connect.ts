// packages/dungeon/src/connect.ts
import { mat4, quat, vec3 } from "@furnace/core/transform";
import { aabbOfBoxes, transformAabb } from "./aabb.ts";
import type {
  Connection,
  InstanceData,
  MaterialDescriptor,
  RegionCollider,
  RegionData,
  RegionMesh,
  Vec3,
} from "./region.ts";
import { GENERATOR_VERSION } from "./region.ts";
import { type Box, stepBoxes } from "./themes/box-room.ts";
import { SLOPE_LIMIT_RAD, STEP_HEIGHT, STEP_MARGIN } from "./walkability.ts";

/** A rigid placement: a yaw rotation about world-up, then a world translation. */
export type Placement = { yaw: number; translation: Vec3 };

/** Heading angle φ of a horizontal vector under the engine yaw convention
 *  (`Ry(θ)·[1,0,0] = [cosθ, 0, −sinθ]`), so `v = [cosφ, 0, −sinφ]`. */
function headingAngle(v: Vec3): number {
  return Math.atan2(-v[2], v[0]);
}

/** Rotate a Vec3 by yaw θ about world-up: `Ry(θ)·[x,y,z]`. */
function rotateY(v: Vec3, c: number, s: number): Vec3 {
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/** The yaw+height transform that seats portal B onto portal A: B's opening coincides with
 *  A's and B's outward facing becomes A's INWARD facing (−A.facing). Continuous yaw — the
 *  general case of the retired cardinal-snap. */
export function join(a: Connection, b: Connection): Placement {
  const target: Vec3 = [-a.facing[0], a.facing[1], -a.facing[2]];
  const yaw = headingAngle(target) - headingAngle(b.facing);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rb = rotateY(b.position, c, s);
  return {
    yaw,
    translation: [
      a.position[0] - rb[0],
      a.position[1] - rb[1],
      a.position[2] - rb[2],
    ],
  };
}

/** Apply a Placement to a whole region: positions rotated+translated, per-piece rotation
 *  composed with the placement yaw, connection facings rotated, instance transforms +
 *  placements transformed. Generalizes the retired compose.ts placeRoom for ANY yaw. */
export function placePiece(region: RegionData, place: Placement): RegionData {
  const { yaw, translation: t } = place;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const xf = (p: Vec3): Vec3 => {
    const r = rotateY(p, c, s);
    return [r[0] + t[0], r[1] + t[1], r[2] + t[2]];
  };
  const rotDir = (v: Vec3): Vec3 => rotateY(v, c, s);
  const qYaw = quat.fromAxisAngle(quat.create(), vec3.fromValues(0, 1, 0), yaw);
  const compose = (
    existing?: [number, number, number, number],
  ): [number, number, number, number] => {
    if (!existing)
      return [qYaw[0], qYaw[1], qYaw[2], qYaw[3]] as [
        number,
        number,
        number,
        number,
      ];
    const out = quat.multiply(
      quat.create(),
      qYaw,
      quat.fromValues(existing[0], existing[1], existing[2], existing[3]),
    );
    return [out[0], out[1], out[2], out[3]] as [number, number, number, number];
  };

  const meshes: RegionMesh[] = region.meshes.map((m) => ({
    ...m,
    position: xf(m.position),
    rotation: compose(m.rotation),
  }));
  const colliders: RegionCollider[] = region.colliders.map((col) => ({
    ...col,
    position: xf(col.position),
    rotation: compose(col.rotation),
  }));
  const connections: Connection[] = region.connections.map((cn) => ({
    ...cn,
    position: xf(cn.position),
    facing: rotDir(cn.facing),
  }));
  const placementMat = buildPlacementMat(c, s, t);
  const scratch = mat4.create();
  const instances = region.instances.map((g) => {
    const out = new Float32Array(g.transforms.length);
    for (let i = 0; i < g.transforms.length; i += 16) {
      mat4.multiply(scratch, placementMat, g.transforms.subarray(i, i + 16));
      out.set(scratch, i);
    }
    const placements = g.placements?.map(
      (p): InstanceData => ({
        ...p,
        position: xf(p.position),
        rotation: compose(p.rotation),
      }),
    );
    return { ...g, transforms: out, placements };
  });

  return {
    ...region,
    meshes,
    colliders,
    connections,
    instances,
    origin: xf(region.origin),
    bounds: transformAabb(region.bounds, yaw, t),
  };
}

/** Column-major `T(t)·Ry(θ)` mat4 (gl-matrix layout) for transforming instance matrices. */
function buildPlacementMat(c: number, s: number, t: Vec3): Float32Array {
  const m = mat4.create();
  m[0] = c;
  m[2] = -s; // column 0: Ry(θ)·X̂ = [cosθ, 0, −sinθ]
  m[8] = s;
  m[10] = c; // column 2: Ry(θ)·Ẑ = [sinθ, 0, cosθ]
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

/** The three connector shapes the router can emit between two portals. */
export type ConnectorKind = "corridor" | "ramp" | "stairs";

const FLAT_EPS = 0.05; // |Δh| below this → a flat corridor
const RAMP_MARGIN = (3 * Math.PI) / 180; // keep ramp pitch this far below the slope limit
const SEAM_OVERLAP = 0.6; // connector floor pokes past each portal by >= 1 cell (CELL 0.5)
const FLOOR_THICK = 0.3; // connector slab thickness (m), matches the retired vestibule
const SHOULDER = 0.4; // a little shoulder past the clear walking width on each side
const CONNECTOR_MATERIAL: MaterialDescriptor = {
  color: [0.5, 0.5, 0.52, 1],
  specular: [0.02, 0.02, 0.02, 8],
};

/** Pick the connector kind for a height delta over a horizontal run. */
export function chooseKind(dh: number, run: number): ConnectorKind {
  if (Math.abs(dh) <= FLAT_EPS) return "corridor";
  const pitch = Math.atan2(Math.abs(dh), Math.max(run, 1e-6));
  return pitch <= SLOPE_LIMIT_RAD - RAMP_MARGIN ? "ramp" : "stairs";
}

function boxToMesh(
  b: Box,
  rotation?: [number, number, number, number],
): RegionMesh {
  const mesh: RegionMesh = {
    geometry: { box: b.size },
    material: 0,
    position: b.center,
  };
  if (rotation) mesh.rotation = rotation;
  return mesh;
}

function boxToCollider(
  b: Box,
  rotation?: [number, number, number, number],
): RegionCollider {
  const collider: RegionCollider = {
    shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
    position: b.center,
  };
  if (rotation) collider.rotation = rotation;
  return collider;
}

/** A local-frame connector box, optionally rotated (the ramp case pitches about X). */
type ConnectorBox = Box & { rotation?: [number, number, number, number] };

/** Build the connector in LOCAL frame: it climbs +Z from local origin (the `from` portal)
 *  to local [0, dh, run] (the `to` portal). `width` is the clear walking width. The caller
 *  (`route`) yaw-aligns +Z to the real direction and translates to `from.position`. Also
 *  returns the raw `boxes` (with per-box rotation) so `route` can envelope them for `bounds`
 *  without re-deriving box extents from the baked meshes. */
function buildConnectorLocal(
  kind: ConnectorKind,
  width: number,
  dh: number,
  run: number,
): {
  meshes: RegionMesh[];
  colliders: RegionCollider[];
  boxes: ConnectorBox[];
} {
  const w = width + 2 * SHOULDER;
  if (kind === "corridor") {
    const len = run + 2 * SEAM_OVERLAP;
    const center: Vec3 = [0, -FLOOR_THICK / 2, run / 2];
    const box: Box = { center, size: [w, FLOOR_THICK, len] };
    return {
      meshes: [boxToMesh(box)],
      colliders: [boxToCollider(box)],
      boxes: [box],
    };
  }
  if (kind === "ramp") {
    const pitch = Math.atan2(dh, run);
    if (pitch > SLOPE_LIMIT_RAD - RAMP_MARGIN) {
      throw new Error(
        `route: forced ramp pitch ${(pitch * 180) / Math.PI}° exceeds the slope limit`,
      );
    }
    const rampLen = Math.hypot(dh, run) + 2 * SEAM_OVERLAP;
    const qPitch = quat.fromAxisAngle(
      quat.create(),
      vec3.fromValues(1, 0, 0),
      -pitch,
    );
    const rot = [qPitch[0], qPitch[1], qPitch[2], qPitch[3]] as [
      number,
      number,
      number,
      number,
    ];
    const upY = Math.cos(pitch);
    const upZ = -Math.sin(pitch);
    const center: Vec3 = [
      0,
      dh / 2 - (FLOOR_THICK / 2) * upY,
      run / 2 - (FLOOR_THICK / 2) * upZ,
    ];
    const box: Box = { center, size: [w, FLOOR_THICK, rampLen] };
    return {
      meshes: [boxToMesh(box, rot)],
      colliders: [boxToCollider(box, rot)],
      boxes: [{ ...box, rotation: rot }],
    };
  }
  // stairs: reuse box-room stepBoxes (climbs +Z from y=0, tallest at frontZ=run).
  const n = Math.ceil(Math.abs(dh) / (STEP_HEIGHT - STEP_MARGIN));
  const treadDepth = run / n;
  const boxes = stepBoxes(dh, run, w, treadDepth);
  return {
    meshes: boxes.map((b) => boxToMesh(b)),
    colliders: boxes.map((b) => boxToCollider(b)),
    boxes,
  };
}

/** A connector RegionData bridging two portals, walkable by construction. Auto-derives the
 *  kind from the geometry unless `opts.kind` forces it (setup-loud throw if a forced kind
 *  can't satisfy the walkability constraints). The connector floor spans the join and
 *  overlaps both endpoints by >= 1 cell. */
export function route(
  from: Connection,
  to: Connection,
  opts?: { kind?: ConnectorKind },
): RegionData {
  const dx = to.position[0] - from.position[0];
  const dz = to.position[2] - from.position[2];
  const run = Math.hypot(dx, dz);
  const dh = to.position[1] - from.position[1];
  const dir: Vec3 =
    run > 1e-6 ? [dx / run, 0, dz / run] : [from.facing[0], 0, from.facing[2]];
  const width = Math.max(from.width, to.width);
  const kind = opts?.kind ?? chooseKind(dh, run);
  const local = buildConnectorLocal(kind, width, dh, run);
  const yaw = Math.atan2(dir[0], dir[2]);
  const region: RegionData = {
    meshes: local.meshes,
    colliders: local.colliders,
    materials: [CONNECTOR_MATERIAL],
    connections: [],
    instances: [],
    origin: [0, 0, 0],
    bounds: aabbOfBoxes(local.boxes),
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "connector",
      seed: "connector",
    },
  };
  return placePiece(region, { yaw, translation: from.position });
}
