// generatorFootprint: the entity-highlight box must outline what a generator
// actually STAMPED (the union of its span's op bounds), not the selection
// region the user happened to drag — an oversized region drew a box around
// mostly-empty space (the F3a gate finding "highlights odd things").
//
// …plus segmentGhostSegments, the segment brush's capsule wireframe. Those
// tests establish the GEOMETRY of the batch (where the vertices are) and
// nothing whatsoever about whether it reaches the screen: drawLines silently
// dropped every field line overlay for two sealed slices
// (docs/learnings/2026-07-21-invisible-line-overlays.md), passing tests exactly
// like these. Visibility is a gate question.
import { expect, test } from "bun:test";
import type {
  EntityOp,
  FieldOp,
  GeneratorEntity,
  PatchOp,
} from "@furnace/core/field";
import {
  generatorFootprint,
  segmentGhostSegments,
  sphereGhostSegments,
} from "../src/field-host/field-ghost.ts";

type Vec3T = [number, number, number];

const sub = (p: Vec3T, q: Vec3T): Vec3T => [
  p[0] - q[0],
  p[1] - q[1],
  p[2] - q[2],
];
const dot = (p: Vec3T, q: Vec3T): number =>
  p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const len = (p: Vec3T): number => Math.sqrt(dot(p, p));

const entityWithSpan = (opSpan: [number, number]): GeneratorEntity => ({
  entityId: 99,
  type: "generator",
  generator: "hall",
  params: {},
  seed: 1,
  region: { min: [0, 0, 0], max: [40, 40, 40] }, // deliberately oversized
  opSpan,
});

const entityOp = (entity: GeneratorEntity): EntityOp => ({
  id: entity.entityId,
  kind: "entity",
  action: "place",
  entity,
});

test("footprint is the union of the span's brush bounds, not the recorded region", () => {
  const entity = entityWithSpan([1, 2]);
  const ops: FieldOp[] = [
    {
      id: 1,
      kind: "brush",
      effect: "fill",
      material: 1,
      shape: { kind: "box", center: [2, 2, 2], halfExtents: [2, 2, 2] },
    },
    {
      id: 2,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [5, 2, 2], radius: 1 },
    },
    entityOp(entity),
  ];
  expect(generatorFootprint(ops, entity, 0.25)).toEqual({
    min: [0, 0, 0],
    max: [6, 4, 4],
  });
});

test("ops outside the span never contribute", () => {
  const entity = entityWithSpan([1, 1]);
  const ops: FieldOp[] = [
    {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [1, 1, 1], radius: 1 },
    },
    {
      id: 5, // downstream hand stroke — not part of the stamp
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [30, 30, 30], radius: 1 },
    },
    entityOp(entity),
  ];
  expect(generatorFootprint(ops, entity, 0.25)).toEqual({
    min: [0, 0, 0],
    max: [2, 2, 2],
  });
});

test("patch-op spans derive chunk-extent bounds; a missing span is null", () => {
  const entity = entityWithSpan([7, 7]);
  const patch: PatchOp = {
    id: 7,
    kind: "patch",
    chunks: [
      {
        key: "1,0,0",
        densityMask: new Uint8Array(512),
        density: new Int8Array(0),
        materialMask: null,
        materials: null,
      },
    ],
  };
  // chunk (1,0,0) at cellSize 0.25 → 16·0.25 = 4 m extent per axis
  expect(generatorFootprint([patch, entityOp(entity)], entity, 0.25)).toEqual({
    min: [4, 0, 0],
    max: [8, 4, 4],
  });
  expect(generatorFootprint([entityOp(entity)], entity, 0.25)).toBeNull();
});

