// packages/core/src/field/skin.ts — the generic kit skinner (One Field F2a).
// W2's substrate/skin.ts + collar.ts emitters running on the DERIVED COARSE
// VIEW: each 0.5 m cell classified by its CENTER SAMPLE (odd fine indices).
// Chunk-local over the 20³ apron pair; ownership = the kit cell's own chunk.
import { CHUNK_DIM, FIELD_APRON_DIM, parseChunkKey } from "./chunks.ts";
import { classOf } from "./materials.ts";
import type {
  ChunkKey,
  FieldAprons,
  KitInstance,
  KitPieceId,
  KitStyle,
  MaterialTable,
} from "./types.ts";

const N = FIELD_APRON_DIM;
const APRON_LEN = N * N * N; // 20³ = 8000 samples per channel
const COARSE = CHUNK_DIM / 2; // 8 coarse cells per chunk axis
const CELL = 0.5; // one coarse-cell edge (m) = 2 fine samples
const POST_SECTION = 0.1; // corner-post cross-section (m)

// FNV-1a constants (the canonical 32-bit offset basis + prime).
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32_RANGE = 0x100000000; // 2^32, to normalise the hash to [0,1)

// Face order: +x, −x, +y, −y, +z, −z. The four horizontal faces carry wall
// panels; +y is a floor tile (walk surface atop the wall), −y a ceiling tile.
const FACE_NORMAL: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const FACE_YAW: readonly number[] = [
  0,
  Math.PI,
  0,
  0,
  -Math.PI / 2,
  Math.PI / 2,
];
const FACE_PIECE: readonly KitPieceId[] = [
  "panel",
  "panel",
  "floorTile",
  "ceilTile",
  "panel",
  "panel",
];
// Corner posts sit at the vertical edges where a ±x face (0/1) and a ±z face
// (4/5) are both exposed — the four horizontal-face pairs.
const POST_PAIRS: readonly [number, number][] = [
  [0, 4],
  [0, 5],
  [1, 4],
  [1, 5],
];

/** Sample value at fine coords (x,y,z) in [−2..17], either channel (the +2
 *  offset maps the −2 apron origin to index 0; matches extractFieldAprons). */
const at = (
  a: Int8Array | Uint8Array,
  x: number,
  y: number,
  z: number,
): number => a[x + 2 + N * (y + 2 + N * (z + 2))] as number;

/** One coarse cell's derived classification (from its center sample). */
type CellView = { solid: boolean; kit: boolean; classId: number };

/** Derived coarse view: classify cell (I,J,K) (each in −1..8) by its center
 *  sample at fine (2I+1, 2J+1, 2K+1). */
function cellAt(
  aprons: FieldAprons,
  table: MaterialTable,
  I: number,
  J: number,
  K: number,
): CellView {
  const x = 2 * I + 1;
  const y = 2 * J + 1;
  const z = 2 * K + 1;
  const solid = at(aprons.density, x, y, z) < 0;
  const classId = at(aprons.materials, x, y, z);
  return { solid, kit: classOf(table, classId).kind === "kit", classId };
}

/**
 * FNV-1a over five ints → [0,1). The W2 variantHash ported verbatim; fed WORLD
 * coarse coords so piece variants stay stable across chunk boundaries.
 *
 * @returns a deterministic value in [0,1).
 */
export function variantHash(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
): number {
  let h = FNV_OFFSET;
  const mix = (n: number): void => {
    h ^= n & 0xff;
    h = Math.imul(h, FNV_PRIME);
    h ^= (n >>> 8) & 0xff;
    h = Math.imul(h, FNV_PRIME);
  };
  mix(a);
  mix(b);
  mix(c);
  mix(d);
  mix(e);
  return (h >>> 0) / UINT32_RANGE;
}

/** Box dims (m) for a kit piece, from the class's {@link KitStyle}. */
function pieceBox(s: KitStyle, piece: KitPieceId): [number, number, number] {
  const inPlane = CELL - 2 * s.panelReveal;
  switch (piece) {
    case "panel":
      return [s.panelProud, inPlane, inPlane];
    case "floorTile":
    case "ceilTile":
      return [inPlane, s.panelProud, inPlane];
    case "post":
      return [POST_SECTION, CELL, POST_SECTION];
    case "rimPostV":
      return [s.collarSection, CELL, s.collarSection];
    case "rimEdgeH":
      return [CELL, s.collarSection, s.collarSection];
  }
}

/** One kit-solid coarse cell's emit context: chunk-local centre (m), world
 *  coarse coords (for variant hashing), and the resolved kit style. */
type KitCell = {
  classId: number;
  style: KitStyle;
  centre: [number, number, number];
  world: [number, number, number];
};

