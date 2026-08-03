import { describe, expect, test } from "bun:test";
import type { FieldStore } from "@furnace/core/field";
import {
  CHUNK_DIM,
  type ChunkMaterials,
  chunkKey,
  cloneChunkMaterials,
  createFieldStore,
  getMaterial,
  MAT_ROCK,
  setMaterial,
} from "@furnace/core/field";
// materialsEqual is deliberately NOT on the public index — in-core surface the
// reconfigure drift comparator consumes.
import { materialsEqual } from "./materials.ts";

/** Any non-rock class id; this file has no material TABLE (the accessors never
 *  resolve ids), so the value only has to differ from MAT_ROCK. */
const MASONRY = 2;

describe("field material channel", () => {
  test("unallocated space reads MAT_ROCK", () => {
    const s = createFieldStore();
    expect(getMaterial(s, 5, -3, 900)).toBe(MAT_ROCK);
  });

  test("uniform set then divergence upgrades to indexed", () => {
    const s = createFieldStore();
    setMaterial(s, 1, 1, 1, 2);
    expect(getMaterial(s, 1, 1, 1)).toBe(2);
    expect(getMaterial(s, 1, 1, 2)).toBe(MAT_ROCK);
    setMaterial(s, 1, 1, 2, 3);
    expect(getMaterial(s, 1, 1, 1)).toBe(2);
    expect(getMaterial(s, 1, 1, 2)).toBe(3);
    expect(getMaterial(s, 0, 0, 0)).toBe(MAT_ROCK);
  });

  test("property: accessor matches a dense reference model", () => {
    const s = createFieldStore();
    const ref = new Map<string, number>();
    let h = 12345;
    const next = (n: number) => {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      return h % n;
    };
    for (let i = 0; i < 5000; i++) {
      const x = next(40) - 8;
      const y = next(40) - 8;
      const z = next(40) - 8;
      const c = next(6);
      setMaterial(s, x, y, z, c);
      ref.set(`${x},${y},${z}`, c);
    }
    for (const [k, v] of ref) {
      const [x, y, z] = k.split(",").map(Number) as [number, number, number];
      expect(getMaterial(s, x, y, z)).toBe(v);
    }
  });

  test("setMaterial returns the chunk key (the dirty unit)", () => {
    const s = createFieldStore();
    expect(setMaterial(s, CHUNK_DIM, 0, 0, 1)).toBe(chunkKey(1, 0, 0));
  });

  const asIndexed = (
    m: ChunkMaterials | undefined,
  ): Extract<ChunkMaterials, { kind: "indexed" }> => {
    if (m === undefined || m.kind !== "indexed")
      throw new Error("expected an indexed ChunkMaterials");
    return m;
  };

  test("cloneChunkMaterials is a deep copy (undo-snapshot isolation)", () => {
    const s = createFieldStore();
    setMaterial(s, 0, 0, 0, 1);
    setMaterial(s, 0, 0, 1, 2);
    const original = asIndexed(s.materials.get(chunkKey(0, 0, 0)));
    const clone = asIndexed(cloneChunkMaterials(original));

    // Distinct backing buffers, equal contents at clone time.
    expect(clone.packed).not.toBe(original.packed);
    expect(clone.palette).not.toBe(original.palette);
    expect(Array.from(clone.packed)).toEqual(Array.from(original.packed));
    expect(Array.from(clone.palette)).toEqual(Array.from(original.palette));

    // Mutating the clone must not touch the original.
    const origPacked0 = original.packed[0] as number;
    const origPalette1 = original.palette[1] as number;
    clone.packed[0] = (origPacked0 ^ 0xff) & 0xff;
    clone.palette[1] = origPalette1 + 7;
    expect(original.packed[0]).toBe(origPacked0);
    expect(original.palette[1]).toBe(origPalette1);

    // ...and the reverse: mutating the original must not touch the clone.
    const clonePacked0 = clone.packed[0] as number;
    original.packed[0] = (origPacked0 ^ 0x0f) & 0xff;
    expect(clone.packed[0]).toBe(clonePacked0);
  });
});

// The drift report's material leg. The SAME logical content has several
// storage spellings (absent entry / uniform rock / an indexed chunk whose every
// cell resolves to rock), so a structural compare would invent drift findings a
// user cannot act on.
describe("materialsEqual — representation-independent comparison", () => {
  /** All-rock content in the INDEXED spelling: diverge, then converge back. */
  const indexedRock = (store: FieldStore): ChunkMaterials => {
    setMaterial(store, 0, 0, 0, MASONRY);
    setMaterial(store, 0, 0, 0, MAT_ROCK);
    const m = store.materials.get("0,0,0");
    if (m === undefined) throw new Error("test: expected a material entry");
    return m;
  };

  test("absent, uniform-rock and all-rock-indexed chunks all compare equal", () => {
    const indexed = indexedRock(createFieldStore());
    expect(indexed.kind).toBe("indexed"); // otherwise the case is vacuous
    const uniform: ChunkMaterials = { kind: "uniform", classId: MAT_ROCK };
    expect(materialsEqual(undefined, uniform)).toBe(true);
    expect(materialsEqual(undefined, indexed)).toBe(true);
    expect(materialsEqual(uniform, indexed)).toBe(true);
    expect(materialsEqual(null, undefined)).toBe(true);
  });

  test("a single differing cell compares unequal", () => {
    const store = createFieldStore();
    setMaterial(store, 3, 4, 5, MASONRY);
    const painted = store.materials.get("0,0,0");
    expect(
      materialsEqual(painted, { kind: "uniform", classId: MAT_ROCK }),
    ).toBe(false);
    expect(materialsEqual(painted, undefined)).toBe(false);
    expect(materialsEqual(painted, painted)).toBe(true);
    expect(getMaterial(store, 3, 4, 5)).toBe(MASONRY);
  });
});
