// src/substrate/skin.ts — the per-face kit skin (spike mechanism, findings doc):
// wall panel per masonry face adjacent to IN-GRID air (yaw from the direction
// table), floor/ceiling tiles from vertical adjacency, corner posts at
// perpendicular exposed-face pairs, door frames from door METADATA only.
// Output: cube-primitive InstanceGroups with baked column-major TRS mat4s
// (non-uniform scale in the matrix; decorative posture — collision is the fine
// grid's job). Pure in (grid, doors, seed, suppressed).
import { mat4 } from "@furnace/core/transform";
import type { InstanceGroup, Vec3 } from "../region.ts";
import { AIR, CELL, type CoarseGrid, coarseGet, MASONRY } from "./grid.ts";
import {
  KIT_MATERIALS,
  MAT_ASHLAR,
  MAT_FLOOR,
  MAT_TRIM,
  PANEL_PROUD,
  PIECE_BOX,
  type PieceId,
  variantHash,
} from "./pieces.ts";

/** 6 face directions ordered [ +X, −X, +Y(up), −Y(down), +Z, −Z ] to match the
 *  spike/door face conventions. */
export const FACE_NORMAL: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
/** Exact quarter-turn yaw (radians) seating a piece's local +X onto each
 *  HORIZONTAL face normal (indices 0,1,4,5). No trig at runtime — exact table. */
export const FACE_YAW: readonly number[] = [
  0,
  Math.PI,
  0,
  0,
  -Math.PI / 2,
  Math.PI / 2,
];

/** Exact quaternions for yaw 0, π/2, π, −π/2 about +Y — keyed by String(yaw), no
 *  trig calls (the no-transcendentals substrate rule; Math.SQRT1_2 is a const). */
const S = Math.SQRT1_2;
const QUARTER_QUAT: Record<string, [number, number, number, number]> = {
  "0": [0, 0, 0, 1],
  [String(Math.PI / 2)]: [0, S, 0, S],
  [String(Math.PI)]: [0, 1, 0, 0],
  [String(-Math.PI / 2)]: [0, -S, 0, S],
};

export type DoorSpec = {
  /** Min corner of the door's AIR cells (coarse ints, local grid coords). */
  min: [number, number, number];
  /** [widthCells, heightCells] along the wall. */
  size: [number, number];
  /** Face direction (0,1,4,5) the door opens toward (outward). */
  face: 0 | 1 | 4 | 5;
};

export const faceKey = (
  i: number,
  j: number,
  k: number,
  face: number,
): string => `${i},${j},${k}:${face}`;

type Emit = { piece: PieceId; pos: Vec3; yaw: number; mat: number; v: number };

/** Skin a coarse grid into instanced kit pieces. `suppressed` faces (from carve
 *  suppression) and door-cell faces emit no panel; doors add frame pieces. */
export function skinGrid(
  g: CoarseGrid,
  doors: DoorSpec[],
  seed: string,
  suppressed: ReadonlySet<string> = new Set(),
): InstanceGroup[] {
  const emits: Emit[] = [];
  const doorFaces = doorFaceKeys(doors);
  const [nx, ny, nz] = g.dims;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (coarseGet(g, i, j, k) !== MASONRY) continue;
        for (let face = 0; face < 6; face++) {
          const n = FACE_NORMAL[face] as Vec3;
          if (coarseGet(g, i + n[0], j + n[1], k + n[2]) !== AIR) continue;
          const key = faceKey(i, j, k, face);
          if (suppressed.has(key) || doorFaces.has(key)) continue;
          emits.push(faceEmit(g, i, j, k, face, seed));
        }
        emitCornerPost(g, i, j, k, suppressed, emits, seed);
      }
  for (const d of doors) emits.push(...frameEmits(g, d));
  return bucket(emits);
}

/** One face piece: wall panel (horizontal faces) or floor/ceiling tile (±Y). */
function faceEmit(
  g: CoarseGrid,
  i: number,
  j: number,
  k: number,
  face: number,
  seed: string,
): Emit {
  const n = FACE_NORMAL[face] as Vec3;
  const centre = cellCentre(g, i, j, k);
  const proud = CELL / 2 + PANEL_PROUD / 2;
  const pos: Vec3 = [
    centre[0] + n[0] * proud,
    centre[1] + n[1] * proud,
    centre[2] + n[2] * proud,
  ];
  const v = variantHash(seed, i, j, k, face);
  if (face === 2) return { piece: "floorTile", pos, yaw: 0, mat: MAT_FLOOR, v };
  if (face === 3) return { piece: "ceilTile", pos, yaw: 0, mat: MAT_FLOOR, v };
  return {
    piece: "panel",
    pos,
    yaw: FACE_YAW[face] as number,
    mat: MAT_ASHLAR,
    v,
  };
}

/** Corner post at each vertical edge where two perpendicular horizontal faces of
 *  this masonry cell are both exposed (spike rule). */