/** The panel/tile for one exposed face `f`: proud along the face normal, its
 *  in-plane box and quarter-turn yaw from the style. */
function faceInstance(cell: KitCell, f: number): KitInstance {
  const n = FACE_NORMAL[f] as [number, number, number];
  const proud = CELL / 2 + cell.style.panelProud / 2;
  return {
    piece: FACE_PIECE[f] as KitPieceId,
    classId: cell.classId,
    position: [
      cell.centre[0] + n[0] * proud,
      cell.centre[1] + n[1] * proud,
      cell.centre[2] + n[2] * proud,
    ],
    yaw: FACE_YAW[f] as number,
    box: pieceBox(cell.style, FACE_PIECE[f] as KitPieceId),
    variant: variantHash(
      cell.world[0],
      cell.world[1],
      cell.world[2],
      f,
      cell.classId,
    ),
  };
}

/** The corner post at the vertical edge shared by faces `fa` (±x) and `fb`
 *  (±z): offset proud along both, full-cell tall. */
function postInstance(cell: KitCell, fa: number, fb: number): KitInstance {
  const a = FACE_NORMAL[fa] as [number, number, number];
  const b = FACE_NORMAL[fb] as [number, number, number];
  const proud = CELL / 2 + cell.style.panelProud / 2;
  return {
    piece: "post",
    classId: cell.classId,
    position: [
      cell.centre[0] + (a[0] + b[0]) * proud,
      cell.centre[1],
      cell.centre[2] + (a[2] + b[2]) * proud,
    ],
    yaw: 0,
    box: pieceBox(cell.style, "post"),
    variant: variantHash(
      cell.world[0],
      cell.world[1],
      cell.world[2],
      6 + fa,
      cell.classId,
    ),
  };
}

/**
 * Skins one chunk's kit surfaces from its 20³ apron pair: a wall panel (or
 * floor/ceiling tile) on every exposed face of each kit-solid coarse cell, plus
 * corner posts at exposed vertical edges. A coarse cell (I,J,K) is derived from
 * its CENTER SAMPLE (fine 2I+1, 2J+1, 2K+1): kit-solid when that sample is solid
 * (density < 0) and its material is a kit class; a face is exposed when the
 * neighbour coarse cell is not solid.
 *
 * Positions are CHUNK-LOCAL metres; piece variants hash WORLD coarse coords so
 * neighbouring chunks agree at the seam. Ownership is the kit cell's own chunk,
 * so world-wide every kit cell is skinned by exactly one chunk.
 *
 * @param aprons - 20³ density + material window ({@link extractFieldAprons}).
 * @param table - resolved material table (for the class kind: organic vs kit).
 * @param cellSize - fine sample spacing in metres.
 * @param key - this chunk's key (world coarse coords for variant hashing).
 * @returns the chunk's kit piece instances (empty when it holds no kit solid).
 * @throws {@link Error} if either apron channel is not 8000 samples (20³).
 */
export function skinChunkKit(
  aprons: FieldAprons,
  table: MaterialTable,
  cellSize: number,
  key: ChunkKey,
): KitInstance[] {
  if (
    aprons.density.length !== APRON_LEN ||
    aprons.materials.length !== APRON_LEN
  )
    throw new Error(
      `skinChunkKit: each apron channel must be ${APRON_LEN} samples (20³), got density ${aprons.density.length}, materials ${aprons.materials.length}`,
    );
  const [cx, cy, cz] = parseChunkKey(key);
  const out: KitInstance[] = [];
  for (let K = 0; K < COARSE; K++)
    for (let J = 0; J < COARSE; J++)
      for (let I = 0; I < COARSE; I++) {
        const c = cellAt(aprons, table, I, J, K);
        if (!c.kit || !c.solid) continue;
        const cls = classOf(table, c.classId);
        if (cls.kind !== "kit") continue; // narrows cls.kit; flag already checked
        const cell: KitCell = {
          classId: c.classId,
          style: cls.kit,
          centre: [
            (2 * I + 1) * cellSize,
            (2 * J + 1) * cellSize,
            (2 * K + 1) * cellSize,
          ],
          world: [cx * COARSE + I, cy * COARSE + J, cz * COARSE + K],
        };
        const exposed: boolean[] = [];
        for (let f = 0; f < 6; f++) {
          const n = FACE_NORMAL[f] as [number, number, number];
          const open = !cellAt(aprons, table, I + n[0], J + n[1], K + n[2])
            .solid;
          exposed.push(open);
          if (open) out.push(faceInstance(cell, f));
        }
        for (const [fa, fb] of POST_PAIRS)
          if (exposed[fa] && exposed[fb]) out.push(postInstance(cell, fa, fb));
      }
  return out;
}
