// packages/dungeon/src/aabb.ts
import { quat, vec3 } from "@furnace/core/transform";
import type { Aabb, Vec3 } from "./region.ts";

/** Two AABBs count as intersecting only when they overlap by more than EPS on every
 *  axis — exact touching (shared planes) is legal placement. */
const EPS = 1e-3;

/** A center+size box in some local frame, optionally rotated. The shape `aabbOfBoxes`
 *  envelopes — box-room `Box`es and connector slabs both structurally match this. */
type CsBox = {
  center: Vec3;
  size: Vec3;
  rotation?: [number, number, number, number];
};

/** Envelope AABB of center+size boxes; a rotated box contributes its 8 rotated corners
 *  (a conservative axis-aligned cover, not a tight OBB fit). */
export function aabbOfBoxes(boxes: CsBox[]): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const b of boxes) {
    const hx = b.size[0] / 2;
    const hy = b.size[1] / 2;
    const hz = b.size[2] / 2;
    const q = b.rotation
      ? quat.fromValues(
          b.rotation[0],
          b.rotation[1],
          b.rotation[2],
          b.rotation[3],
        )
      : null;
    const p = vec3.create();
    for (let c = 0; c < 8; c++) {
      const lx = c & 1 ? hx : -hx;
      const ly = c & 2 ? hy : -hy;
      const lz = c & 4 ? hz : -hz;
      let wx: number;
      let wy: number;
      let wz: number;
      if (q) {
        vec3.set(p, lx, ly, lz);
        vec3.transformQuat(p, p, q);
        wx = (p[0] as number) + b.center[0];
        wy = (p[1] as number) + b.center[1];
        wz = (p[2] as number) + b.center[2];
      } else {
        wx = lx + b.center[0];
        wy = ly + b.center[1];
        wz = lz + b.center[2];
      }
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Union of two AABBs. */
export function aabbUnion(a: Aabb, b: Aabb): Aabb {
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2]),
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2]),
    ],
  };
}

/** Strict-overlap test (touching within EPS is NOT an intersection). */
export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return (
    a.min[0] + EPS < b.max[0] &&
    b.min[0] + EPS < a.max[0] &&
    a.min[1] + EPS < b.max[1] &&
    b.min[1] + EPS < a.max[1] &&
    a.min[2] + EPS < b.max[2] &&
    b.min[2] + EPS < a.max[2]
  );
}

/** True when `inner` lies entirely inside `outer` (with EPS slack outward). */
export function aabbContains(outer: Aabb, inner: Aabb): boolean {
  return (
    inner.min[0] >= outer.min[0] - EPS &&
    inner.max[0] <= outer.max[0] + EPS &&
    inner.min[1] >= outer.min[1] - EPS &&
    inner.max[1] <= outer.max[1] + EPS &&
    inner.min[2] >= outer.min[2] - EPS &&
    inner.max[2] <= outer.max[2] + EPS
  );
}

/** Intersection AABB of two overlapping AABBs (caller checks `aabbIntersects` first). */
export function aabbIntersection(a: Aabb, b: Aabb): Aabb {
  return {
    min: [
      Math.max(a.min[0], b.min[0]),
      Math.max(a.min[1], b.min[1]),
      Math.max(a.min[2], b.min[2]),
    ],
    max: [
      Math.min(a.max[0], b.max[0]),
      Math.min(a.max[1], b.max[1]),
      Math.min(a.max[2], b.max[2]),
    ],
  };
}

/** A yaw-about-Y oriented box: world center, half-extents in its own frame, yaw. The
 *  pipeline never pitches pieces, so one yaw scalar is the full orientation. An AABB is
 *  an Obb with yaw 0. Used by the placement engine for EXACT piece-envelope tests —
 *  `transformAabb`'s conservative corner-envelope inflates rotated pieces by metres and
 *  was a measured false-reject class (B2 placement wall). */
export type Obb = { center: Vec3; half: Vec3; yaw: number };

