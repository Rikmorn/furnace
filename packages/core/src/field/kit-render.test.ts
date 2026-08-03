import { expect, test } from "bun:test";
import type {
  KitInstance,
  MaterialTable,
  PlacementRecord,
} from "@furnace/core/field";
import {
  packKitMatrices,
  packPlacementMatrices,
  pieceColor,
} from "@furnace/core/field";
// yawQuat + PIECE_COLOR_KEY are module-internal helpers (not on the public
// @furnace/core/field surface — no consumer needs them directly); the pure-math
// tests reach them through the source module, matching the field-chunks /
// field-cave test pattern.
import { PIECE_COLOR_KEY, yawQuat } from "./kit-render.ts";

// 3-class fixture: rock (id0 organic), dirt (id1 organic), masonry (id2 kit) —
// mirrors the field-protocol.test.ts table.
const TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
    {
      id: 2,
      name: "masonry",
      kind: "kit",
      color: [0.5, 0.5, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.4, 0.4, 0.4, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
};

const inst = (
  piece: KitInstance["piece"],
  classId: number,
  variant: number,
): KitInstance => ({
  piece,
  classId,
  position: [0, 0, 0],
  yaw: 0,
  box: [1, 1, 1],
  variant,
});

// --- yawQuat ---------------------------------------------------------------

test("yawQuat: exact quarter-turn table (0, ±90°, 180°)", () => {
  const s = Math.fround(Math.SQRT1_2);
  expect([...yawQuat(0)]).toEqual([0, 0, 0, 1]);
  expect([...yawQuat(Math.PI / 2)]).toEqual([0, s, 0, s]);
  expect([...yawQuat(Math.PI)]).toEqual([0, 1, 0, 0]);
  expect([...yawQuat(-Math.PI / 2)]).toEqual([0, -s, 0, s]);
});

test("yawQuat: wraps and rounds to the nearest quarter turn", () => {
  expect(yawQuat((3 * Math.PI) / 2)).toBe(yawQuat(-Math.PI / 2)); // 270° = -90°
  expect(yawQuat(-Math.PI)).toBe(yawQuat(Math.PI)); // -180° = 180°
  expect(yawQuat(2 * Math.PI)).toBe(yawQuat(0)); // full turn
  expect(yawQuat(Math.PI / 2 + 0.2)).toBe(yawQuat(Math.PI / 2)); // nearest
});

// --- PIECE_COLOR_KEY -------------------------------------------------------

test("PIECE_COLOR_KEY: piece kind → KitStyle.pieceColors bucket", () => {
  expect(PIECE_COLOR_KEY).toEqual({
    panel: "panel",
    floorTile: "floor",
    ceilTile: "floor",
    post: "trim",
    rimPostV: "collar",
    rimEdgeH: "collar",
  });
});

// --- pieceColor ------------------------------------------------------------

test("pieceColor: panel colour × jitter, variant 0 = ×0.92 lower bound", () => {
  const c = pieceColor(TABLE, inst("panel", 2, 0));
  expect(c[0]).toBeCloseTo(0.55 * 0.92, 6);
  expect(c[1]).toBeCloseTo(0.53 * 0.92, 6);
  expect(c[2]).toBeCloseTo(0.5 * 0.92, 6);
  expect(c[3]).toBe(1); // alpha carried through, not jittered
});

test("pieceColor: variant 1 = ×1.08 upper bound (0.92 + 0.16·v)", () => {
  const c = pieceColor(TABLE, inst("panel", 2, 1));
  expect(c[0]).toBeCloseTo(0.55 * 1.08, 6);
  expect(c[1]).toBeCloseTo(0.53 * 1.08, 6);
  expect(c[2]).toBeCloseTo(0.5 * 1.08, 6);
});

test("pieceColor: ceilTile shares the floor bucket; post takes trim", () => {
  const ceil = pieceColor(TABLE, inst("ceilTile", 2, 0.5)); // j = 1.0
  expect(ceil[0]).toBeCloseTo(0.42, 6);
  const post = pieceColor(TABLE, inst("post", 2, 0.5));
  expect(post[0]).toBeCloseTo(0.35, 6);
});

test("pieceColor: non-kit class → white passthrough", () => {
  expect(pieceColor(TABLE, inst("panel", 1, 0))).toEqual([1, 1, 1, 1]);
});

// --- packKitMatrices -------------------------------------------------------

test("packKitMatrices: yaw-0 panel → exact column-major TRS floats", () => {
  const kit: KitInstance[] = [
    {
      piece: "panel",
      classId: 2,
      position: [1.5, 2.25, -3],
      yaw: 0,
      box: [2, 0.5, 4],
      variant: 0,
    },
  ];
  const packed = packKitMatrices(kit, [16, 0, -16]);
  expect(packed.length).toBe(16);
  // biome-ignore format: 4×4 column layout aids visual scanning
  expect([...packed]).toEqual([
    2,    0,    0,   0, // col 0: x basis × sx
    0,    0.5,  0,   0, // col 1: y basis × sy
    0,    0,    4,   0, // col 2: z basis × sz
    17.5, 2.25, -19, 1, // col 3: translation = position + origin
  ]);
});

test("packKitMatrices: +90° yaw rotates the basis about +Y", () => {
  const kit: KitInstance[] = [
    {
      piece: "post",
      classId: 2,
      position: [0, 0, 0],
      yaw: Math.PI / 2,
      box: [2, 3, 4],
      variant: 0,
    },
  ];
  const p = packKitMatrices(kit, [0, 0, 0]);
  // x column → −Z (scaled sx); y column unchanged; z column → +X (scaled sz).
  expect(p[0]).toBeCloseTo(0, 5);
  expect(p[2]).toBeCloseTo(-2, 5);
  expect(p[5]).toBeCloseTo(3, 5);
  expect(p[8]).toBeCloseTo(4, 5);
  expect(p[10]).toBeCloseTo(0, 5);
  expect(p[15]).toBe(1);
});

test("packKitMatrices: N instances pack 16 floats each at i·16", () => {
  const a: KitInstance = {
    piece: "panel",
    classId: 2,
    position: [1, 0, 0],
    yaw: 0,
    box: [1, 1, 1],
    variant: 0,
  };
  const b: KitInstance = { ...a, position: [0, 5, 0] };
  const packed = packKitMatrices([a, b], [10, 10, 10]);
  expect(packed.length).toBe(32);
  expect(packed[12]).toBe(11); // a translation
  expect(packed[16 + 13]).toBe(15); // b translation, second 16-float block
});

test("packKitMatrices: empty kit → empty array", () => {
  expect(packKitMatrices([], [0, 0, 0]).length).toBe(0);
});

// --- packPlacementMatrices -------------------------------------------------

const placement = (
  quat: [number, number, number, number],
  position: [number, number, number],
  scale: [number, number, number],
): PlacementRecord => ({
  archetypeId: "barrel",
  position,
  quat,
  scale,
  variantIndex: 0,
});

test("packPlacementMatrices: identity quat + unit scale → translation-only", () => {
  const packed = packPlacementMatrices([
    placement([0, 0, 0, 1], [3, 4, 5], [1, 1, 1]),
  ]);
  expect(packed.length).toBe(16);
  // biome-ignore format: 4×4 column layout aids visual scanning
  expect([...packed]).toEqual([
    1, 0, 0, 0, // col 0: identity x basis
    0, 1, 0, 0, // col 1: identity y basis
    0, 0, 1, 0, // col 2: identity z basis
    3, 4, 5, 1, // col 3: pure translation
  ]);
});

test("packPlacementMatrices: +90° yaw quat matches packKitMatrices' layout", () => {
  // Same quarter-turn quat + box that packKitMatrices' +90° test uses, so the
  // two packers are proven to share matrix layout + winding (render-identical).
  const s = Math.SQRT1_2;
  const p = packPlacementMatrices([
    placement([0, s, 0, s], [0, 0, 0], [2, 3, 4]),
  ]);
  expect(p[0]).toBeCloseTo(0, 5);
  expect(p[2]).toBeCloseTo(-2, 5);
  expect(p[5]).toBeCloseTo(3, 5);
  expect(p[8]).toBeCloseTo(4, 5);
  expect(p[10]).toBeCloseTo(0, 5);
  expect(p[15]).toBe(1);
});

test("packPlacementMatrices: byte-identical to packKitMatrices under the same transform", () => {
  // A quarter-turn kit instance and an equivalent placement record (yaw→quat,
  // box→scale, same world position, origin 0) must pack to the SAME 16 floats.
  const s = Math.SQRT1_2;
  const kit = packKitMatrices(
    [
      {
        piece: "panel",
        classId: 2,
        position: [1, 2, 3],
        yaw: Math.PI / 2,
        box: [2, 3, 4],
        variant: 0,
      },
    ],
    [0, 0, 0],
  );
  const plc = packPlacementMatrices([
    placement([0, s, 0, s], [1, 2, 3], [2, 3, 4]),
  ]);
  expect([...plc]).toEqual([...kit]);
});

test("packPlacementMatrices: N records pack 16 floats each at i·16", () => {
  const a = placement([0, 0, 0, 1], [1, 2, 3], [1, 1, 1]);
  const b = placement([0, 0, 0, 1], [7, 8, 9], [1, 1, 1]);
  const packed = packPlacementMatrices([a, b]);
  expect(packed.length).toBe(32);
  expect(packed[12]).toBe(1); // a translation.x
  expect(packed[13]).toBe(2);
  expect(packed[14]).toBe(3);
  expect(packed[16 + 12]).toBe(7); // b translation, second 16-float block
  expect(packed[16 + 13]).toBe(8);
  expect(packed[16 + 14]).toBe(9);
});

test("packPlacementMatrices: empty records → empty array", () => {
  expect(packPlacementMatrices([]).length).toBe(0);
});
