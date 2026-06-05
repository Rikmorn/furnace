import type { Context } from "../gpu/context-types.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import {
  type BindingHandle,
  decodeCtxId,
  decodeGeneration,
  decodeSlotIndex,
  type EffectHandle,
  encodeHandle,
  type GeometryHandle,
  type MaterialHandle,
  type MeshHandle,
  type PhysicsBodyHandle,
  type PhysicsWorldHandle,
  type RigidMeshHandle,
  type ShaderHandle,
  type TextureHandle,
} from "./handle.ts";
import {
  allocSlot,
  countLiveSlots,
  destroySlot,
  iterateLiveSlots,
  lookupSlot,
  type Pool,
} from "./pool.ts";

/** The kinds the resource manager tracks today. */
export type ResourceKind =
  | "mesh"
  | "material"
  | "geometry"
  | "effect"
  | "shader"
  | "binding"
  | "physics-world"
  | "physics-body"
  | "rigid-mesh"
  | "texture-resource";

/**
 * Map a {@link ResourceKind} to the matching pool on the manager. Engine-
 * internal lookup; not exported to consumers.
 */
function poolFor(ctx: Context, kind: ResourceKind): Pool<unknown> {
  const r = ctx._internal.resources;
  switch (kind) {
    case "mesh":
      return r.meshes;
    case "material":
      return r.materials;
    case "geometry":
      return r.geometries;
    case "effect":
      return r.effects;
    case "shader":
      return r.shaders;
    case "binding":
      return r.bindings;
    case "physics-world":
      return r.physicsWorlds;
    case "physics-body":
      return r.physicsBodies;
    case "rigid-mesh":
      return r.rigidMeshes;
    case "texture-resource":
      return r.textures;
  }
}

/**
 * Allocate a slot in the appropriate pool, populate it with `data`, and
 * return an encoded uint48 handle (ctxId in the upper 16 bits, generation
 * in the middle, slot index in the low). The branded handle type is
 * applied at the typed `_alloc*` wrappers below; this raw helper returns
 * a plain `number`.
 */
function _allocRaw<T>(ctx: Context, kind: ResourceKind, data: T): number {
  const pool = poolFor(ctx, kind);
  // Boundary cast: pool storage is `Pool<unknown>` so the manager can hold
  // all four resource kinds uniformly. The typed _allocMesh/etc. wrappers
  // below enforce the (kind, T) pairing at their call sites.
  const typedPool = pool as Pool<T>;
  const { slotIndex, generation } = allocSlot(typedPool, data);
  return encodeHandle(ctx._internal.ctxId, slotIndex, generation);
}

/**
 * Look up a slot by handle. Returns the slot data on match, or `null`
 * on generation mismatch (stale, destroyed, or invalid handle) or
 * ctxId mismatch (cross-context handle use — collision would otherwise
 * resolve to a wrong-but-live slot in the recipient).
 */
function _lookupRaw<T>(
  ctx: Context,
  kind: ResourceKind,
  handle: number,
): T | null {
  if (decodeCtxId(handle) !== ctx._internal.ctxId) return null;
  const pool = poolFor(ctx, kind);
  // Boundary cast: see _allocRaw — uniform Pool<unknown> on the manager.
  const typedPool = pool as Pool<T>;
  return lookupSlot(
    typedPool,
    decodeSlotIndex(handle),
    decodeGeneration(handle),
  );
}

/**
 * Destroy a slot. The caller passes a `teardown` callback that runs
 * BEFORE the pool's bookkeeping mutation; it receives the slot data so
 * it can release GPU resources, decrement refcounts, etc.
 *
 * Stale or already-destroyed handles: teardown is NOT invoked, returns
 * `false`. Cross-context handles (ctxId mismatch): same — teardown is
 * NOT invoked, returns `false`. Live handles: teardown runs, the pool
 * is mutated, returns `true`.
 *
 * This kind-dispatched form is also reachable as the exported
 * {@link _destroyByKind} for cross-kind callers (e.g. the dispose
 * cascade) that don't have a branded handle in hand.
 */
