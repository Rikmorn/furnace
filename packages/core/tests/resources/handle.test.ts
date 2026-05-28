import { expect, test } from "bun:test";
import {
  decodeGeneration,
  decodeSlotIndex,
  encodeHandle,
  INVALID_HANDLE,
  isInvalidHandle,
} from "../../src/resources/handle.ts";

test("encodeHandle round-trips slot index and generation", () => {
  const handle = encodeHandle(7, 4);
  expect(decodeSlotIndex(handle)).toBe(7);
  expect(decodeGeneration(handle)).toBe(4);
});

test("encodeHandle with slot 0 produces the invalid sentinel when generation is 0", () => {
  const handle = encodeHandle(0, 0);
  expect(handle).toBe(INVALID_HANDLE);
  expect(isInvalidHandle(handle)).toBe(true);
});

test("encodeHandle handles maximum slot index (65535)", () => {
  const handle = encodeHandle(65535, 1);
  expect(decodeSlotIndex(handle)).toBe(65535);
  expect(decodeGeneration(handle)).toBe(1);
});

test("encodeHandle handles maximum generation (65535)", () => {
  const handle = encodeHandle(1, 65535);
  expect(decodeSlotIndex(handle)).toBe(1);
  expect(decodeGeneration(handle)).toBe(65535);
});

test("encodeHandle wraps generation past 65535 (documented behaviour)", () => {
  const handle = encodeHandle(1, 65536);
  // 65536 & 0xFFFF === 0
  expect(decodeGeneration(handle)).toBe(0);
});

test("encodeHandle masks slot index past 65535", () => {
  const handle = encodeHandle(65536, 1);
  expect(decodeSlotIndex(handle)).toBe(0);
});

test("isInvalidHandle returns true for slot 0 regardless of generation", () => {
  expect(isInvalidHandle(encodeHandle(0, 0))).toBe(true);
  expect(isInvalidHandle(encodeHandle(0, 5))).toBe(true);
});

test("isInvalidHandle returns false for slot >= 1", () => {
  expect(isInvalidHandle(encodeHandle(1, 0))).toBe(false);
  expect(isInvalidHandle(encodeHandle(100, 0))).toBe(false);
});

test("two different (slot, gen) pairs produce different handles", () => {
  const a = encodeHandle(7, 4);
  const b = encodeHandle(7, 5);
  const c = encodeHandle(8, 4);
  expect(a).not.toBe(b);
  expect(a).not.toBe(c);
});

test("encodeHandle returns positive uint32 even when high bit of generation is set (>>> 0 regression)", () => {
  // Without the `>>> 0` coercion in encodeHandle, (1 << 16) | 0 ... (0x8000 << 16)
  // would produce a negative signed int32. This regression test pins the fix.
  const handle = encodeHandle(1, 0x8000);
  expect(handle).toBeGreaterThan(0);
  expect(decodeSlotIndex(handle)).toBe(1);
  expect(decodeGeneration(handle)).toBe(0x8000);
});

test("handles are always non-negative uint32 values", () => {
  for (let slot = 1; slot <= 100; slot += 7) {
    for (let gen = 1; gen <= 65535; gen += 4095) {
      const handle = encodeHandle(slot, gen);
      expect(handle).toBeGreaterThanOrEqual(0);
      expect(handle).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(handle)).toBe(true);
    }
  }
});
