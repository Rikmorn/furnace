// src/substrate/collar.ts — E3 rim collar: at every suppressed↔kept same-
// orientation face junction, one collar piece from the SUPPRESSED side (no
// dedup — each junction has exactly one suppressed side when exactly one of the
// pair is suppressed). Vertical junction edge → rimPostV; horizontal → rimEdgeH.
// Pieces sit prouder than panels (COLLAR_SECTION) so the collar reads as a built
// edge framing the damage. The floor-rim path (+Y/−Y suppressed faces) falls out
// of the same junction rule. Pure in (grid, suppressed, seed); no trig, no rng.
import { mat4 } from "@furnace/core/transform";
import type { InstanceGroup, Vec3 } from "../region.ts";
import { AIR, CELL, type CoarseGrid, coarseGet, MASONRY } from "./grid.ts";
import {
  COLLAR_SECTION,
  MAT_COLLAR,
  PIECE_BOX,
  variantHash,
} from "./pieces.ts";
import { FACE_NORMAL, faceKey } from "./skin.ts";

type CollarEmit = { piece: "rimPostV" | "rimEdgeH"; pos: Vec3; v: number };

/** In-plane neighbour steps for a face of orientation `face` (the two axes
 *  perpendicular to the face normal), as [di,dj,dk, isVerticalEdge]. Vertical
 *  edges (spanning ±Y between two side-by-side wall panels) → rimPostV; the rest
 *  → rimEdgeH. */
function inPlaneSteps(face: number): [number, number, number, boolean][] {
  if (face <= 1)
    return [
      [0, 0, 1, true],
      [0, 0, -1, true],
      [0, 1, 0, false],
      [0, -1, 0, false],
    ];
  if (face <= 3)
    return [
      [1, 0, 0, false],
      [-1, 0, 0, false],
      [0, 0, 1, false],
      [0, 0, -1, false],
    ];
  return [
    [1, 0, 0, true],
    [-1, 0, 0, true],
    [0, 1, 0, false],
    [0, -1, 0, false],
  ];
}

/** The suppressed (i,j,k,face) a face key encodes. Keys are TRUSTED — they come
 *  from `faceKey`, so `face` is always 0–5; a malformed `face` would make the
 *  downstream `FACE_NORMAL[face]` lookup undefined and throw, not skip. */
function parseFaceKey(key: string): {
  i: number;
  j: number;
  k: number;
  face: number;
} {
  const parts = key.split(":");
  const coords = (parts[0] ?? "").split(",");
  return {
    i: Number(coords[0]),
    j: Number(coords[1]),
    k: Number(coords[2]),
    face: Number(parts[1]),
  };
}

/** Emit the 2-piece rim collar for a set of suppressed faces. One piece per
 *  suppressed↔kept junction, seated from the suppressed side. */
export function collarInstances(
  g: CoarseGrid,
  suppressed: ReadonlySet<string>,
  seed: string,
): InstanceGroup {
  const emits: CollarEmit[] = [];
  for (const key of suppressed) {
    const { i, j, k, face } = parseFaceKey(key);
    for (const [di, dj, dk, vertical] of inPlaneSteps(face)) {
      if (suppressed.has(faceKey(i + di, j + dj, k + dk, face))) continue;
      if (!exposedMasonryFace(g, i + di, j + dj, k + dk, face)) continue;
      emits.push({
        piece: vertical ? "rimPostV" : "rimEdgeH",
        pos: junctionPos(g, i, j, k, di, dj, dk, face),
        v: variantHash(seed, i, j, k, 16 + face),
      });
    }
  }
  return bucketCollar(emits);
}

/** Junction midpoint: the suppressed cell centre, half a cell toward the kept
 *  neighbour, then proud along the face normal so the collar frames the edge. */
function junctionPos(
  g: CoarseGrid,
  i: number,
  j: number,
  k: number,
  di: number,
  dj: number,
  dk: number,
  face: number,
): Vec3 {
  const n = FACE_NORMAL[face] as Vec3;
  const proud = CELL / 2 + COLLAR_SECTION / 2;
  return [
    g.min[0] + (i + 0.5) * CELL + di * (CELL / 2) + n[0] * proud,
    g.min[1] + (j + 0.5) * CELL + dj * (CELL / 2) + n[1] * proud,
    g.min[2] + (k + 0.5) * CELL + dk * (CELL / 2) + n[2] * proud,
  ];
}

/** Is (i,j,k)'s `face` an exposed masonry face (a kept panel site)? */
function exposedMasonryFace(
  g: CoarseGrid,
  i: number,
  j: number,
  k: number,
  face: number,
): boolean {
  if (coarseGet(g, i, j, k) !== MASONRY) return false;
  const n = FACE_NORMAL[face] as Vec3;
  return coarseGet(g, i + n[0], j + n[1], k + n[2]) === AIR;
}

/** Bake collar emits into one cube-primitive InstanceGroup (column-major TRS,
 *  identity rotation — collar pieces are yaw-less boxes). Mirrors skin.ts's
 *  scratch-buffer bucketing for the single collar material. */
function bucketCollar(emits: CollarEmit[]): InstanceGroup {
  const transforms = new Float32Array(16 * emits.length);
  const tints = new Float32Array(4 * emits.length);
  const m = mat4.create();
  const q = new Float32Array(4);
  q.set([0, 0, 0, 1]); // identity quaternion, constant across all collar pieces
  const t = new Float32Array(3);
  const s = new Float32Array(3);
  for (const [idx, e] of emits.entries()) {
    t.set(e.pos);
    s.set(PIECE_BOX[e.piece]);
    mat4.fromRotationTranslationScale(m, q, t, s);
    transforms.set(m, idx * 16);
    const jitter = 0.9 + 0.2 * e.v;
    tints.set([jitter, jitter, jitter, 1], idx * 4);
  }
  return {
    geometry: { primitive: "cube" },
    material: MAT_COLLAR,
    posture: "lit",
    transforms,
    tints,
  };
}
