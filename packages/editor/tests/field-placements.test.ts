// The placed-prop proxy math (field-placements.ts) — pure, GPU-free, so the
// formulas the ghost wireframes and the instanced prop layer BOTH derive from
// are pinned without a context: the collision-primitive → proxy extents mapping,
// the record re-scaling core's packPlacementMatrices consumes, the oriented
// corner layout, the log → per-archetype grouping (whose group sizes ARE the
// instanced draw counts), the log → per-ENTITY attribution the entities list's
// prop rows read, and the two catalog-seeding helpers.
//
// The sibling of field-ghost.test.ts, which pins field-ghost.ts the same way.
import { expect, test } from "bun:test";
import type { FieldOp, PlacementRecord } from "@furnace/core/field";
import { packPlacementMatrices } from "@furnace/core/field";
import type {
  EntityArchetype,
  EntityCollision,
} from "../src/frontend/lib/catalog.ts";
import {
  FALLBACK_COLLISION,
  groupPlacements,
  PROXY_PRIMITIVE,
  placementGhostBatch,
  placementsByEntity,
  proxyCorners,
  proxyExtents,
  proxyRecords,
  proxyScale,
  seedArchetypeParams,
  withArchetypeOptions,
} from "../src/viewport-host/field-placements.ts";

const BOX: EntityCollision = { kind: "box", halfExtents: [0.4, 0.35, 0.4] };
const SPHERE: EntityCollision = { kind: "sphere", radius: 0.3 };
const CAPSULE: EntityCollision = {
  kind: "capsule",
  halfHeight: 0.5,
  radius: 0.22,
};

const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];

const record = (over: Partial<PlacementRecord> = {}): PlacementRecord => ({
  archetypeId: "rock",
  position: [1, 2, 3],
  quat: IDENTITY,
  scale: [1, 1, 1],
  variantIndex: 0,
  ...over,
});

const archetype = (
  id: string,
  collision: EntityCollision,
  scatter: Record<string, unknown> = {},
): EntityArchetype => ({
  id,
  name: id,
  color: [0.5, 0.5, 0.5],
  collision,
  scatter,
});

// ——— proxy sizing ———

test("proxyExtents converts each collision primitive to full world extents", () => {
  expect(proxyExtents(BOX)).toEqual([0.8, 0.7, 0.8]); // 2 × halfExtents
  expect(proxyExtents(SPHERE)).toEqual([0.6, 0.6, 0.6]); // diameter on every axis
  // capsule: ⌀ by its TOTAL height, 2·(halfHeight + radius) — the cylinder proxy
  // has to cover the two hemispherical caps, not just the shaft.
  expect(proxyExtents(CAPSULE)).toEqual([0.44, 1.44, 0.44]);
});

/** Element-wise float compare (binary floating point makes 0.7 × 3 ≠ 2.1, and
 *  the corner arrays are Float32). */
const expectVec = (
  got: readonly number[] | Float32Array,
  want: readonly number[],
): void => {
  expect(got).toHaveLength(want.length);
  want.forEach((w, i) => expect(got[i] ?? Number.NaN).toBeCloseTo(w, 5));
};

test("proxyScale scales a box PER AXIS and a sphere/capsule by the max axis", () => {
  expectVec(proxyScale(BOX, [2, 3, 4]), [1.6, 2.1, 3.2]);
  // No per-axis form for a radius — the max axis is the conservative read, and
  // it matches the dungeon loader's placementCollider so proxy and collider agree.
  expectVec(proxyScale(SPHERE, [2, 3, 4]), [2.4, 2.4, 2.4]);
  expectVec(proxyScale(CAPSULE, [1, 1, 2]), [0.88, 2.88, 0.88]);
});

test("PROXY_PRIMITIVE maps every collision kind (a capsule draws as a cylinder)", () => {
  expect(PROXY_PRIMITIVE.box).toBe("cube");
  expect(PROXY_PRIMITIVE.sphere).toBe("sphere");
  expect(PROXY_PRIMITIVE.capsule).toBe("cylinder");
});

