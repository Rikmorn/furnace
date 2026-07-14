import type { Vec3Tuple } from "../physics/types.ts";

/** Key of one 16³ chunk: `"cx,cy,cz"` in chunk coordinates. */
export type ChunkKey = string;

/** The sparse chunked density field. Missing chunk = uniform solid rock
 *  (the pay-only-for-dirty invariant). Densities are Int8, air-positive
 *  (>0 air, <0 rock, surface at 0 — the engine-wide field convention),
 *  quantized at DENSITY_SCALE per metre. */
export type FieldStore = {
  /** Sample spacing in metres (world position = sample index * cellSize). */
  readonly cellSize: number;
  readonly chunks: Map<ChunkKey, Int8Array>;
};

/** One dig operation — the only way the field mutates. Bounds are implied
 *  by the shape (every op has bounded spatial influence by construction). */
export type DigOp = {
  id: number;
  kind: "dig";
  shape:
    | { kind: "sphere"; center: [number, number, number]; radius: number }
    | {
        kind: "box";
        center: [number, number, number];
        halfExtents: [number, number, number];
      };
};

/** Inverse deltas for one applied op: full pre-images of every chunk the op
 *  touched, keyed by chunk. Chunk-keyed undo per the charter. */
export type OpInverse = Map<ChunkKey, Int8Array>;

/** Append-only op log with chunk-keyed undo and replay-based redo. */
export type OpLog = {
  ops: DigOp[];
  undoStack: { op: DigOp; inverse: OpInverse }[];
  redoStack: DigOp[];
  nextId: number;
};

/** Mesh buffers for one chunk, positions in CHUNK-LOCAL metres. */
export type ChunkMesh = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
};

/** Voxel collider for one chunk: corner-anchored local grid ints + cell
 *  size, matching the physics `voxels` shape descriptor. */
export type ChunkCollider = {
  coords: Int32Array;
  size: Vec3Tuple;
  /** World position of the chunk's (0,0,0) sample corner. */
  position: [number, number, number];
};

/** v2 field-world manifest (kind discriminates from the v1 region world). */
export type FieldManifest = {
  version: 2;
  kind: "field";
  cellSize: number;
  playerStart: [number, number, number];
  playerYaw: number;
  chunks: { key: ChunkKey; file: string }[];
  meshes: { key: ChunkKey; file: string; origin: [number, number, number] }[];
};
