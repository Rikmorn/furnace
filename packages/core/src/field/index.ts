export type { BakedFile, BakeFieldWorldOptions } from "./artifact.ts";
export {
  bakeFieldWorld,
  chunkFilePath,
  decodeChunkFile,
  encodeChunkFile,
  parseOps,
  serializeOps,
} from "./artifact.ts";
export {
  AIR,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  createFieldStore,
  DEFAULT_CELL_SIZE,
  DENSITY_SCALE,
  extractApron,
  getDensity,
  parseChunkKey,
  SOLID,
  sampleToWorld,
  setDensity,
  voxelChunk,
  worldToVoxel,
} from "./chunks.ts";
/** Derives one chunk's shell voxel collider (solid samples adjacent to air),
 *  corner-anchored in the physics `voxels` shape; null when the chunk has no
 *  shell. */
export { chunkColliders } from "./collider.ts";
export { meshChunkApron } from "./mesher.ts";
export {
  applyOp,
  createOpLog,
  logApply,
  opBounds,
  redo,
  undo,
} from "./ops.ts";
export type { FieldHit } from "./raycast.ts";
export { raycastField } from "./raycast.ts";
export type {
  ChunkCollider,
  ChunkKey,
  ChunkMesh,
  DigOp,
  FieldManifest,
  FieldStore,
  OpInverse,
  OpLog,
} from "./types.ts";