test("proxyRecords folds the primitive size into scale and never mutates the input", () => {
  const input = [record({ scale: [2, 2, 2] })];
  const snapshot = structuredClone(input);
  const out = proxyRecords(input, BOX);
  // The UNIT primitive (cube size 1) times this scale must equal the archetype's
  // extents × the record scale — that identity is the whole contract.
  expect(out[0]?.scale).toEqual([1.6, 1.4, 1.6]);
  expect(out[0]?.position).toEqual([1, 2, 3]); // pose carried through
  expect(input).toEqual(snapshot);
});

test("proxyRecords output packs through core's packPlacementMatrices at the proxy scale", () => {
  // The prop layer's actual pipeline: proxyRecords → packPlacementMatrices → one
  // bulk instance upload. Column-major TRS with an identity quat puts the per-axis
  // scale on the diagonal and the position in the last column.
  const m = packPlacementMatrices(
    proxyRecords([record({ scale: [2, 2, 2] })], BOX),
  );
  expect(m).toHaveLength(16);
  expect(m[0]).toBeCloseTo(1.6, 6);
  expect(m[5]).toBeCloseTo(1.4, 6);
  expect(m[10]).toBeCloseTo(1.6, 6);
  expect([m[12], m[13], m[14]]).toEqual([1, 2, 3]);
});

// ——— oriented ghost corners ———

test("proxyCorners lays the 8 corners out in boxEdges' bit order around the position", () => {
  const c = proxyCorners(record({ position: [0, 0, 0] }), BOX);
  expect(c).toHaveLength(24);
  // bit0 = x, bit1 = y, bit2 = z: corner 0 is all-min, corner 7 all-max.
  expectVec(c.subarray(0, 3), [-0.4, -0.35, -0.4]);
  expectVec(c.subarray(21, 24), [0.4, 0.35, 0.4]);
  // corner 1 flips X only
  expectVec(c.subarray(3, 6), [0.4, -0.35, -0.4]);
});

test("proxyCorners ROTATES by the record's quat (a wall prop is not axis-aligned)", () => {
  // 90° about +Z maps local +X → +Y and local +Y → −X, so a tall capsule proxy
  // lies down: its long axis (1.44 m) now spans X and its ⌀ spans Y.
  const s = Math.SQRT1_2;
  const c = proxyCorners(
    record({ position: [0, 0, 0], quat: [0, 0, s, s] }),
    CAPSULE,
  );
  const xs = [...Array(8).keys()].map((i) => c[i * 3] as number);
  const ys = [...Array(8).keys()].map((i) => c[i * 3 + 1] as number);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.44, 6);
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.44, 6);
});

// ——— the merged ghost batch ———

test("placementGhostBatch merges every record into ONE drawLines payload", () => {
  const catalog = new Map([["rock", archetype("rock", BOX)]]);
  const batch = placementGhostBatch(
    [record(), record({ position: [5, 5, 5] })],
    catalog,
    [0.4, 0.8, 1, 1],
  );
  // 12 edges × 2 vertices × 3 floats = 72 per record; colors 4 floats/vertex.
  expect(batch?.vertices).toHaveLength(144);
  expect(batch?.colors).toHaveLength(192);
  expectVec(batch?.colors.subarray(0, 4) ?? [], [0.4, 0.8, 1, 1]);
});

test("placementGhostBatch draws an UNCATALOGUED archetype at the fallback proxy", () => {
  // The catalog SEEDS, it never gates: a record naming an archetype this project
  // has no catalog entry for must still be visible, at a nominal size.
  const batch = placementGhostBatch(
    [record({ archetypeId: "nonesuch", position: [0, 0, 0] })],
    new Map(),
    [1, 1, 1, 1],
  );
  const fallbackHalf =
    FALLBACK_COLLISION.kind === "box" ? FALLBACK_COLLISION.halfExtents[0] : 0;
  expect(batch?.vertices[0]).toBeCloseTo(-fallbackHalf, 6);
});

test("placementGhostBatch is null for an empty record list (nothing to draw)", () => {
  expect(placementGhostBatch([], new Map(), [1, 1, 1, 1])).toBeNull();
});

// ——— log → prop-layer grouping ———

const placementOp = (id: number, records: PlacementRecord[]): FieldOp => ({
  id,
  kind: "placement",
  records,
});

