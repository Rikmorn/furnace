// generatorFootprint: the entity-highlight box must outline what a generator
// actually STAMPED (the union of its span's op bounds), not the selection
// region the user happened to drag — an oversized region drew a box around
// mostly-empty space (the F3a gate finding "highlights odd things").
import { expect, test } from "bun:test";
import type {
  EntityOp,
  FieldOp,
  GeneratorEntity,
  PatchOp,
} from "@furnace/core/field";
import { generatorFootprint } from "../src/viewport-host/field-ghost.ts";

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
