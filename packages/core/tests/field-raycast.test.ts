import { describe, expect, test } from "bun:test";
import {
  applyOp,
  BUILTIN_TABLE,
  createFieldStore,
  raycastField,
} from "@furnace/core/field";
import { at } from "./_helpers/expect.ts";

describe("raycastField", () => {
  test("a ray inside a dug cavity hits the far wall", () => {
    const s = createFieldStore();
    applyOp(
      s,
      {
        id: 1,
        kind: "brush",
        effect: "dig",
        shape: { kind: "sphere", center: [2, 2, 2], radius: 1.5 },
      },
      BUILTIN_TABLE,
    );
    const hit = raycastField(s, [2, 2, 2], [1, 0, 0], 10);
    expect(hit).not.toBeNull();
    // wall is ~1.5 m out (quantization slop one cell either way)
    expect(
      Math.abs(at((hit as { point: number[] }).point, 0) - 3.5),
    ).toBeLessThan(0.5);
  });

  test("a ray in solid rock hits immediately; maxDist misses return null", () => {
    const s = createFieldStore();
    expect(raycastField(s, [50, 50, 50], [1, 0, 0], 5)).not.toBeNull();
    applyOp(
      s,
      {
        id: 1,
        kind: "brush",
        effect: "dig",
        shape: { kind: "box", center: [2, 2, 2], halfExtents: [1.5, 1.5, 1.5] },
      },
      BUILTIN_TABLE,
    );
    expect(raycastField(s, [2, 2, 2], [1, 0, 0], 0.5)).toBeNull();
  });
});

describe("raycastField — maxY slice clip", () => {
  test("a downward ray from above the clip passes through clipped rock and hits the first sub-clip voxel", () => {
    const s = createFieldStore(); // virgin rock everywhere
    // cellSize 0.25: voxels whose base y = iy·0.25 ≥ maxY read as air. With
    // maxY 1, iy ≥ 4 is clipped — INCLUDING the eye's own rock voxel (iy 12),
    // so the start-in-rock t=0 branch must not fire — and iy 4 (base exactly
    // 1.0) pins the ≥ boundary. First sub-clip voxel: iy 3, entered through
    // its top face at world y = 1.
    const hit = raycastField(s, [2, 3, 2], [0, -1, 0], 10, { maxY: 1 });
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(hit.voxel).toEqual([8, 3, 8]);
    // prev is the clipped voxel above — clipped rock counts as air for prev
    expect(hit.prev).toEqual([8, 4, 8]);
    expect(hit.point[0]).toBeCloseTo(2, 5);
    expect(hit.point[1]).toBeCloseTo(1, 5);
    expect(hit.point[2]).toBeCloseTo(2, 5);
  });

  test("without opts the same ray is byte-identical to the unclipped contract: own voxel at t=0", () => {
    const s = createFieldStore();
    const hit = raycastField(s, [2, 3, 2], [0, -1, 0], 10);
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(hit.voxel).toEqual([8, 12, 8]);
    expect(hit.point).toEqual([2, 3, 2]);
  });

  test("a horizontal ray entirely above the clip traverses clipped rock to maxDist and misses", () => {
    const s = createFieldStore();
    expect(raycastField(s, [2, 3, 2], [1, 0, 0], 5, { maxY: 1 })).toBeNull();
  });

  test("a non-lattice-aligned maxY clips by voxel BASE: a straddling voxel still hits", () => {
    const s = createFieldStore(); // virgin rock everywhere
    // maxY 0.9 is between voxel 3's base (0.75) and top (1.0): base semantics
    // keep iy 3 SOLID (0.75 < 0.9) while iy ≥ 4 is clipped (1.0 ≥ 0.9) — a
    // continuous interpretation would treat the straddling voxel's upper band
    // as air. The hit point (its top face, y = 1) lies ABOVE the clip plane,
    // which is exactly what pins the by-base contract.
    const hit = raycastField(s, [2, 3, 2], [0, -1, 0], 10, { maxY: 0.9 });
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(hit.voxel).toEqual([8, 3, 8]);
    expect(hit.point[1]).toBeCloseTo(1, 5);
  });

  test("clip active but the ray fully below it: unclipped behaviour, own rock voxel at t=0", () => {
    // The everyday slice-view configuration (Task 12): the clip plane sits
    // ABOVE the ray — sub-clip voxels must be untouched by the clamp, so a
    // start inside sub-clip rock still self-hits at t=0.
    const s = createFieldStore(); // virgin rock everywhere
    const hit = raycastField(s, [2, 0.5, 2], [1, 0, 0], 5, { maxY: 1 });
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(hit.voxel).toEqual([8, 2, 8]); // 0.5 / cellSize 0.25 = iy 2, base y 0.5 < 1
    expect(hit.point).toEqual([2, 0.5, 2]); // t=0 → the origin itself
  });
});
