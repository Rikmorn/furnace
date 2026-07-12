// tests/substrate-skin.test.ts
import { expect, test } from "bun:test";
import {
  AIR,
  CELL,
  coarseSet,
  createCoarse,
  MASONRY,
} from "../src/substrate/grid.ts";
import {
  PANEL_PROUD,
  PIECE_BOX,
  variantHash,
} from "../src/substrate/pieces.ts";
import { type DoorSpec, faceKey, skinGrid } from "../src/substrate/skin.ts";
import { DOOR_H_CELLS, DOOR_W_CELLS } from "../src/themes/grid-stamp.ts";

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

/** Per-axis WORLD span of a baked TRS instance: the sum of |components| across the three
 *  scaled basis columns (exact under the kit's quarter-turn yaws). */
function instanceSpans(t: Float32Array, i: number): [number, number, number] {
  const axis = (r: number): number =>
    Math.abs(t[i + r] as number) +
    Math.abs(t[i + 4 + r] as number) +
    Math.abs(t[i + 8 + r] as number);
  return [axis(0), axis(1), axis(2)];
}

const LINTEL_LEN = Math.max(...PIECE_BOX.lintel); // door width + jamb cover

/** The world spans of the ONE lintel a door emits. Frames come from door METADATA alone
 *  (skin.ts header), so a solid grid emits exactly that door's 2 jambs + 1 lintel — and the
 *  lintel is the only kit piece as long as LINTEL_LEN (a jamb is 3.0 tall × 0.1). */
function lintelSpans(face: DoorSpec["face"]): [number, number, number] {
  const g = createCoarse([0, 0, 0], [8, 8, 8], MASONRY);
  const door: DoorSpec = {
    min: [2, 1, 2],
    size: [DOOR_W_CELLS, DOOR_H_CELLS],
    face,
  };
  const found: [number, number, number][] = [];
  for (const group of skinGrid(g, [door], "seed"))
    for (let i = 0; i < group.transforms.length; i += 16) {
      const spans = instanceSpans(group.transforms, i);
      if (Math.abs(Math.max(...spans) - LINTEL_LEN) < 1e-6) found.push(spans);
    }
  expect(found.length).toBe(1);
  return found[0] as [number, number, number];
}

test("door lintel BRIDGES the opening: its length lies on the WALL axis, not the door normal", () => {
  // FACE_YAW seats a piece's local +X onto the door NORMAL, so a lintel carrying its length
  // on local +X runs 2.2 m straight THROUGH its own doorway (and out the far side of both
  // rooms) instead of spanning the wall. The wall axis is Z for a ±X-facing door and X for a
  // ±Z-facing door (skin.ts `doorCell` / `alongWall`) — assert both, plus thinness across
  // the opening and in height, so the length cannot silently migrate to another axis.
  const cases = [
    { face: 4, wallAxis: 0, normalAxis: 2 }, // +Z-facing door → wall runs on X
    { face: 0, wallAxis: 2, normalAxis: 0 }, // +X-facing door → wall runs on Z
  ] as const;
  for (const { face, wallAxis, normalAxis } of cases) {
    const spans = lintelSpans(face);
    expect(spans[wallAxis]).toBeCloseTo(LINTEL_LEN, 6);
    expect(spans[normalAxis]).toBeLessThan(CELL); // thin THROUGH the doorway
    expect(spans[1]).toBeLessThan(CELL); // thin in height
  }
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