function _destroyRaw<T>(
  ctx: Context,
  kind: ResourceKind,
  handle: number,
  teardown: (data: T) => void,
): boolean {
  if (decodeCtxId(handle) !== ctx._internal.ctxId) return false;
  const pool = poolFor(ctx, kind);
  // Boundary cast: see _allocRaw.
  const typedPool = pool as Pool<T>;
  const slotIndex = decodeSlotIndex(handle);
  const generation = decodeGeneration(handle);
  const data = lookupSlot(typedPool, slotIndex, generation);
  if (data === null) return false;
  teardown(data);
  destroySlot(typedPool, slotIndex, generation);
  return true;
}

// Typed wrappers — these are the API engine modules call.

/** Allocate a mesh slot and return a branded {@link MeshHandle}. */
export function _allocMesh<T>(ctx: Context, data: T): MeshHandle {
  // Boundary cast: brand-application at the typed wrapper. The underlying
  // value is a plain uint32; the brand is type-level only.
  const handle = _allocRaw(ctx, "mesh", data) as MeshHandle;
  _recordAlloc(ctx, "mesh", 0);
  return handle;
}

/** Allocate a material slot and return a branded {@link MaterialHandle}. */
export function _allocMaterial<T>(ctx: Context, data: T): MaterialHandle {
  // Boundary cast: see _allocMesh.
  const handle = _allocRaw(ctx, "material", data) as MaterialHandle;
  _recordAlloc(ctx, "material", 0);
  return handle;
}

/** Allocate a geometry slot and return a branded {@link GeometryHandle}. */
export function _allocGeometry<T>(ctx: Context, data: T): GeometryHandle {
  // Boundary cast: see _allocMesh.
  const handle = _allocRaw(ctx, "geometry", data) as GeometryHandle;
  _recordAlloc(ctx, "geometry", 0);
  return handle;
}

/** Allocate an effect slot and return a branded {@link EffectHandle}. */
export function _allocEffect<T>(ctx: Context, data: T): EffectHandle {
  // Boundary cast: see _allocMesh.
  const handle = _allocRaw(ctx, "effect", data) as EffectHandle;
  _recordAlloc(ctx, "effect", 0);
  return handle;
}

/** Look up a mesh slot. Returns `null` on stale or invalid handles. */
export function _lookupMesh<T>(ctx: Context, handle: MeshHandle): T | null {
  return _lookupRaw(ctx, "mesh", handle);
}

/** Look up a material slot. Returns `null` on stale or invalid handles. */
export function _lookupMaterial<T>(
  ctx: Context,
  handle: MaterialHandle,
): T | null {
  return _lookupRaw(ctx, "material", handle);
}

/** Look up a geometry slot. Returns `null` on stale or invalid handles. */
export function _lookupGeometry<T>(
  ctx: Context,
  handle: GeometryHandle,
): T | null {
  return _lookupRaw(ctx, "geometry", handle);
}

/** Look up an effect slot. Returns `null` on stale or invalid handles. */
export function _lookupEffect<T>(ctx: Context, handle: EffectHandle): T | null {
  return _lookupRaw(ctx, "effect", handle);
}

/**
 * Destroy a mesh slot. `teardown` runs with the slot data before the
 * pool mutation; returns `true` if destruction happened, `false` on
 * stale handle.
 */
export function _destroyMesh<T>(
  ctx: Context,
  handle: MeshHandle,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, "mesh", handle, teardown);
  if (destroyed) _recordDestroy(ctx, "mesh", 0);
  return destroyed;
}

/** Destroy a material slot. See {@link _destroyMesh} for semantics. */
export function _destroyMaterial<T>(
  ctx: Context,
  handle: MaterialHandle,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, "material", handle, teardown);
  if (destroyed) _recordDestroy(ctx, "material", 0);
  return destroyed;
}

/** Destroy a geometry slot. See {@link _destroyMesh} for semantics. */
export function _destroyGeometry<T>(
  ctx: Context,
  handle: GeometryHandle,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, "geometry", handle, teardown);
  if (destroyed) _recordDestroy(ctx, "geometry", 0);
  return destroyed;
}

/** Destroy an effect slot. See {@link _destroyMesh} for semantics. */
export function _destroyEffect<T>(
  ctx: Context,
  handle: EffectHandle,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, "effect", handle, teardown);
  if (destroyed) _recordDestroy(ctx, "effect", 0);
  return destroyed;
}