test("groupPlacements collects every placement op's records by archetype, in log order", () => {
  const ops: FieldOp[] = [
    {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [0, 0, 0], radius: 1 },
    },
    placementOp(2, [
      record({ archetypeId: "rock" }),
      record({ archetypeId: "stalagmite" }),
      record({ archetypeId: "rock" }),
    ]),
    placementOp(3, [record({ archetypeId: "rock" })]),
  ];
  const groups = groupPlacements(ops);
  // One group per archetype ACROSS ops — one instanced draw each, its record
  // count the draw's instance count.
  expect([...groups.keys()]).toEqual(["rock", "stalagmite"]);
  expect(groups.get("rock")).toHaveLength(3);
  expect(groups.get("stalagmite")).toHaveLength(1);
});

test("groupPlacements over a log with no placement ops is empty (no prop draws)", () => {
  expect(groupPlacements([]).size).toBe(0);
});

// ——— log → per-ENTITY attribution (the entities list's prop rows) ———

const entityOp = (
  entityId: number,
  generator: string,
  opSpan: [number, number],
): FieldOp => ({
  id: entityId,
  kind: "entity",
  action: "place",
  entity: {
    entityId,
    type: "generator",
    generator,
    params: {},
    seed: 1,
    region: { min: [0, 0, 0], max: [4, 4, 4] },
    opSpan,
  },
});

test("placementsByEntity attributes each placement op to the entity whose span holds it", () => {
  // A carver's span (a brush op), then a scatter's (one placement op) — the
  // commitGenerator layout: span ops, then the entity op that closes them.
  const ops: FieldOp[] = [
    {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [0, 0, 0], radius: 1 },
    },
    entityOp(2, "cave", [1, 1]),
    placementOp(3, [
      record({ archetypeId: "rock" }),
      record({ archetypeId: "rock" }),
    ]),
    entityOp(4, "scatter", [3, 3]),
  ];
  const byEntity = placementsByEntity(ops);
  expect(byEntity.get(4)).toEqual([{ archetypeId: "rock", count: 2 }]);
  // The carver placed nothing, so it is ABSENT — a miss IS "no props", which is
  // what the row keys its prop segment on.
  expect(byEntity.has(2)).toBe(false);
  expect(byEntity.size).toBe(1);
});

test("placementsByEntity counts EACH archetype a span placed, in first-seen order", () => {
  const ops: FieldOp[] = [
    placementOp(1, [
      record({ archetypeId: "stalagmite" }),
      record({ archetypeId: "rock" }),
      record({ archetypeId: "stalagmite" }),
    ]),
    entityOp(2, "scatter", [1, 1]),
  ];
  expect(placementsByEntity(ops).get(2)).toEqual([
    { archetypeId: "stalagmite", count: 2 },
    { archetypeId: "rock", count: 1 },
  ]);
});

// The invariant that makes span-ID membership the right key and log POSITION the
// wrong one: reconfigureGenerator splices a re-cooked span back into the same
// place carrying FRESH ids (log.nextId, which only grows), so a reconfigured
// entity's span sits BEFORE lower-id ops in log order. A positional
// implementation ("the placement ops since the last entity op") reads the same
// on the ordered log above and mis-attributes here.
test("placementsByEntity keys on span IDS, not log position (the post-reconfigure log is not id-ordered)", () => {
  const ops: FieldOp[] = [
    // Entity 9's re-cooked span: ids 20-21, spliced in at the FRONT.
    placementOp(20, [record({ archetypeId: "rock" })]),
    entityOp(9, "scatter", [20, 20]),
    // An older, untouched scatter still carrying its original low ids.
    placementOp(3, [
      record({ archetypeId: "stalagmite" }),
      record({ archetypeId: "stalagmite" }),
    ]),
    entityOp(4, "scatter", [3, 3]),
  ];
  const byEntity = placementsByEntity(ops);
  expect(byEntity.get(9)).toEqual([{ archetypeId: "rock", count: 1 }]);
  expect(byEntity.get(4)).toEqual([{ archetypeId: "stalagmite", count: 2 }]);
});