test("a placement span's footprint is its records' world AABBs, not the region", () => {
  // A pure reader (scatter) writes no field cells at all — its span holds ONE
  // placement op — so without this the highlight box would fall back to the
  // recorded selection region and outline mostly-empty space (the same F3a gate
  // finding the brush case above fixes). `position ± scale/2` is core's own
  // placement-bounds convention (recordChunks in reconfigure.ts).
  const entity = entityWithSpan([1, 1]);
  const placement: FieldOp = {
    id: 1,
    kind: "placement",
    records: [
      {
        archetypeId: "rock",
        position: [2, 1, 2],
        quat: [0, 0, 0, 1],
        scale: [1, 1, 1],
        variantIndex: 0,
      },
      {
        archetypeId: "rock",
        position: [6, 1, 6],
        quat: [0, 0, 0, 1],
        scale: [2, 2, 2],
        variantIndex: 1,
      },
    ],
  };
  expect(
    generatorFootprint([placement, entityOp(entity)], entity, 0.25),
    // rock 1 spans ±0.5 about (2,1,2); rock 2 spans ±1 about (6,1,6).
  ).toEqual({ min: [1.5, 0, 1.5], max: [7, 2, 7] });
});

// --- the segment brush's capsule ghost (F3b: D-F3-14) ----------------------

const RING_SEGMENTS = 16; // two rings of these, plus 4 rails
const CAPSULE_SEGMENT_COUNT = 2 * RING_SEGMENTS + 4;

test("capsule ghost: two endcap rings perpendicular to the axis, plus 4 rails", () => {
  const a: Vec3T = [1, 2, 3];
  const b: Vec3T = [4, 2, 3];
  const radius = 0.5;
  const segments = segmentGhostSegments(a, b, radius);
  expect(segments).toHaveLength(CAPSULE_SEGMENT_COUNT);

  const axis: Vec3T = [1, 0, 0]; // b − a, normalized
  // Every RING vertex sits on the circle of `radius` about its own endpoint,
  // in the plane perpendicular to the axis. Ring segments come first (a's,
  // then b's), so the endpoint each belongs to is positional.
  for (let i = 0; i < 2 * RING_SEGMENTS; i++) {
    const center = i < RING_SEGMENTS ? a : b;
    for (const v of segments[i] as [Vec3T, Vec3T]) {
      expect(len(sub(v, center))).toBeCloseTo(radius, 9);
      expect(dot(sub(v, center), axis)).toBeCloseTo(0, 9);
    }
  }
  // Every RAIL runs from a's ring to b's ring, parallel to the axis and
  // exactly the sweep's length — so the wireframe is a tube, not a bow tie.
  for (let i = 2 * RING_SEGMENTS; i < segments.length; i++) {
    const [p, q] = segments[i] as [Vec3T, Vec3T];
    expect(len(sub(p, a))).toBeCloseTo(radius, 9);
    expect(len(sub(q, b))).toBeCloseTo(radius, 9);
    expect(sub(q, p)).toEqual(sub(b, a));
  }
});

test("capsule ghost: a sweep along ANY world axis stays finite", () => {
  // The basis is built by crossing the axis with a world axis — cross it with
  // the WRONG one (the axis itself) and every vertex is NaN. A +y sweep is the
  // case a naive `cross(axis, [0,1,0])` breaks on, and it is the commonest
  // click pair in the editor (dig straight down).
  for (const b of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ] as Vec3T[]) {
    const segments = segmentGhostSegments([0, 0, 0], b, 0.4);
    expect(segments).toHaveLength(CAPSULE_SEGMENT_COUNT);
    for (const seg of segments)
      for (const v of seg)
        for (const n of v) expect(Number.isFinite(n)).toBe(true);
  }
});

test("capsule ghost: a DEGENERATE segment falls back to the sphere ghost", () => {
  // a === b has no perpendicular plane to build a basis in, and the op it
  // previews IS a sphere (core's capsule SDF degenerates the same way).
  expect(segmentGhostSegments([2, 2, 2], [2, 2, 2], 1.5)).toEqual(
    sphereGhostSegments([2, 2, 2], 1.5),
  );
});
