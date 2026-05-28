// Branded handle types per resource kind. Each handle is a 32-bit
// unsigned integer encoding (slot index, generation):
//
//   bits  0-15 : slot index (0..65535; slot 0 is the invalid sentinel)
//   bits 16-31 : generation counter (0..65535; bumped on each alloc and destroy)
//
// The brand is type-level only — at runtime, all handles are plain
// numbers. The brand prevents accidentally passing a MeshHandle where
// a MaterialHandle is expected.

/** Branded handle referring to a slot in the meshes pool. */
export type MeshHandle = number & { readonly __brand: "MeshHandle" };

/** Branded handle referring to a slot in the material pool. */
export type MaterialHandle = number & { readonly __brand: "MaterialHandle" };

/** Branded handle referring to a slot in the geometry pool. */
export type GeometryHandle = number & { readonly __brand: "GeometryHandle" };

/** Branded handle referring to a slot in the effect pool. */
export type EffectHandle = number & { readonly __brand: "EffectHandle" };

const SLOT_BITS = 16;
const SLOT_MASK = 0xffff;
const GEN_MASK = 0xffff;

/** The invalid-handle sentinel. Slot index 0, generation 0. */
export const INVALID_HANDLE = 0;

/**
 * Encode (slot index, generation) into a uint32 handle. Caller is
 * responsible for narrowing the result to the appropriate branded
 * handle type (MeshHandle, MaterialHandle, etc.).
 *
 * Generation overflow at 16 bits (~65k destroys per slot) wraps.
 * See `engine-conventions.md` §Resource manager.
 */
export function encodeHandle(slotIndex: number, generation: number): number {
  // `<<` and `|` in JS operate on signed int32; the result becomes negative
  // for any generation >= 0x8000 (high bit set). `>>> 0` coerces back to
  // uint32 so the handle satisfies its documented contract and decode round-
  // trips correctly.
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
