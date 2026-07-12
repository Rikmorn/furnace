// tests/substrate-skin.test.ts
import { expect, test } from "bun:test";
import {
  AIR,
  CELL,
  coarseSet,
  createCoarse,
  MASONRY,
} from "../src/substrate/grid.ts";
import { PANEL_PROUD, variantHash } from "../src/substrate/pieces.ts";
import { faceKey, skinGrid } from "../src/substrate/skin.ts";

/** 3x3x3 coarse box: all MASONRY except the single centre AIR cell. */
function pocketGrid() {
  const g = createCoarse([0, 0, 0], [3, 3, 3], MASONRY);
  coarseSet(g, 1, 1, 1, AIR);
  return g;
}

const instanceCount = (groups: ReturnType<typeof skinGrid>): number =>
  groups.reduce((n, g) => n + g.transforms.length / 16, 0);

test("skin of a 1-cell pocket: 4 wall panels + 1 floor + 1 ceiling tile", () => {
  const groups = skinGrid(pocketGrid(), [], "seed");
  expect(instanceCount(groups)).toBe(6);
});

test("panels sit PROUD of the collision plane, facing the air cell", () => {
  const groups = skinGrid(pocketGrid(), [], "seed");
  // The +X-facing panel backs masonry cell (0,1,1)'s +X face at x = CELL; its
  // centre must sit at x = CELL + PANEL_PROUD/2 + eps INTO the air (< cell mid).
  const xs: number[] = [];
  for (const g of groups)
    for (let i = 0; i < g.transforms.length; i += 16)
      xs.push(g.transforms[i + 12] as number); // column-major: tx at [12]
  const proudX = xs.filter((x) => x > CELL && x < CELL + PANEL_PROUD + 0.01);
  expect(proudX.length).toBeGreaterThan(0);
});

test("suppressed faces emit no panel", () => {
  const suppressed = new Set([faceKey(0, 1, 1, 0)]); // cell (0,1,1), +X face
  const groups = skinGrid(pocketGrid(), [], "seed", suppressed);
  expect(instanceCount(groups)).toBe(5);
});

test("door metadata suppresses panels on door cells and emits frame pieces", () => {
  // Open a 1-cell door in the pocket's -Z wall (cell (1,1,0) becomes AIR when a
  // connector consumes it; the DoorSpec marks the face for frame emission).
  const g = pocketGrid();
  coarseSet(g, 1, 1, 0, AIR);
  const groups = skinGrid(
    g,
    [{ min: [1, 1, 0], size: [1, 1], face: 4 }],
    "seed",
  );
  // Frame pieces exist (jambs + lintel) — more instances than the bare skin
  // of the same two-air-cell grid without door metadata.
  const bare = skinGrid(g, [], "seed");
  expect(instanceCount(groups)).toBeGreaterThan(instanceCount(bare));
});

test("skin is deterministic (byte-identical across runs)", () => {
  const a = skinGrid(pocketGrid(), [], "seed-x");
  const b = skinGrid(pocketGrid(), [], "seed-x");
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect([...(a[i]?.transforms ?? [])]).toEqual([
      ...(b[i]?.transforms ?? []),
    ]);
    expect([...(a[i]?.tints ?? [])]).toEqual([...(b[i]?.tints ?? [])]);
  }
});

test("variantHash: deterministic, in [0,1), not banded on a %5-style cycle", () => {
  expect(variantHash("s", 1, 2, 3, 0)).toBe(variantHash("s", 1, 2, 3, 0));
  const vals = new Set<number>();
  for (let i = 0; i < 25; i++) vals.add(variantHash("s", i, 0, 0, 0));
  expect(vals.size).toBeGreaterThan(20); // a %5 cycle would collapse to 5
  for (const v of vals) expect(v >= 0 && v < 1).toBe(true);
});
