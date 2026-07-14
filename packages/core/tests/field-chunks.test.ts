import { describe, expect, test } from "bun:test";
import {
  AIR,
  CHUNK_DIM,
  chunkKey,
  createFieldStore,
  extractApron,
  getDensity,
  SOLID,
  setDensity,
  voxelChunk,
} from "@furnace/core/field";

describe("field chunk store", () => {
  test("untouched world is uniformly solid and allocates nothing", () => {
    const s = createFieldStore();
    expect(getDensity(s, 0, 0, 0)).toBe(SOLID);
    expect(getDensity(s, -1000, 50, 99999)).toBe(SOLID);
    expect(s.chunks.size).toBe(0);
  });

  test("setDensity allocates exactly the touched chunk, filled solid", () => {
    const s = createFieldStore();
    setDensity(s, 5, 5, 5, AIR);
    expect(s.chunks.size).toBe(1);
    expect(getDensity(s, 5, 5, 5)).toBe(AIR);
    expect(getDensity(s, 6, 5, 5)).toBe(SOLID); // same chunk, untouched sample
  });

  test("negative coordinates map to the right chunk (floor division)", () => {
    const s = createFieldStore();
    setDensity(s, -1, -1, -1, 42);
    expect(voxelChunk(-1)).toBe(-1);
    expect(voxelChunk(-16)).toBe(-1);
    expect(voxelChunk(-17)).toBe(-2);
    expect(getDensity(s, -1, -1, -1)).toBe(42);
    expect(s.chunks.has(chunkKey(-1, -1, -1))).toBe(true);
  });

  test("extractApron samples [-1..16] of the chunk, neighbors included", () => {
    const s = createFieldStore();
    // chunk (0,0,0); its -x apron plane comes from chunk (-1,0,0) sample x=-1
    setDensity(s, -1, 0, 0, 17);
    setDensity(s, 16, 0, 0, 23); // +x apron plane, from chunk (1,0,0)
    setDensity(s, 0, 0, 0, 5);
    const a = extractApron(s, chunkKey(0, 0, 0));
    const N = CHUNK_DIM + 2; // 18
    const at = (x: number, y: number, z: number) =>
      a[x + 1 + N * (y + 1 + N * (z + 1))]; // apron index of sample coord
    expect(at(-1, 0, 0)).toBe(17);
    expect(at(0, 0, 0)).toBe(5);
    expect(at(16, 0, 0)).toBe(23);
    expect(at(8, 8, 8)).toBe(SOLID);
  });
});
