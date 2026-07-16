import { describe, expect, test } from "bun:test";
import {
  applyOp,
  BUILTIN_TABLE,
  chunkColliders,
  chunkKey,
  createFieldStore,
  getDensity,
} from "@furnace/core/field";

describe("chunkColliders", () => {
  test("uniform chunk yields no collider", () => {
    const s = createFieldStore();
    expect(chunkColliders(s, chunkKey(5, 5, 5))).toBeNull();
  });

  test("a dug chunk yields shell voxels only, all adjacent to air", () => {
    const s = createFieldStore();
    applyOp(
      s,
      {
        id: 1,
        kind: "brush",
        effect: "dig",
        shape: { kind: "sphere", center: [2, 2, 2], radius: 1.4 },
      },
      BUILTIN_TABLE,
    );
    const col = chunkColliders(s, chunkKey(0, 0, 0));
    expect(col).not.toBeNull();
    const c = col as NonNullable<typeof col>;
    expect(c.coords.length).toBeGreaterThan(0);
    expect(c.size).toEqual([0.25, 0.25, 0.25]);
    for (let i = 0; i < c.coords.length; i += 3) {
      const x = c.coords[i] as number;
      const y = c.coords[i + 1] as number;
      const z = c.coords[i + 2] as number;
      // solid itself (global coords = local + chunk base 0)
      expect(getDensity(s, x, y, z)).toBeLessThan(0);
      // at least one of 6 neighbors is air
      const neighbors = [
        getDensity(s, x + 1, y, z),
        getDensity(s, x - 1, y, z),
        getDensity(s, x, y + 1, z),
        getDensity(s, x, y - 1, z),
        getDensity(s, x, y, z + 1),
        getDensity(s, x, y, z - 1),
      ];
      expect(neighbors.some((n) => n >= 0)).toBe(true);
    }
  });
});