/** Allocate a shader slot and return a branded {@link ShaderHandle}. */
export function _allocShader<T>(ctx: Context, data: T): ShaderHandle {
  // Boundary cast: see _allocMesh.
  const handle = _allocRaw(ctx, "shader", data) as ShaderHandle;
  _recordAlloc(ctx, "shader", 0);
  return handle;
}

/** Look up a shader slot. Returns `null` on stale or invalid handles. */
export function _lookupShader<T>(ctx: Context, handle: ShaderHandle): T | null {
  return _lookupRaw(ctx, "shader", handle);
}

/** Destroy a shader slot. See {@link _destroyMesh} for semantics. */
export function _destroyShader<T>(
  ctx: Context,
  handle: ShaderHandle,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, "shader", handle, teardown);
  if (destroyed) _recordDestroy(ctx, "shader", 0);
  return destroyed;
}

/** Allocate a binding slot and return a branded {@link BindingHandle}. */
export function _allocBinding<T>(ctx: Context, data: T): BindingHandle {
  // Boundary cast: see _allocMesh.
  const handle = _allocRaw(ctx, "binding", data) as BindingHandle;
  _recordAlloc(ctx, "binding", 0);
  return handle;
}

/** Look up a binding slot. Returns `null` on stale or invalid handles. */
export function _lookupBinding<T>(
  ctx: Context,
  handle: BindingHandle,
): T | null {
  return _lookupRaw(ctx, "binding", handle);
}

/** Destroy a binding slot. See {@link _destroyMesh} for semantics. */
export function _destroyBinding<T>(
  ctx: Context,
  handle: BindingHandle,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, "binding", handle, teardown);
  if (destroyed) _recordDestroy(ctx, "binding", 0);
  return destroyed;
}

/** Allocate a physics-world slot and return a branded {@link PhysicsWorldHandle}. */
export function _allocPhysicsWorld<T>(
  ctx: Context,
  data: T,
): PhysicsWorldHandle {
  // Boundary cast: see _allocMesh.
  const handle = _allocRaw(ctx, "physics-world", data) as PhysicsWorldHandle;
  _recordAlloc(ctx, "physics-world", 0);
  return handle;
}

/** Look up a physics-world slot. Returns `null` on stale or invalid handles. */
export function _lookupPhysicsWorld<T>(
  ctx: Context,
  handle: PhysicsWorldHandle,
): T | null {
  return _lookupRaw(ctx, "physics-world", handle);
}

/** Destroy a physics-world slot. See {@link _destroyMesh} for semantics. */
export function _destroyPhysicsWorld<T>(
  ctx: Context,
  handle: PhysicsWorldHandle,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, "physics-world", handle, teardown);
  if (destroyed) _recordDestroy(ctx, "physics-world", 0);
  return destroyed;
}

/** Allocate a physics-body slot and return a branded {@link PhysicsBodyHandle}. */
export function _allocPhysicsBody<T>(ctx: Context, data: T): PhysicsBodyHandle {
  // Boundary cast: see _allocMesh.
  const handle = _allocRaw(ctx, "physics-body", data) as PhysicsBodyHandle;
  _recordAlloc(ctx, "physics-body", 0);
  return handle;
}

/** Look up a physics-body slot. Returns `null` on stale or invalid handles. */
export function _lookupPhysicsBody<T>(
  ctx: Context,
  handle: PhysicsBodyHandle,
): T | null {
  return _lookupRaw(ctx, "physics-body", handle);
}

/** Destroy a physics-body slot. See {@link _destroyMesh} for semantics. */
export function _destroyPhysicsBody<T>(
  ctx: Context,
  handle: PhysicsBodyHandle,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, "physics-body", handle, teardown);
  if (destroyed) _recordDestroy(ctx, "physics-body", 0);
  return destroyed;
}

/** Allocate a rigid-mesh slot and return a branded {@link RigidMeshHandle}. */
export function _allocRigidMesh<T>(ctx: Context, data: T): RigidMeshHandle {
  // Boundary cast: see _allocMesh.
  const handle = _allocRaw(ctx, "rigid-mesh", data) as RigidMeshHandle;
  _recordAlloc(ctx, "rigid-mesh", 0);
  return handle;
}

