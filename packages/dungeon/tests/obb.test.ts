import { describe, expect, test } from "bun:test";
import {
  type Obb,
  obbFromLocalAabb,
  obbIntersects,
  obbOfAabb,
} from "../src/aabb.ts";

const box = (
  cx: number,
  cz: number,
  hx: number,
  hz: number,
  yaw: number,
): Obb => ({
  center: [cx, 1, cz],
  half: [hx, 1, hz],
  yaw,
});

describe("obbIntersects", () => {
  test("axis-aligned boxes behave like AABBs (overlap yes, touch no)", () => {
    expect(obbIntersects(box(0, 0, 1, 1, 0), box(1.5, 0, 1, 1, 0))).toBe(true);
    // exact touch (shared face) is legal placement — NOT an intersection
    expect(obbIntersects(box(0, 0, 1, 1, 0), box(2, 0, 1, 1, 0))).toBe(false);
    expect(obbIntersects(box(0, 0, 1, 1, 0), box(3, 0, 1, 1, 0))).toBe(false);
  });
  test("Y-separation short-circuits", () => {
    const a: Obb = { center: [0, 0, 0], half: [1, 1, 1], yaw: 0 };
    const b: Obb = { center: [0, 3, 0], half: [1, 1, 1], yaw: Math.PI / 4 };
    expect(obbIntersects(a, b)).toBe(false);
  });
  test("the conservative-AABB false-reject case: rotated long box beside a wall", () => {
    // A 20×4 box yawed 45° has a SQUARE conservative AABB cover of half-extent
    // (hx+hz)*cos(45°) on both axes, but its TRUE footprint is a thin diagonal strip —
    // the cover's corners are empty "pockets" the strip never reaches. Place a small
    // wall in the cover's (max-x, min-z) pocket: the cover clips it, the exact test
    // doesn't — THE measured B2 false-reject class.
    const piece = box(10, 10, 10, 2, Math.PI / 4);
    const coverHalf = 12 * Math.SQRT1_2; // (hx + hz) * cos(45°)
    const pocketX = 10 + coverHalf;
    const pocketZ = 10 - coverHalf;
    const wall = box(pocketX - 0.2, pocketZ - 0.2, 0.3, 0.3, 0);
    // sanity: conservative AABB cover of `piece` DOES overlap the wall
    const cover = {
      min: [10 - coverHalf, 0, 10 - coverHalf] as [number, number, number],
      max: [10 + coverHalf, 2, 10 + coverHalf] as [number, number, number],
    };
    const coverObb = obbOfAabb(cover);
    expect(obbIntersects(coverObb, wall)).toBe(true); // the old behaviour would reject
    expect(obbIntersects(piece, wall)).toBe(false); // the exact test accepts
  });
  test("SAT catches diagonal overlap AABB covers would also catch", () => {
    // Under this module's Ry(θ) convention, a's yaw-45° long axis runs along world
    // z = −x, so a point on that diagonal (not z = x) sits inside its footprint.
    expect(
      obbIntersects(
        box(0, 0, 3, 0.5, Math.PI / 4),
        box(1.5, -1.5, 0.5, 0.5, 0),
      ),
    ).toBe(true);
  });
  test("obbFromLocalAabb matches transformAabb centroid for yaw 0", () => {
    const local = {
      min: [-1, 0, -2] as [number, number, number],
      max: [3, 2, 4] as [number, number, number],
    };
    const o = obbFromLocalAabb(local, 0, [10, 5, -2]);
    expect(o.center).toEqual([11, 6, -1]);
    expect(o.half).toEqual([2, 1, 3]);
    expect(o.yaw).toBe(0);
  });
});