// `opSpan` is a TRUSTED numeric field on load — core's parseOps validates op
// ids and union tags but never span bounds — so a hand-edited or truncated
// oplog.json can carry an arbitrarily wide one. Attribution must therefore never
// WALK the range. Stated plainly because it shapes how a regression LOOKS: a
// range-walking implementation HANGS here (a synchronous loop cannot be
// pre-empted by the per-test timeout — verified: the run never returns), so the
// failure shows up as a stalled suite, not as a failed assertion.
test("placementsByEntity survives a corrupt, arbitrarily wide opSpan (it tests ids, it does not walk the range)", () => {
  const ops: FieldOp[] = [
    placementOp(1, [record({ archetypeId: "rock" })]),
    entityOp(2, "scatter", [0, Number.MAX_SAFE_INTEGER]),
  ];
  expect(placementsByEntity(ops).get(2)).toEqual([
    { archetypeId: "rock", count: 1 },
  ]);
});

test("placementsByEntity over a props-free log is empty (no span walked at all)", () => {
  const ops: FieldOp[] = [
    {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [0, 0, 0], radius: 1 },
    },
    entityOp(2, "cave", [1, 1]),
  ];
  expect(placementsByEntity(ops).size).toBe(0);
  expect(placementsByEntity([]).size).toBe(0);
});

// ——— catalog seeding (schema options + opening params) ———

const SCATTER_SCHEMA = {
  type: "object",
  properties: {
    archetypeId: { type: "string", default: "rock" },
    density: { type: "number", default: 0.3 },
  },
};

test("withArchetypeOptions turns archetypeId into an enum of the catalog ids", () => {
  const out = withArchetypeOptions(structuredClone(SCATTER_SCHEMA), [
    "rock",
    "stalagmite",
  ]);
  const props = out["properties"] as Record<string, Record<string, unknown>>;
  expect(props["archetypeId"]?.["enum"]).toEqual(["rock", "stalagmite"]);
  // Sibling properties and the property's own fields survive untouched.
  expect(props["archetypeId"]?.["default"]).toBe("rock");
  expect(props["density"]).toEqual({ type: "number", default: 0.3 });
});

test("withArchetypeOptions is a no-op without a catalog or without the param", () => {
  const schema = structuredClone(SCATTER_SCHEMA);
  expect(withArchetypeOptions(schema, [])).toBe(schema); // same reference
  const hall = { type: "object", properties: { width: { type: "number" } } };
  expect(withArchetypeOptions(hall, ["rock"])).toBe(hall);
  // …and it never mutates the schema it was handed.
  expect(
    (schema["properties"] as Record<string, Record<string, unknown>>)[
      "archetypeId"
    ]?.["enum"],
  ).toBeUndefined();
});

test("seedArchetypeParams overlays the named archetype's authored scatter hints", () => {
  const seeded = seedArchetypeParams({ archetypeId: "rock", density: 0.3 }, [
    archetype("rock", BOX, { density: 0.9, minSpacing: 1.4 }),
    archetype("stalagmite", CAPSULE, { density: 0.15 }),
  ]);
  expect(seeded).toEqual({
    archetypeId: "rock",
    density: 0.9, // the archetype's hint WINS over the schema default
    minSpacing: 1.4, // …and adds keys the defaults did not carry
  });
});

test("seedArchetypeParams falls back to the catalog's FIRST archetype for a stale default", () => {
  // A schema default naming an archetype the project's catalog dropped must not
  // open a session on an id nothing resolves.
  const seeded = seedArchetypeParams({ archetypeId: "rock", density: 0.3 }, [
    archetype("stalagmite", CAPSULE, { density: 0.15 }),
  ]);
  expect(seeded["archetypeId"]).toBe("stalagmite");
  expect(seeded["density"]).toBe(0.15);
});

test("seedArchetypeParams is a no-op with no catalog or a non-archetype generator", () => {
  const defaults = { archetypeId: "rock", density: 0.3 };
  expect(seedArchetypeParams(defaults, [])).toBe(defaults);
  const hall = { width: 8 };
  expect(seedArchetypeParams(hall, [archetype("rock", BOX)])).toBe(hall);
});