function emitCornerPost(
  g: CoarseGrid,
  i: number,
  j: number,
  k: number,
  suppressed: ReadonlySet<string>,
  out: Emit[],
  seed: string,
): void {
  const exposed = (face: number): boolean => {
    const n = FACE_NORMAL[face] as Vec3;
    return (
      coarseGet(g, i + n[0], j + n[1], k + n[2]) === AIR &&
      !suppressed.has(faceKey(i, j, k, face))
    );
  };
  const centre = cellCentre(g, i, j, k);
  const proud = CELL / 2 + PANEL_PROUD / 2;
  for (const [fa, fb] of [
    [0, 4],
    [0, 5],
    [1, 4],
    [1, 5],
  ] as const) {
    if (!exposed(fa) || !exposed(fb)) continue;
    const a = FACE_NORMAL[fa] as Vec3;
    const b = FACE_NORMAL[fb] as Vec3;
    out.push({
      piece: "post",
      pos: [
        centre[0] + (a[0] + b[0]) * proud,
        centre[1],
        centre[2] + (a[2] + b[2]) * proud,
      ],
      yaw: 0,
      mat: MAT_TRIM,
      v: variantHash(seed, i, j, k, 6 + fa),
    });
  }
}

/** The coarse AIR cell at door-local offset (w along the wall, h up). The wall
 *  runs on Z for ±X-facing doors and on X for ±Z-facing doors; height is +Y. */
function doorCell(d: DoorSpec, w: number, h: number): [number, number, number] {
  const [x, y, z] = d.min;
  return d.face <= 1 ? [x, y + h, z + w] : [x + w, y + h, z];
}

/** Faces covered by a door's AIR cells (no panels there) — keyed on the DOOR
 *  cells' neighbours facing INTO the opening from both sides. */
function doorFaceKeys(doors: DoorSpec[]): Set<string> {
  const keys = new Set<string>();
  for (const d of doors) {
    const n = FACE_NORMAL[d.face] as Vec3;
    for (let w = 0; w < d.size[0]; w++)
      for (let h = 0; h < d.size[1]; h++) {
        const c = doorCell(d, w, h);
        keys.add(faceKey(c[0] - n[0], c[1] - n[1], c[2] - n[2], d.face));
        keys.add(faceKey(c[0] + n[0], c[1] + n[1], c[2] + n[2], d.face ^ 1));
      }
  }
  return keys;
}

/** Offset a point by `delta` along the door's wall axis (Z for ±X faces, X for
 *  ±Z faces). Returns a fresh tuple — no variable-index mutation. */
function alongWall(p: Vec3, face: DoorSpec["face"], delta: number): Vec3 {
  return face <= 1 ? [p[0], p[1], p[2] + delta] : [p[0] + delta, p[1], p[2]];
}

/** Two jambs + a lintel per door, seated at the opening's sides/top. */
function frameEmits(g: CoarseGrid, d: DoorSpec): Emit[] {
  const lo = cellCentre(g, d.min[0], d.min[1], d.min[2]);
  const yaw = FACE_YAW[d.face] as number;
  const mid = alongWall(lo, d.face, ((d.size[0] - 1) * CELL) / 2);
  const jambOff = (d.size[0] * CELL) / 2 + 0.05;
  const jambA = alongWall(mid, d.face, -jambOff);
  const jambB = alongWall(mid, d.face, jambOff);
  const yBase = lo[1] - CELL / 2; // threshold plane
  const atY = (p: Vec3, y: number): Vec3 => [p[0], y, p[2]];
  return [
    { piece: "jamb", pos: atY(jambA, yBase + 1.5), yaw, mat: MAT_TRIM, v: 0.5 },
    { piece: "jamb", pos: atY(jambB, yBase + 1.5), yaw, mat: MAT_TRIM, v: 0.5 },
    {
      piece: "lintel",
      pos: atY(mid, yBase + 3.0 + 0.05),
      yaw,
      mat: MAT_TRIM,
      v: 0.5,
    },
  ];
}

function cellCentre(g: CoarseGrid, i: number, j: number, k: number): Vec3 {
  return [
    g.min[0] + (i + 0.5) * CELL,
    g.min[1] + (j + 0.5) * CELL,
    g.min[2] + (k + 0.5) * CELL,
  ];
}

/** Bucket emits by material into cube-primitive InstanceGroups with baked TRS
 *  mat4s (column-major — the layout setInstanceMatrices consumes; scatter.ts
 *  precedent) and hash-jittered tints. */
export function bucket(emits: Emit[]): InstanceGroup[] {
  const byMat = new Map<number, Emit[]>();
  for (const e of emits) {
    const list = byMat.get(e.mat);
    if (list) list.push(e);
    else byMat.set(e.mat, [e]);
  }
  const groups: InstanceGroup[] = [];
  const m = mat4.create();
  const q = new Float32Array(4);
  const t = new Float32Array(3);
  const s = new Float32Array(3);
  for (const [matIdx, list] of [...byMat.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const transforms = new Float32Array(16 * list.length);
    const tints = new Float32Array(4 * list.length);
    for (const [idx, e] of list.entries()) {
      q.set(QUARTER_QUAT[String(e.yaw)] ?? [0, 0, 0, 1]);
      t.set(e.pos);
      s.set(PIECE_BOX[e.piece]);
      mat4.fromRotationTranslationScale(m, q, t, s);
      transforms.set(m, idx * 16);
      const jitter = 0.92 + 0.16 * e.v; // subtle per-piece value variation
      tints.set([jitter, jitter, jitter, 1], idx * 4);
    }
    groups.push({
      geometry: { primitive: "cube" },
      material: matIdx,
      posture: "lit",
      transforms,
      tints,
    });
  }
  return groups;
}

/** The substrate's shared material table (indices used by skin + collar). */
export const SKIN_MATERIALS = KIT_MATERIALS;
