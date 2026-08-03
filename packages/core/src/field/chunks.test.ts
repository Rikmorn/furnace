import { describe, expect, test } from "bun:test";
import {
  AIR,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  createFieldStore,
  extractFieldAprons,
  getDensity,
  MAT_ROCK,
  SOLID,
  setDensity,
  setMaterial,
  voxelChunk,
} from "@furnace/core/field";
// densityEqual is deliberately NOT on the public index — in-core surface the
// reconfigure drift comparator consumes, the density-channel twin of
// materialsEqual (whose own block lives in field-materials.test.ts).
import { densityEqual } from "./chunks.ts";

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

  test("extractFieldAprons samples [-2..17] of BOTH channels, neighbors included", () => {
    const s = createFieldStore();
    // chunk (0,0,0); its -x apron plane comes from chunk (-1,0,0) sample x=-1
    setDensity(s, -1, 0, 0, 17);
    setDensity(s, 16, 0, 0, 23); // +x apron plane, from chunk (1,0,0)
    setDensity(s, 0, 0, 0, 5);
    setMaterial(s, -1, 0, 0, 3); // -x apron material plane, from chunk (-1,0,0)
    const a = extractFieldAprons(s, chunkKey(0, 0, 0));
    const N = CHUNK_DIM + 4; // 20
    expect(a.density.length).toBe(N * N * N); // 8000
    expect(a.materials.length).toBe(N * N * N);
    const at = (x: number, y: number, z: number) =>
      a.density[x + 2 + N * (y + 2 + N * (z + 2))]; // apron index of sample coord
    const atMat = (x: number, y: number, z: number) =>
      a.materials[x + 2 + N * (y + 2 + N * (z + 2))];
    expect(at(-1, 0, 0)).toBe(17);
    expect(at(0, 0, 0)).toBe(5);
    expect(at(16, 0, 0)).toBe(23);
    expect(at(8, 8, 8)).toBe(SOLID);
    // The wider ±2 layer is present: sample -2 reads the (-1,..) chunk's rock.
    expect(at(-2, 0, 0)).toBe(SOLID);
    expect(atMat(-1, 0, 0)).toBe(3); // painted neighbor class pulled in
    expect(atMat(0, 0, 0)).toBe(MAT_ROCK); // untouched sample reads rock
  });
});

describe("densityEqual — elision-aware comparison", () => {
  const allSolid = (): Int8Array => new Int8Array(CHUNK_SAMPLES).fill(SOLID);

  test("both sides absent compares equal, in every spelling", () => {
    // `null` spells an absent CAPTURED image, `undefined` a missing map entry
    expect(densityEqual(null, null)).toBe(true);
    expect(densityEqual(undefined, undefined)).toBe(true);
    expect(densityEqual(null, undefined)).toBe(true);
    expect(densityEqual(undefined, null)).toBe(true);
  });

  // The branch the elision rule turns on, and the one a byte-compare gets
  // wrong: an unallocated chunk IS uniform SOLID, so allocating it without
  // writing anything must not read as a change.
  test("an allocated all-SOLID chunk equals an unallocated one, both ways", () => {
    expect(densityEqual(allSolid(), undefined)).toBe(true);
    expect(densityEqual(undefined, allSolid())).toBe(true);
    expect(densityEqual(allSolid(), null)).toBe(true);
    expect(densityEqual(null, allSolid())).toBe(true);
  });

  test("one non-solid cell makes an allocated chunk differ from an absent one", () => {
    const dug = allSolid();
    dug[CHUNK_SAMPLES - 1] = AIR; // the LAST cell: a short scan would miss it
    expect(densityEqual(dug, undefined)).toBe(false);
    expect(densityEqual(undefined, dug)).toBe(false);
  });

  test("two allocated chunks compare cell by cell", () => {
    const a = allSolid();
    const b = allSolid();
    a[100] = AIR;
    expect(densityEqual(a, b)).toBe(false);
    b[100] = AIR;
    expect(densityEqual(a, b)).toBe(true);
    // a value that merely rounds to the same sign is still a difference
    b[100] = AIR - 1;
    expect(densityEqual(a, b)).toBe(false);
  });

  test("arrays of different lengths are never equal", () => {
    expect(densityEqual(allSolid(), new Int8Array(4).fill(SOLID))).toBe(false);
  });

  test("a real store's chunk compares equal to its own snapshot", () => {
    const s = createFieldStore();
    setDensity(s, 5, 5, 5, AIR);
    const key = chunkKey(0, 0, 0);
    const live = s.chunks.get(key);
    expect(densityEqual(live, Int8Array.from(live ?? []))).toBe(true);
    expect(densityEqual(live, s.chunks.get(chunkKey(9, 9, 9)))).toBe(false);
  });
});
