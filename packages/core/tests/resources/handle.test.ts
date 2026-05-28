import { expect, test } from "bun:test";
import {
  decodeCtxId,
  decodeGeneration,
  decodeSlotIndex,
  encodeHandle,
  INVALID_HANDLE,
  isInvalidHandle,
} from "../../src/resources/handle.ts";

test("encodeHandle round-trips slot index and generation (ctxId=0)", () => {
  const handle = encodeHandle(0, 7, 4);
  expect(decodeSlotIndex(handle)).toBe(7);
  expect(decodeGeneration(handle)).toBe(4);
  expect(decodeCtxId(handle)).toBe(0);
});

test("encodeHandle round-trips ctxId, slot index, and generation", () => {
  const handle = encodeHandle(42, 7, 4);
  expect(decodeCtxId(handle)).toBe(42);
  expect(decodeSlotIndex(handle)).toBe(7);
  expect(decodeGeneration(handle)).toBe(4);
});

test("encodeHandle with slot 0 / gen 0 / ctxId 0 produces the invalid sentinel", () => {
  const handle = encodeHandle(0, 0, 0);
  expect(handle).toBe(INVALID_HANDLE);
  expect(isInvalidHandle(handle)).toBe(true);
});

test("encodeHandle handles maximum slot index (65535)", () => {
  const handle = encodeHandle(0, 65535, 1);
  expect(decodeSlotIndex(handle)).toBe(65535);
  expect(decodeGeneration(handle)).toBe(1);
});

test("encodeHandle handles maximum generation (65535)", () => {
  const handle = encodeHandle(0, 1, 65535);
  expect(decodeSlotIndex(handle)).toBe(1);
  expect(decodeGeneration(handle)).toBe(65535);
});

test("encodeHandle handles maximum ctxId (65535)", () => {
  const handle = encodeHandle(0xffff, 1, 1);
  expect(decodeCtxId(handle)).toBe(0xffff);
  expect(decodeSlotIndex(handle)).toBe(1);
  expect(decodeGeneration(handle)).toBe(1);
});

test("encodeHandle wraps generation past 65535 (documented behaviour)", () => {
  const handle = encodeHandle(0, 1, 65536);
  // 65536 & 0xFFFF === 0
  expect(decodeGeneration(handle)).toBe(0);
});

test("encodeHandle masks slot index past 65535", () => {
  const handle = encodeHandle(0, 65536, 1);
  expect(decodeSlotIndex(handle)).toBe(0);
});

test("encodeHandle masks ctxId past 65535", () => {
  const handle = encodeHandle(0x10000, 1, 1);
  expect(decodeCtxId(handle)).toBe(0);
});

test("isInvalidHandle returns true for slot 0 regardless of generation or ctxId", () => {
  expect(isInvalidHandle(encodeHandle(0, 0, 0))).toBe(true);
  expect(isInvalidHandle(encodeHandle(0, 0, 5))).toBe(true);
  expect(isInvalidHandle(encodeHandle(7, 0, 5))).toBe(true);
});

test("isInvalidHandle returns false for slot >= 1", () => {
  expect(isInvalidHandle(encodeHandle(0, 1, 0))).toBe(false);
  expect(isInvalidHandle(encodeHandle(0, 100, 0))).toBe(false);
  expect(isInvalidHandle(encodeHandle(7, 100, 0))).toBe(false);
});

test("two different (slot, gen) pairs produce different handles (same ctxId)", () => {
  const a = encodeHandle(1, 7, 4);
  const b = encodeHandle(1, 7, 5);
  const c = encodeHandle(1, 8, 4);
  expect(a).not.toBe(b);
  expect(a).not.toBe(c);
});

test("two handles with same (slot, gen) but different ctxId are different numbers", () => {
  const a = encodeHandle(1, 1, 1);
  const b = encodeHandle(2, 1, 1);
  expect(a).not.toBe(b);
  // Same low-32 payload but the ctxId rides above 2^32.
  expect(b - a).toBe(0x100000000);
});

test("decodeCtxId returns 0 for handles encoded with ctxId=0", () => {
  expect(decodeCtxId(encodeHandle(0, 1, 1))).toBe(0);
  expect(decodeCtxId(encodeHandle(0, 65535, 65535))).toBe(0);
});

test("decodeCtxId returns 0 for the invalid sentinel", () => {
  expect(decodeCtxId(INVALID_HANDLE)).toBe(0);
});

test("encodeHandle returns positive integer even when high bit of generation is set (>>> 0 regression)", () => {
  // Without the `>>> 0` coercion in encodeHandle, the lo-32 pack would
  // be a negative signed int32 for generations >= 0x8000. Adding ctxId
  // arithmetic on top of a negative number would corrupt the result.
  const handle = encodeHandle(0, 1, 0x8000);
  expect(handle).toBeGreaterThan(0);
  expect(decodeSlotIndex(handle)).toBe(1);
  expect(decodeGeneration(handle)).toBe(0x8000);

  // Same with a non-zero ctxId — must remain a clean uint48.
  const withCtx = encodeHandle(7, 1, 0x8000);
  expect(withCtx).toBeGreaterThan(0);
  expect(decodeCtxId(withCtx)).toBe(7);
  expect(decodeSlotIndex(withCtx)).toBe(1);
  expect(decodeGeneration(withCtx)).toBe(0x8000);
});

test("encodeHandle with ctxId=0xFFFF produces a handle within JS safe-integer range", () => {
  const handle = encodeHandle(0xffff, 0xffff, 0xffff);
  expect(handle).toBeGreaterThanOrEqual(0);
  expect(handle).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  expect(Number.isSafeInteger(handle)).toBe(true);
  expect(decodeCtxId(handle)).toBe(0xffff);
  expect(decodeSlotIndex(handle)).toBe(0xffff);
  expect(decodeGeneration(handle)).toBe(0xffff);
});

test("handles are always non-negative safe integers", () => {
  for (let ctx = 0; ctx <= 0xffff; ctx += 8191) {
    for (let slot = 1; slot <= 100; slot += 7) {
      for (let gen = 1; gen <= 65535; gen += 4095) {
        const handle = encodeHandle(ctx, slot, gen);
        expect(handle).toBeGreaterThanOrEqual(0);
        expect(Number.isSafeInteger(handle)).toBe(true);
      }
    }
  }
});

test("slot/gen decoders ignore the ctxId in the upper 16 bits", () => {
  // The bitwise decoders (& 0xFFFF and >>> 16) operate on signed int32
  // and inherently truncate. Verify this still produces correct slot/gen
  // for any ctxId in range.
  for (let ctx = 0; ctx <= 0xffff; ctx += 4097) {
    const handle = encodeHandle(ctx, 12345, 9876);
    expect(decodeSlotIndex(handle)).toBe(12345);
    expect(decodeGeneration(handle)).toBe(9876);
  }
});