/** Wrap a world AABB as a yaw-0 Obb. */
export function obbOfAabb(b: Aabb): Obb {
  return {
    center: [
      (b.min[0] + b.max[0]) / 2,
      (b.min[1] + b.max[1]) / 2,
      (b.min[2] + b.max[2]) / 2,
    ],
    half: [
      (b.max[0] - b.min[0]) / 2,
      (b.max[1] - b.min[1]) / 2,
      (b.max[2] - b.min[2]) / 2,
    ],
    yaw: 0,
  };
}

/** The EXACT world Obb of a local-frame AABB under a yaw+translation placement (the
 *  same `Ry(θ)` convention as `transformAabb`, without its conservative inflation). */
export function obbFromLocalAabb(local: Aabb, yaw: number, t: Vec3): Obb {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const lc: Vec3 = [
    (local.min[0] + local.max[0]) / 2,
    (local.min[1] + local.max[1]) / 2,
    (local.min[2] + local.max[2]) / 2,
  ];
  return {
    center: [
      lc[0] * c + lc[2] * s + t[0],
      lc[1] + t[1],
      -lc[0] * s + lc[2] * c + t[2],
    ],
    half: [
      (local.max[0] - local.min[0]) / 2,
      (local.max[1] - local.min[1]) / 2,
      (local.max[2] - local.min[2]) / 2,
    ],
    yaw,
  };
}

/** Exact overlap test for two yaw-about-Y boxes: Y-interval check + 2D SAT over the
 *  four XZ face normals (two per box). Same EPS stance as `aabbIntersects`: overlap
 *  must exceed EPS on every axis — exact touching is legal placement. */
export function obbIntersects(a: Obb, b: Obb): boolean {
  if (a.center[1] + a.half[1] <= b.center[1] - b.half[1] + EPS) return false;
  if (b.center[1] + b.half[1] <= a.center[1] - a.half[1] + EPS) return false;
  const dx = b.center[0] - a.center[0];
  const dz = b.center[2] - a.center[2];
  // Face normals in XZ. Under Ry(θ): local X̂ → [cosθ, −sinθ], local Ẑ → [sinθ, cosθ].
  const axes: [number, number][] = [
    [Math.cos(a.yaw), -Math.sin(a.yaw)],
    [Math.sin(a.yaw), Math.cos(a.yaw)],
    [Math.cos(b.yaw), -Math.sin(b.yaw)],
    [Math.sin(b.yaw), Math.cos(b.yaw)],
  ];
  const project = (o: Obb, ax: [number, number]): number => {
    const cA = Math.cos(o.yaw);
    const sA = Math.sin(o.yaw);
    // |proj of o's X half-axis| + |proj of o's Z half-axis|
    return (
      o.half[0] * Math.abs(ax[0] * cA + ax[1] * -sA) +
      o.half[2] * Math.abs(ax[0] * sA + ax[1] * cA)
    );
  };
  for (const ax of axes) {
    const dist = Math.abs(dx * ax[0] + dz * ax[1]);
    if (dist + EPS >= project(a, ax) + project(b, ax)) return false;
  }
  return true;
}

/** Conservative transform: yaw-rotate the 8 corners about the frame origin, re-envelope,
 *  translate — the same `Ry(θ)` convention as `connect.ts` (`Ry(θ)·[x,y,z] =
 *  [x·cosθ + z·sinθ, y, −x·sinθ + z·cosθ]`). */
export function transformAabb(b: Aabb, yaw: number, t: Vec3): Aabb {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? b.max[0] : b.min[0];
    const y = i & 2 ? b.max[1] : b.min[1];
    const z = i & 4 ? b.max[2] : b.min[2];
    const rx = x * c + z * s;
    const rz = -x * s + z * c;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (rz < minZ) minZ = rz;
    if (rz > maxZ) maxZ = rz;
  }

  return {
    min: [minX + t[0], minY + t[1], minZ + t[2]],
    max: [maxX + t[0], maxY + t[1], maxZ + t[2]],
  };
}
