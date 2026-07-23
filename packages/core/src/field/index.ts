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
  commitGenerator,
  FIELD_GENERATORS,
  generatorById,
  MAZE_PITCH_CELLS,
} from "./generators.ts";
export type { CompactOptions, LogStats } from "./maintenance.ts";
export { compactRuns, logStats } from "./maintenance.ts";
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
  applyPatchOp,
  assertOpValid,
  assertPatchValid,
  assertPlacementsValid,
  createOpLog,
  fieldOpChunks,
  isBrushOp,
  logApply,
  logApplyPatch,
  opBounds,
  redo,
  restoreImages,
  SMOOTH_MAX_ITERATIONS,
  SMOOTH_MAX_STRENGTH,
  undo,
} from "./ops.ts";
export type { FieldHit } from "./raycast.ts";
export { raycastField } from "./raycast.ts";
export type { ReconfigureChanges } from "./reconfigure.ts";
export {
  bakeGeneratorEntity,
  reconfigureGenerator,
  setGeneratorFrozen,
} from "./reconfigure.ts";
export {
  MAX_SELECTION_BUDGET,
  materializeSelection,
  selectionHas,
} from "./selection.ts";
export { skinChunkKit, variantHash } from "./skin.ts";
export type { SnapshotRecord } from "./snapshots.ts";
export { captureDueSnapshots } from "./snapshots.ts";
export type {
  BrushMask,
  BrushOp,
  BrushShape,
  ChunkCollider,
  ChunkKey,
  ChunkMaterials,
  ChunkMesh,
  ChunkSnapshot,
  DriftFinding,
  EntityOp,
  EvaluateContext,
  FieldAprons,
  FieldChunkMeshes,
  FieldManifest,
  FieldOp,
  FieldStore,
  GeneratorDef,
  GeneratorEntity,
  GeneratorResult,
  KitInstance,
  KitPieceId,
  KitStyle,
  LogEntry,
  MaterialClass,
  MaterializedSelection,
  MaterialKind,
  MaterialTable,
  MergePolicy,
  MeshBucket,
  OpInverse,
  OpLog,
  PatchChunk,
  PatchOp,
  PlacementOp,
  PlacementRecord,
  SelectionSpec,
  SmoothParams,
} from "./types.ts";
export { MAT_ROCK, SMOOTH_DEFAULTS } from "./types.ts";