/** Look up a rigid-mesh slot. Returns `null` on stale or invalid handles. */
export function _lookupRigidMesh<T>(
  ctx: Context,
  handle: RigidMeshHandle,
): T | null {
  return _lookupRaw(ctx, "rigid-mesh", handle);
}

/** Destroy a rigid-mesh slot. See {@link _destroyMesh} for semantics. */
export function _destroyRigidMesh<T>(
  ctx: Context,
  handle: RigidMeshHandle,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, "rigid-mesh", handle, teardown);
  if (destroyed) _recordDestroy(ctx, "rigid-mesh", 0);
  return destroyed;
}

/** Allocate a texture slot and return a branded {@link TextureHandle}. */
export function _allocTexture<T>(ctx: Context, data: T): TextureHandle {
  // Boundary cast: see _allocMesh.
  const handle = _allocRaw(ctx, "texture-resource", data) as TextureHandle;
  // Counts the texture *handle* (resources.textures). GPU *bytes* are recorded
  // separately by texture.create via the "texture" memory kind — mirrors how
  // geometry counts its slot ("geometry") and its bytes ("buffer") apart.
  _recordAlloc(ctx, "texture-resource", 0);
  return handle;
}

/** Look up a texture slot. Returns `null` on stale or invalid handles. */
export function _lookupTexture<T>(
  ctx: Context,
  handle: TextureHandle,
): T | null {
  return _lookupRaw(ctx, "texture-resource", handle);
}

/** Destroy a texture slot. See {@link _destroyMesh} for semantics. */
export function _destroyTexture<T>(
  ctx: Context,
  handle: TextureHandle,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, "texture-resource", handle, teardown);
  if (destroyed) _recordDestroy(ctx, "texture-resource", 0);
  return destroyed;
}

/**
 * Clear the per-ctx engine-owned built-in shader cache. Called by the dispose
 * cascade after it frees the built-in shader slots: the cache holds resolved
 * handles to those now-dead slots, so a later `material.create` with
 * `shader.unlit`/`shader.normalColor` (e.g. after a mid-session
 * `resources.disposeAll`) must recompile the shader rather than reuse a
 * freed handle.
 */
export function _resetBuiltinShaders(ctx: Context): void {
  // Fresh object (not field-by-field reset) so adding a built-in shader to the
  // cache shape becomes a typecheck error here, not a silently-missed reset.
  ctx._internal.resources.builtinShaders = {
    unlit: null,
    normalColor: null,
    lit: null,
    textured: null,
    texturedLit: null,
  };
}

/**
 * Cross-kind destroy used by the dispose cascade. Handles arrive as
 * raw uint48s out of {@link _iterateLive} — no branded type to feed
 * a per-kind `_destroy*` wrapper. Same semantics as {@link _destroyMesh}
 * et al.: teardown runs before pool mutation; stale/cross-context
 * handles are silently skipped.
 */
export function _destroyByKind<T>(
  ctx: Context,
  kind: ResourceKind,
  handle: number,
  teardown: (data: T) => void,
): boolean {
  const destroyed = _destroyRaw(ctx, kind, handle, teardown);
  if (destroyed) _recordDestroy(ctx, kind, 0);
  return destroyed;
}

// Live-slot iteration — used by the dispose cascade.

/** Count live slots in the pool for `kind`. */
export function _countLive(ctx: Context, kind: ResourceKind): number {
  return countLiveSlots(poolFor(ctx, kind));
}

/**
 * Iterate live `(handle, data)` pairs for `kind`. Handles are encoded
 * uint48s carrying the owning ctx's id, ready to feed back into
 * `_lookup*` / `_destroy*`.
 */
export function _iterateLive<T>(
  ctx: Context,
  kind: ResourceKind,
): IterableIterator<{ handle: number; data: T }> {
  const pool = poolFor(ctx, kind);
  // Boundary cast: see _allocRaw — uniform Pool<unknown> on the manager.
  const typedPool = pool as Pool<T>;
  return iterateLiveSlotsAsHandles(ctx._internal.ctxId, typedPool);
}

function* iterateLiveSlotsAsHandles<T>(
  ctxId: number,
  pool: Pool<T>,
): IterableIterator<{ handle: number; data: T }> {
  for (const { slotIndex, generation, data } of iterateLiveSlots(pool)) {
    yield { handle: encodeHandle(ctxId, slotIndex, generation), data };
  }
}
