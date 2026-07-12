import { expect, test } from "bun:test";
import { carvePlanForTest } from "../src/themes/maze.ts";

// ── carve plan (the spanning tree + braid, Tasks 2–3) ────────────────────────

test("carve plan: same seed → identical edge set; different seed → differs", () => {
  const a1 = carvePlanForTest(5, 4, 0, "seed-a");
  const a2 = carvePlanForTest(5, 4, 0, "seed-a");
  expect([...a1].sort()).toEqual([...a2].sort());
  const b = carvePlanForTest(5, 4, 0, "seed-b");
  expect([...b].sort()).not.toEqual([...a1].sort());
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
