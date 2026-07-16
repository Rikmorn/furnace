export type { BakedFile, BakeFieldWorldOptions } from "./artifact.ts";
export {
  bakeFieldWorld,
  chunkFilePath,
  decodeChunkFile,
  decodeMaterialFile,
  encodeChunkFile,
  encodeMaterialFile,
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
  extractFieldAprons,
  FIELD_APRON_DIM,
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
export {
  BUILTIN_TABLE,
  classOf,
  cloneChunkMaterials,
  getMaterial,
  setMaterial,
  validateMaterialTable,
} from "./materials.ts";
export { meshChunkField } from "./mesher.ts";
export {
  applyOp,
  assertOpValid,
  createOpLog,
  logApply,
  opBounds,
  redo,
  undo,
} from "./ops.ts";
export type { FieldHit } from "./raycast.ts";
export { raycastField } from "./raycast.ts";
export { skinChunkKit, variantHash } from "./skin.ts";
export type {
  BrushOp,
  BrushShape,
  ChunkCollider,
  ChunkKey,
  ChunkMaterials,
  ChunkMesh,
  ChunkSnapshot,
  FieldAprons,
  FieldChunkMeshes,
  FieldManifest,
  FieldOp,
  FieldStore,
  KitInstance,
  KitPieceId,
  KitStyle,
  MaterialClass,
  MaterialKind,
  MaterialTable,
  MeshBucket,
  OpInverse,
  OpLog,
} from "./types.ts";
export { MAT_ROCK } from "./types.ts";
