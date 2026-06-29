// packages/dungeon/src/connect.ts
import { mat4, quat, vec3 } from "@furnace/core/transform";
import type {
  Connection,
  InstanceData,
  RegionCollider,
  RegionData,
  RegionMesh,
  Vec3,
} from "./region.ts";

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
