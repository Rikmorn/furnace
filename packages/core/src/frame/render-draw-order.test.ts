import { expect, test } from "bun:test";
import { _frameRenderInternals, type ResolvedDraw } from "./render.ts";

const partition = _frameRenderInternals._partitionBlendedLast;

// The partition reads exactly two fields off a resolved draw (`kind` and
// `material.blended`), so a stub carrying only those exercises it honestly —
// no GPU, no slots. The extra `id` makes otherwise-identical draws
// distinguishable, which is what lets the assertions detect a reorder WITHIN
// a group (a structural comparison of same-shaped stubs could not).
type DrawStub = ResolvedDraw & { id: string };

function draw(
  id: string,
  kind: ResolvedDraw["kind"],
  blended: boolean,
): DrawStub {
  return { id, kind, material: { blended } } as unknown as DrawStub;
}

function ids(draws: readonly ResolvedDraw[]): string[] {
  return draws.map((d) => (d as DrawStub).id);
}

test("partitionBlendedLast: opaque-only input is returned unchanged", () => {
  const draws = [
    draw("m0", "mesh", false),
    draw("i0", "instanced", false),
    draw("m1", "mesh", false),
  ];
  const out = partition(draws);
  // Same array reference: an opaque-only frame must record in exactly its
  // submission order, and must not pay an allocation to do so.
  expect(out).toBe(draws);
  expect(ids(out)).toEqual(["m0", "i0", "m1"]);
});

test("partitionBlendedLast: empty input is returned unchanged", () => {
  const draws: ResolvedDraw[] = [];
  expect(partition(draws)).toBe(draws);
});

test("partitionBlendedLast: groups opaque meshes → opaque instanced → blended meshes → blended instanced", () => {
  // Submitted in exactly the wrong order — every group is out of place.
  const out = partition([
    draw("blendedInstanced", "instanced", true),
    draw("opaqueMesh", "mesh", false),
    draw("blendedMesh", "mesh", true),
    draw("opaqueInstanced", "instanced", false),
  ]);
  expect(ids(out)).toEqual([
    "opaqueMesh",
    "opaqueInstanced",
    "blendedMesh",
    "blendedInstanced",
  ]);
});

test("partitionBlendedLast: preserves submission order within each group", () => {
  const out = partition([
    draw("om0", "mesh", false),
    draw("bm0", "mesh", true),
    draw("oi0", "instanced", false),
    draw("bi0", "instanced", true),
    draw("om1", "mesh", false),
    draw("bm1", "mesh", true),
    draw("oi1", "instanced", false),
    draw("bi1", "instanced", true),
  ]);
  expect(ids(out)).toEqual([
    "om0",
    "om1",
    "oi0",
    "oi1",
    "bm0",
    "bm1",
    "bi0",
    "bi1",
  ]);
});

test("partitionBlendedLast: a blended mesh moves behind every opaque draw", () => {
  // The editor-ghost shape: one no-depth-write translucent mesh submitted
  // before the opaque instanced geometry it must appear in front of.
  const out = partition([
    draw("ghost", "mesh", true),
    draw("floor", "mesh", false),
    draw("tiles", "instanced", false),
  ]);
  expect(ids(out)).toEqual(["floor", "tiles", "ghost"]);
});

test("partitionBlendedLast: all-blended input keeps submission order", () => {
  // No depth sorting: the caller's order is the composite order.
  const out = partition([
    draw("a", "mesh", true),
    draw("b", "mesh", true),
    draw("c", "mesh", true),
  ]);
  expect(ids(out)).toEqual(["a", "b", "c"]);
});

test("partitionBlendedLast: does not mutate its input", () => {
  const draws = [draw("b", "mesh", true), draw("o", "mesh", false)];
  partition(draws);
  expect(ids(draws)).toEqual(["b", "o"]);
});
