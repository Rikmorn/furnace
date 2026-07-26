// A differential test for the ONE claim in `detectPits` that its fixtures cannot
// prove: that the reverse flood's `fallSources` enumeration is the EXACT TRANSPOSE
// of the forward flood's `fallTargets`, and not an approximation of it. The two
// are written differently on purpose — one probe down per direction versus a scan
// of the air pocket — so a hand-picked fixture can agree with both while a real
// world does not.
//
// The reference here builds the D-F4-18 edge rule the slow, obvious way: every
// node, every edge, an explicitly transposed adjacency map, two textbook BFS. Then
// it compares REGIONS (anchor + size), which is the whole pipeline's output, over
// random terrain that is dense in one-way drops. If the lazy enumeration ever
// stops being the transpose, this is what says so.
import { describe, expect, test } from "bun:test";
import type { AgentProfile, FieldStore } from "@furnace/core/field";
import {
  AIR,
  createFieldStore,
  DEFAULT_CELL_SIZE,
  detectPits,
  getDensity,
  SOLID,
  setDensity,
} from "@furnace/core/field";

const AGENT: AgentProfile = {
  capsule: { radius: 0.3, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 1.8,
  slopeLimitDeg: 55,
  skin: 0.08,
};
/** `floor(0.7 / 0.25)` — the climb band, in cells, as the module derives it. */
const CLIMB_CELLS = 2;
/** Edge of the random box. Everything outside it is rock: past 16 the chunk is
 *  allocated but unwritten (SOLID), and below 0 the chunk is unallocated (also
 *  SOLID), so the terrain is sealed without a margin fixture. */
const BOX = 12;
const STORES = 120;
/** Ground height cap — low ground plus tall air gives long one-way drops. */
const GROUND_MAX = 5;

const solidAt = (s: FieldStore, x: number, y: number, z: number): boolean =>
  getDensity(s, x, y, z) < 0;
const isAnchor = (s: FieldStore, x: number, y: number, z: number): boolean =>
  !solidAt(s, x, y, z) && solidAt(s, x, y - 1, z);
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const parse = (k: string): [number, number, number] => {
  const p = k.split(",").map(Number);
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
};

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Mulberry32, so a failure names a reproducible store. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random terrain: a per-column ground height with noisy air above it, which
 *  grows shelves, shafts and dead drops far denser than any real cave. */
function randomStore(seed: number, airBias: number): FieldStore {
  const rand = rng(seed);
  const s = createFieldStore(DEFAULT_CELL_SIZE);
  for (let z = 0; z < BOX; z++)
    for (let x = 0; x < BOX; x++) {
      const ground = Math.floor(rand() * GROUND_MAX);
      for (let y = 0; y < BOX; y++)
        setDensity(s, x, y, z, y > ground && rand() < airBias ? AIR : SOLID);
    }
  return s;
}

const push = (m: Map<string, string[]>, k: string, v: string): void => {
  const list = m.get(k);
  if (list === undefined) m.set(k, [v]);
  else list.push(v);
};

function flood(
  adj: ReadonlyMap<string, string[]>,
  seeds: string[],
): Set<string> {
  const seen = new Set(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const cur = queue.pop();
    if (cur === undefined) break;
    for (const next of adj.get(cur) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return seen;
}

/** `${anchor}#${size}` for every pit region, the slow way. */
function referenceRegions(s: FieldStore, seed: string): string[] {
  const nodes: string[] = [];
  for (let z = 0; z < BOX; z++)
    for (let y = 0; y < BOX; y++)
      for (let x = 0; x < BOX; x++)
        if (isAnchor(s, x, y, z)) nodes.push(key(x, y, z));
  const present = new Set(nodes);

  const edges: [string, string][] = [];
  for (const node of nodes) {
    const [x, y, z] = parse(node);
    for (const [dx, dz] of DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      // Climb band: within climbCeiling, both ways.
      for (let ny = y - CLIMB_CELLS; ny <= y + CLIMB_CELLS; ny++)
        if (present.has(key(nx, ny, nz))) {
          edges.push([node, key(nx, ny, nz)]);
          edges.push([key(nx, ny, nz), node]);
        }
      // Walking off the edge: one way, high to low, no distance limit.
      if (solidAt(s, nx, y, nz)) continue;
      let ny = y;
      while (!solidAt(s, nx, ny - 1, nz)) ny--;
      if (ny < y - CLIMB_CELLS && present.has(key(nx, ny, nz)))
        edges.push([node, key(nx, ny, nz)]);
    }
  }

  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const [a, b] of edges) {
    push(forward, a, b);
    push(reverse, b, a);
  }
  const enterable = flood(forward, [seed]);
  const canReturn = flood(reverse, [seed]);
  const trapped = new Set([...enterable].filter((n) => !canReturn.has(n)));

  const undirected = new Map<string, string[]>();
  for (const [a, b] of edges) {
    if (!trapped.has(a) || !trapped.has(b)) continue;
    push(undirected, a, b);
    push(undirected, b, a);
  }
  const claimed = new Set<string>();
  const out: string[] = [];
  for (const start of trapped) {
    if (claimed.has(start)) continue;
    const region = flood(undirected, [start]);
    let anchor = parse(start);
    for (const k of region) {
      const c = parse(k);
      const lower =
        c[1] < anchor[1] ||
        (c[1] === anchor[1] &&
          (c[0] < anchor[0] || (c[0] === anchor[0] && c[2] < anchor[2])));
      if (lower) anchor = c;
      claimed.add(k);
    }
    out.push(`${anchor.join(",")}#${region.size}`);
  }
  return out.sort();
}

/** The first floor anchor in scan order, as the WORLD position a seed is. */
function firstAnchorWorld(s: FieldStore): [number, number, number] | undefined {
  for (let z = 0; z < BOX; z++)
    for (let y = 0; y < BOX; y++)
      for (let x = 0; x < BOX; x++)
        if (isAnchor(s, x, y, z))
          return [
            (x + 0.5) * DEFAULT_CELL_SIZE,
            (y + 0.5) * DEFAULT_CELL_SIZE,
            (z + 0.5) * DEFAULT_CELL_SIZE,
          ];
  return undefined;
}

describe("detectPits — differential against a brute-forced transpose", () => {
  test("every region matches, over random one-way terrain", () => {
    let storesWithPits = 0;
    let regions = 0;
    for (let seed = 1; seed <= STORES; seed++) {
      const store = randomStore(seed, 0.55 + (seed % 5) * 0.08);
      const world = firstAnchorWorld(store);
      if (world === undefined) continue;
      const cell = world.map((w) => Math.floor(w / DEFAULT_CELL_SIZE));
      const reference = referenceRegions(
        store,
        key(cell[0] ?? 0, cell[1] ?? 0, cell[2] ?? 0),
      );
      const got = detectPits(store, AGENT, [world])
        .map((f) => `${f.cell.join(",")}#${f.cells}`)
        .sort();
      // Tagged with the seed so a failure names the store to reproduce.
      expect([seed, got]).toEqual([seed, reference]);
      if (reference.length > 0) storesWithPits++;
      regions += reference.length;
    }
    // Vacuity guard: the corpus has to CONTAIN traps, or agreeing proves nothing.
    // Measured 2026-07-26: 53 of 120 stores, 80 regions.
    expect(storesWithPits).toBeGreaterThan(10);
    expect(regions).toBeGreaterThan(20);
  });
});
