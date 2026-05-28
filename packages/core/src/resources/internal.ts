import type { Context } from "../gpu/context-types.ts";
import {
  decodeCtxId,
  decodeGeneration,
  decodeSlotIndex,
  type EffectHandle,
  encodeHandle,
  type GeometryHandle,
  type MaterialHandle,
  type MeshHandle,
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
export type ResourceKind = "mesh" | "material" | "geometry" | "effect";

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
  return _allocRaw(ctx, "mesh", data) as MeshHandle;
}

/** Allocate a material slot and return a branded {@link MaterialHandle}. */
export function _allocMaterial<T>(ctx: Context, data: T): MaterialHandle {
  // Boundary cast: see _allocMesh.
  return _allocRaw(ctx, "material", data) as MaterialHandle;
}

/** Allocate a geometry slot and return a branded {@link GeometryHandle}. */
export function _allocGeometry<T>(ctx: Context, data: T): GeometryHandle {
  // Boundary cast: see _allocMesh.
  return _allocRaw(ctx, "geometry", data) as GeometryHandle;
}

/** Allocate an effect slot and return a branded {@link EffectHandle}. */
export function _allocEffect<T>(ctx: Context, data: T): EffectHandle {
  // Boundary cast: see _allocMesh.
  return _allocRaw(ctx, "effect", data) as EffectHandle;
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
  return _destroyRaw(ctx, "mesh", handle, teardown);
}

/** Destroy a material slot. See {@link _destroyMesh} for semantics. */
export function _destroyMaterial<T>(
  ctx: Context,
  handle: MaterialHandle,
  teardown: (data: T) => void,
): boolean {
  return _destroyRaw(ctx, "material", handle, teardown);
}

/** Destroy a geometry slot. See {@link _destroyMesh} for semantics. */
export function _destroyGeometry<T>(
  ctx: Context,
  handle: GeometryHandle,
  teardown: (data: T) => void,
): boolean {
  return _destroyRaw(ctx, "geometry", handle, teardown);
}

/** Destroy an effect slot. See {@link _destroyMesh} for semantics. */
export function _destroyEffect<T>(
  ctx: Context,
  handle: EffectHandle,
  teardown: (data: T) => void,
): boolean {
  return _destroyRaw(ctx, "effect", handle, teardown);
}

// Live-slot iteration — used by the dispose cascade and `resources.list`.

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
