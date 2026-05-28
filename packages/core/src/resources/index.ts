// Engine-internal module — not part of `@furnace/core`'s public exports
// (see `packages/core/package.json`). This file exists so the structural
// `check-tsdoc.ts` walker (which expects one `index.ts` per src subdir)
// has something to read. Public resource-manager surface is introduced
// in Session 2; until then everything below is engine-internal.

export {
  type CascadeTeardownSlot,
  disposeAllResources,
} from "./dispose.ts";
export {
  decodeGeneration,
  decodeSlotIndex,
  type EffectHandle,
  encodeHandle,
  type GeometryHandle,
  INVALID_HANDLE,
  isInvalidHandle,
  type MaterialHandle,
  type MeshHandle,
} from "./handle.ts";
export {
  _allocEffect,
  _allocGeometry,
  _allocMaterial,
  _allocMesh,
  _countLive,
  _destroyEffect,
  _destroyGeometry,
  _destroyMaterial,
  _destroyMesh,
  _iterateLive,
  _lookupEffect,
  _lookupGeometry,
  _lookupMaterial,
  _lookupMesh,
  type ResourceKind,
} from "./internal.ts";
export {
  createResourceManager,
  type ResourceManager,
} from "./manager.ts";
export {
  allocSlot,
  countLiveSlots,
  createPool,
  destroySlot,
  INVALID_SLOT,
  iterateLiveSlots,
  lookupSlot,
  POOL_INITIAL_CAPACITY,
  type Pool,
} from "./pool.ts";
