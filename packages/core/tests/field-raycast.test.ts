import { describe, expect, test } from "bun:test";
import { applyOp, createFieldStore, raycastField } from "@furnace/core/field";

describe("raycastField", () => {
  test("a ray inside a dug cavity hits the far wall", () => {
    const s = createFieldStore();
    applyOp(s, {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [2, 2, 2], radius: 1.5 },
    });
    const hit = raycastField(s, [2, 2, 2], [1, 0, 0], 10);
    expect(hit).not.toBeNull();
    // wall is ~1.5 m out (quantization slop one cell either way)
    expect(Math.abs((hit as { point: number[] }).point[0]! - 3.5)).toBeLessThan(
      0.5,
    );
  });

  test("a ray in solid rock hits immediately; maxDist misses return null", () => {
    const s = createFieldStore();
    expect(raycastField(s, [50, 50, 50], [1, 0, 0], 5)).not.toBeNull();
    applyOp(s, {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [2, 2, 2], halfExtents: [1.5, 1.5, 1.5] },
    });
    expect(raycastField(s, [2, 2, 2], [1, 0, 0], 0.5)).toBeNull();
  });
});
