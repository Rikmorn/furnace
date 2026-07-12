import { expect, test } from "bun:test";
import { AIR, CELL, coarseGet, MASONRY } from "../src/substrate/grid.ts";
import { carvePlanForTest, maze } from "../src/themes/maze.ts";

// ── carve plan (the spanning tree + braid, Tasks 2–3) ────────────────────────

test("carve plan: same seed → identical edge set; different seed → differs", () => {
  const a1 = carvePlanForTest(5, 4, 0, "seed-a");
  const a2 = carvePlanForTest(5, 4, 0, "seed-a");
  expect([...a1].sort()).toEqual([...a2].sort());
  const b = carvePlanForTest(5, 4, 0, "seed-b");
  expect([...b].sort()).not.toEqual([...a1].sort());
  // The braid draws are the SECOND rng-consumption site — determinism must hold there too.
  const braided1 = carvePlanForTest(5, 4, 0.5, "seed-a");
  const braided2 = carvePlanForTest(5, 4, 0.5, "seed-a");
  expect([...braided1].sort()).toEqual([...braided2].sort());
});

test("carve plan at braid 0 is a PERFECT maze: connected spanning tree (cells−1 edges)", () => {
  const mx = 6;
  const mz = 5;
  const open = carvePlanForTest(mx, mz, 0, "perfect");
  expect(open.size).toBe(mx * mz - 1);
  // Connectivity: BFS over the open edges must reach every cell.
  const adj = new Map<number, number[]>();
  const link = (p: number, q: number): void => {
    adj.set(p, [...(adj.get(p) ?? []), q]);
    adj.set(q, [...(adj.get(q) ?? []), p]);
  };
  for (const key of open) {
    const m = /^([hv]):(\d+),(\d+)$/.exec(key);
    if (!m) throw new Error(`bad edge key ${key}`);
    const a = Number(m[2]);
    const b = Number(m[3]);
    const cell = b * mx + a;
    link(cell, m[1] === "h" ? cell + 1 : cell + mx);
  }
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const cur = queue.pop();
    if (cur === undefined) break;
    for (const next of adj.get(cur) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  expect(seen.size).toBe(mx * mz);
});

/** Dead-end count of a carve plan: cells with exactly one open edge. */
function deadEnds(open: Set<string>, mx: number, mz: number): number {
  let count = 0;
  for (let cell = 0; cell < mx * mz; cell++) {
    const a = cell % mx;
    const b = (cell - a) / mx;
    const around = [
      `h:${a},${b}`,
      `h:${a - 1},${b}`,
      `v:${a},${b}`,
      `v:${a},${b - 1}`,
    ];
    const degree = around.filter((k) => open.has(k)).length;
    if (degree === 1) count++;
  }
  return count;
}

test("braid 1 opens EVERY dead end (none remain); braid 0 leaves the tree untouched", () => {
  const mx = 6;
  const mz = 6;
  const tree = carvePlanForTest(mx, mz, 0, "braid-seed");
  expect(deadEnds(tree, mx, mz)).toBeGreaterThan(0); // a real tree has dead ends
  const braided = carvePlanForTest(mx, mz, 1, "braid-seed");
  expect(deadEnds(braided, mx, mz)).toBe(0);
  // Braiding only ADDS edges — the tree is a subset of the braided plan.
  for (const k of tree) expect(braided.has(k)).toBe(true);
});

test("braid 0.5 lands strictly between the tree and full braid (same seed)", () => {
  const mx = 8;
  const mz = 8;
  const d0 = deadEnds(carvePlanForTest(mx, mz, 0, "braid-mid"), mx, mz);
  const dHalf = deadEnds(carvePlanForTest(mx, mz, 0.5, "braid-mid"), mx, mz);
  expect(dHalf).toBeLessThan(d0);
  expect(dHalf).toBeGreaterThan(0);
});

// ── maze() stamp assembly (Task 4) ───────────────────────────────────────────

test("maze stamp: dims from pitch (5·m−1 interior + shell), sealed shell, byte-determinism", () => {
  const params = { cells: [4, 3] as [number, number], braid: 0, doors: [] };
  const s1 = maze(params, "stamp-seed");
  // Interior 5·4−1=19 × 5·3−1=14, height 6; +2 shell each axis.
  expect(s1.coarse.dims).toEqual([21, 8, 16]);
  expect(s1.coarse.min).toEqual([0, -CELL, 0]);
  // The shell is fully sealed at stamp time: every boundary cell is MASONRY.
  const [dx, dy, dz] = s1.coarse.dims;
  for (let j = 0; j < dy; j++)
    for (let i = 0; i < dx; i++) {
      expect(coarseGet(s1.coarse, i, j, 0)).toBe(MASONRY);
      expect(coarseGet(s1.coarse, i, j, dz - 1)).toBe(MASONRY);
    }
  for (let j = 0; j < dy; j++)
    for (let k = 0; k < dz; k++) {
      expect(coarseGet(s1.coarse, 0, j, k)).toBe(MASONRY);
      expect(coarseGet(s1.coarse, dx - 1, j, k)).toBe(MASONRY);
    }
  // Byte-determinism: same params+seed → identical cells.
  const s2 = maze(params, "stamp-seed");
  expect(
    Buffer.from(s2.coarse.cells).equals(Buffer.from(s1.coarse.cells)),
  ).toBe(true);
  expect(
    Buffer.from(maze(params, "other-seed").coarse.cells).equals(
      Buffer.from(s1.coarse.cells),
    ),
  ).toBe(false);
});

test("maze stamp: every cell block is AIR; walls between cells match the carve plan", () => {
  const mx = 4;
  const mz = 4;
  const params = { cells: [mx, mz] as [number, number], braid: 0, doors: [] };
  const seed = "plan-match";
  const stamp = maze(params, seed);
  const open = carvePlanForTest(mx, mz, 0, seed);
  // Cell (a,b) centre column must be AIR at the walk layer.
  for (let b = 0; b < mz; b++)
    for (let a = 0; a < mx; a++) {
      expect(coarseGet(stamp.coarse, 1 + 5 * a + 2, 1, 1 + 5 * b + 2)).toBe(
        AIR,
      );
    }
  // The wall band between horizontally adjacent cells: AIR iff `h:a,b` is open.
  for (let b = 0; b < mz; b++)
    for (let a = 0; a < mx - 1; a++) {
      const wallI = 1 + 5 * a + 4; // the 1-cell band between block a and block a+1
      const midK = 1 + 5 * b + 2;
      const want = open.has(`h:${a},${b}`) ? AIR : MASONRY;
      expect(coarseGet(stamp.coarse, wallI, 1, midK)).toBe(want);
    }
  // And vertically: AIR iff `v:a,b` is open.
  for (let b = 0; b < mz - 1; b++)
    for (let a = 0; a < mx; a++) {
      const midI = 1 + 5 * a + 2;
      const wallK = 1 + 5 * b + 4;
      const want = open.has(`v:${a},${b}`) ? AIR : MASONRY;
      expect(coarseGet(stamp.coarse, midI, 1, wallK)).toBe(want);
    }
});

test("maze doors: maze-cell offsets index passage columns; portals pair with doorSpecs; approach lane validates", () => {
  const stamp = maze(
    {
      cells: [4, 4],
      braid: 0,
      doors: [
        { wall: "south", offset: 1 },
        { wall: "east", offset: 2 },
      ],
    },
    "door-seed",
  );
  expect(stamp.portals.length).toBe(2);
  expect(stamp.doorSpecs.length).toBe(2);
  // South door, offset 1 → coarse lo = 1 + 5·1 = 6 → threshold centre x = 6·0.5+1 = 4.0,
  // on the outer shell plane z = 0, facing exact south.
  const south = stamp.portals[0];
  if (!south) throw new Error("no south portal");
  expect(south.position).toEqual([4, 0, 0]);
  expect(south.facing).toEqual([0, 0, -1]);
  expect(south.width).toBeCloseTo(2.0, 9);
  expect(south.height).toBeCloseTo(3.0, 9);
  expect(south.kind).toBe("door");
  // East door, offset 2 → coarse lo = 11 → z centre 6.5, x on the far plane 21·0.5 = 10.5.
  const east = stamp.portals[1];
  if (!east) throw new Error("no east portal");
  expect(east.position).toEqual([10.5, 0, 6.5]);
  expect(east.facing).toEqual([1, 0, 0]);
});

test("maze setup-loud validation: cells, braid, door offsets, duplicate doors", () => {
  const doors: { wall: "north"; offset: number }[] = [];
  expect(() => maze({ cells: [1, 4], braid: 0, doors }, "s")).toThrow(/cells/);
  expect(() =>
    maze({ cells: [4.5, 4] as [number, number], braid: 0, doors }, "s"),
  ).toThrow(/cells/);
  expect(() => maze({ cells: [4, 4], braid: 1.5, doors }, "s")).toThrow(
    /braid/,
  );
  // NaN braid must be REJECTED, not silently full-braided (`NaN < 0` and `NaN > 1`
  // are both false — a bare range test lets it through).
  expect(() => maze({ cells: [4, 4], braid: Number.NaN, doors }, "s")).toThrow(
    /braid/,
  );
  expect(() =>
    maze(
      { cells: [4, 4], braid: 0, doors: [{ wall: "north", offset: 4 }] },
      "s",
    ),
  ).toThrow(/offset/);
  expect(() =>
    maze(
      { cells: [4, 4], braid: 0, doors: [{ wall: "north", offset: -1 }] },
      "s",
    ),
  ).toThrow(/offset/);
  expect(() =>
    maze(
      {
        cells: [4, 4],
        braid: 0,
        doors: [
          { wall: "north", offset: 2 },
          { wall: "north", offset: 2 },
        ],
      },
      "s",
    ),
  ).toThrow(/duplicate/);
});

test("maze anchors: dressable rects exist, exclude door lanes, and dressing is rubble-only", () => {
  const withDoor = maze(
    { cells: [4, 4], braid: 0, doors: [{ wall: "south", offset: 1 }] },
    "anchor-seed",
  );
  expect(withDoor.anchors.length).toBeGreaterThan(0);
  // The south door's lane (x 3..5, z 0..3 world-local) must contain NO anchor rect.
  for (const r of withDoor.anchors) {
    const inLane = r.minX < 5 && r.maxX > 3 && r.z0 < 3 && r.z1 > 0;
    expect(inLane).toBe(false);
  }
  // Plan refinement 3: the maze declares its own dressing (rubble only, no dynamic
  // crates in 2.0 m passages).
  expect(withDoor.dressingLayers?.length).toBe(1);
  expect(withDoor.dressingLayers?.[0]?.name).toBe("mazeRubble");
  expect(withDoor.dressingLayers?.[0]?.collision).toBeUndefined();
});
