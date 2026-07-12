// src/substrate/pieces.ts — the procedural kit catalog (spike's ~7 pieces as
// BOX dims) + the seeded variant hash (replaces the spike's %5 — D-W2-1).
// Flat per-piece materials (charter minimum; atlas → backlog).
import type { MaterialDescriptor } from "../region.ts";
import { CELL } from "./grid.ts";

export const PANEL_PROUD = 0.06; // proud of the collision plane (spike, gated)
export const PANEL_REVEAL = 0.02; // per-side inset → shadowed mortar reveals
export const COLLAR_SECTION = 0.14; // collar pieces sit prouder than panels

export type PieceId =
  | "panel"
  | "floorTile"
  | "ceilTile"
  | "post"
  | "jamb"
  | "lintel"
  | "tread"
  | "rimPostV"
  | "rimEdgeH";

/** Base box dims [x,y,z] in the piece's LOCAL frame (yaw seats it on a face). */
export const PIECE_BOX: Record<PieceId, [number, number, number]> = {
  panel: [PANEL_PROUD, CELL - 2 * PANEL_REVEAL, CELL - 2 * PANEL_REVEAL],
  floorTile: [CELL - 2 * PANEL_REVEAL, PANEL_PROUD, CELL - 2 * PANEL_REVEAL],
  ceilTile: [CELL - 2 * PANEL_REVEAL, PANEL_PROUD, CELL - 2 * PANEL_REVEAL],
  post: [0.1, CELL, 0.1],
  jamb: [0.1, 3.0, 0.1],
  lintel: [2.0 + 0.2, 0.1, 0.1],
  tread: [CELL, 0.25, 2.0], // one stair step: 0.5 run x 0.25 rise x door width
  rimPostV: [COLLAR_SECTION, CELL, COLLAR_SECTION],
  rimEdgeH: [CELL, COLLAR_SECTION, COLLAR_SECTION],
};

/** Kit materials — indices are the substrate's material table (skin/collar share it). */
export const KIT_MATERIALS: MaterialDescriptor[] = [
  { color: [0.55, 0.53, 0.5, 1], specular: [0.04, 0.04, 0.04, 12] }, // 0 ashlar
  { color: [0.42, 0.4, 0.38, 1], specular: [0.03, 0.03, 0.03, 10] }, // 1 floor/ceil
  { color: [0.35, 0.33, 0.3, 1], specular: [0.05, 0.05, 0.05, 16] }, // 2 trim/frame
  { color: [0.3, 0.28, 0.26, 1], specular: [0.06, 0.06, 0.06, 16] }, // 3 collar
];
export const MAT_ASHLAR = 0;
export const MAT_FLOOR = 1;
export const MAT_TRIM = 2;
export const MAT_COLLAR = 3;

/** FNV-1a over (seed, cell, face) → [0,1). Deterministic, unbanded (D-W2-1). */
export function variantHash(
  seed: string,
  i: number,
  j: number,
  k: number,
  face: number,
): number {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (let c = 0; c < seed.length; c++) mix(seed.charCodeAt(c));
  mix(i);
  mix(j);
  mix(k);
  mix(face);
  return (h >>> 0) / 0x100000000;
}
