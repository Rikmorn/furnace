/**
 * Branded handle types per resource kind. Each handle is a 32-bit
 * unsigned integer encoding (slot index, generation):
 *
 *   bits  0-15 : slot index (0..65535; slot 0 is the invalid sentinel)
 *   bits 16-31 : generation counter (0..65535; bumped on each alloc and destroy)
 *
 * The brand is type-level only — at runtime, all handles are plain
 * numbers. The brand prevents accidentally passing a MeshHandle where
 * a MaterialHandle is expected.
 */
export type MeshHandle = number & { readonly __brand: "MeshHandle" };

/** Branded handle referring to a slot in the material pool. */
export type MaterialHandle = number & { readonly __brand: "MaterialHandle" };

/** Branded handle referring to a slot in the geometry pool. */
export type GeometryHandle = number & { readonly __brand: "GeometryHandle" };

/** Branded handle referring to a slot in the effect pool. */
export type EffectHandle = number & { readonly __brand: "EffectHandle" };

/** Union of all branded handle types. Used in resources.* introspection. */
export type ResourceHandle =
  | MeshHandle
  | MaterialHandle
  | GeometryHandle
  | EffectHandle;

const SLOT_BITS = 16;
const SLOT_MASK = 0xffff;
const GEN_MASK = 0xffff;

/** The invalid-handle sentinel. Slot index 0, generation 0. */
export const INVALID_HANDLE = 0;

/**
 * Encode (slot index, generation) into a uint32 handle. The result is
 * branded as the given handle type via the caller's type assertion at
 * the alloc site.
 *
 * Generation overflow at 16 bits (~65k destroys per slot) wraps. Debug
 * builds warn; production builds wrap silently. See
 * `engine-conventions.md` §Resource manager.
 */
export function encodeHandle(slotIndex: number, generation: number): number {
  // `>>> 0` coerces the signed-int32 result of `<<` back to uint32 — without
  // it, generation values with the high bit set produce a negative number.
  return (
    (((generation & GEN_MASK) << SLOT_BITS) | (slotIndex & SLOT_MASK)) >>> 0
  );
}

/** Decode the slot index from a handle. */
export function decodeSlotIndex(handle: number): number {
  return handle & SLOT_MASK;
}

/** Decode the generation counter from a handle. */
export function decodeGeneration(handle: number): number {
  return (handle >>> SLOT_BITS) & GEN_MASK;
}

/** Whether a handle is the invalid sentinel (slot 0). */
export function isInvalidHandle(handle: number): boolean {
  return decodeSlotIndex(handle) === 0;
}
