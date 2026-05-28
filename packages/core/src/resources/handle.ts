// Branded handle types per resource kind. Each handle is a 48-bit
// non-negative integer (uint48 — within JS's 2^53 safe-integer range)
// encoding (ctxId, generation, slot index):
//
//   bits  0-15 : slot index (0..65535; slot 0 is the invalid sentinel)
//   bits 16-31 : generation counter (0..65535; bumped on each alloc and destroy)
//   bits 32-47 : context id (1..65535; assigned per Context at construction;
//                            0 is reserved as part of the invalid-handle sentinel)
//
// The brand is type-level only — at runtime, all handles are plain
// numbers. The brand prevents accidentally passing a MeshHandle where
// a MaterialHandle is expected; the ctxId catches the harder case of
// passing one context's handle to another context's lookup (collisions
// would otherwise resolve to a wrong-but-live slot in the recipient).

/** Branded handle referring to a slot in the meshes pool. */
export type MeshHandle = number & { readonly __brand: "MeshHandle" };

/** Branded handle referring to a slot in the material pool. */
export type MaterialHandle = number & { readonly __brand: "MaterialHandle" };

/** Branded handle referring to a slot in the geometry pool. */
export type GeometryHandle = number & { readonly __brand: "GeometryHandle" };

/** Branded handle referring to a slot in the effect pool. */
export type EffectHandle = number & { readonly __brand: "EffectHandle" };

/**
 * Union of every branded handle kind. Used by cross-cutting
 * resource APIs that handle multiple resource types uniformly.
 */
export type AnyResourceHandle =
  | MeshHandle
  | MaterialHandle
  | GeometryHandle
  | EffectHandle;

const SLOT_BITS = 16;
const SLOT_MASK = 0xffff;
const GEN_MASK = 0xffff;
const CTX_MASK = 0xffff;
const HANDLE32_RANGE = 0x100000000; // 2^32 — the lo-32 budget; ctxId rides above

/** The invalid-handle sentinel. ctxId 0, slot 0, generation 0. */
export const INVALID_HANDLE = 0;

/**
 * Encode (ctxId, slot index, generation) into a uint48 handle.
 *
 * `<<` and `|` in JS operate on signed int32; the result of the lo-32
 * pack becomes negative for any generation ≥ 0x8000 (high bit set).
 * `>>> 0` coerces back to uint32. Then we add `ctxId * 2^32` using plain
 * arithmetic (not a bitop, which would truncate) to ride the ctxId in
 * the upper 16 bits. Final result is a non-negative IEEE-754 integer
 * within the 2^53 safe range.
 *
 * Generation overflow at 16 bits (~65k destroys per slot) wraps. ctxId
 * overflow at 16 bits (65k Context lifetimes within one JS realm)
 * wraps; documented as a SPA-lifetime limit.
 *
 * Caller is responsible for narrowing the result to the appropriate
 * branded handle type (MeshHandle, MaterialHandle, etc.).
 *
 * See `engine-conventions.md` §Resource manager.
 */
export function encodeHandle(
  ctxId: number,
  slotIndex: number,
  generation: number,
): number {
  const lo32 =
    (((generation & GEN_MASK) << SLOT_BITS) | (slotIndex & SLOT_MASK)) >>> 0;
  return (ctxId & CTX_MASK) * HANDLE32_RANGE + lo32;
}

/** Decode the slot index from a handle. Bitwise op drops the ctxId. */
export function decodeSlotIndex(handle: number): number {
  return handle & SLOT_MASK;
}

/** Decode the generation counter. Bitwise op drops the ctxId. */
export function decodeGeneration(handle: number): number {
  return (handle >>> SLOT_BITS) & GEN_MASK;
}

/** Decode the context id from a handle. */
export function decodeCtxId(handle: number): number {
  return Math.floor(handle / HANDLE32_RANGE);
}

/** Whether a handle is the invalid sentinel (slot 0, any ctxId/gen). */
export function isInvalidHandle(handle: number): boolean {
  return decodeSlotIndex(handle) === 0;
}
