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
  placementOwners,
  placementsByEntity,
  placesProps,
  proxyCorners,
  proxyExtents,
  proxyRecords,
  proxyScale,
  seedArchetypeParams,
  touchedParamKeys,
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

test("proxyScale takes scale MAGNITUDES, so a mirrored record keeps its size", () => {
  // An extent is a distance: a negative scale axis mirrors a record, it does not
  // shrink it. Core's `localHalfExtents` (the rule this mirrors) takes
  // magnitudes for exactly this reason — without them a `Math.max` over
  // [-3, -3, -3] picks −3 and the round proxy inverts to nothing at all.
  expectVec(proxyScale(BOX, [-2, 3, -4]), [1.6, 2.1, 3.2]);
  expectVec(proxyScale(SPHERE, [-3, -3, -3]), [1.8, 1.8, 1.8]);
  expectVec(proxyScale(CAPSULE, [-2, 1, 1]), [0.88, 2.88, 0.88]);
});

// ——— the anchored pose (D-F4-14) ———

/** `BOX` with its origin at the primitive's BOTTOM, the way a prop authored to
 *  stand on the floor is. Its Y half-extent is 0.35, so its centre sits 0.35 m
 *  above the record's position at scale 1. */
const BASE_BOX: EntityCollision = {
  kind: "box",
  halfExtents: [0.4, 0.35, 0.4],
  anchor: "base",
};

test("proxyRecords LIFTS a base-anchored record onto its collider centre", () => {
  // The editor's proxy and the runtime's rigid body must land in the same place,
  // and core exported `collisionCenter` so exactly one function decides where
  // that is. A proxy at the raw `position` draws the prop half-buried.
  const centred = proxyRecords([record({ position: [1, 2, 3] })], BOX);
  expect(centred[0]?.position).toEqual([1, 2, 3]);
  const based = proxyRecords([record({ position: [1, 2, 3] })], BASE_BOX);
  expectVec(based[0]?.position ?? [], [1, 2.35, 3]);
  // The lift scales with the record, per axis for a box.
  const scaled = proxyRecords(
    [record({ position: [0, 0, 0], scale: [1, 2, 1] })],
    BASE_BOX,
  );
  expectVec(scaled[0]?.position ?? [], [0, 0.7, 0]);
});

test("the base lift follows the record's LOCAL +Y, not world up", () => {
  // 90° about +Z sends local +Y to world −X, so a wall-mounted base-anchored
  // prop's collider centre moves sideways. Composing the lift as a bare
  // `position[1] + extentY` — the hand-written form core's extraction deleted —
  // would put it 0.35 m up instead.
  const s = Math.SQRT1_2;
  const out = proxyRecords(
    [record({ position: [0, 0, 0], quat: [0, 0, s, s] })],
    BASE_BOX,
  );
  expectVec(out[0]?.position ?? [], [-0.35, 0, 0]);
});

test("proxyCorners boxes the base-anchored record around its collider centre", () => {
  const c = proxyCorners(record({ position: [0, 0, 0] }), BASE_BOX);
  // The whole box sits ABOVE the record position: y spans [0, 0.7], not
  // [−0.35, 0.35].
  expectVec(c.subarray(0, 3), [-0.4, 0, -0.4]);
  expectVec(c.subarray(21, 24), [0.4, 0.7, 0.4]);
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

// The log is NOT id-ordered once anything has been reconfigured:
// reconfigureGenerator splices a re-cooked span back into the same PLACE
// carrying fresh ids, so a reconfigured entity's span sits before lower-id ops.
// Nothing here may assume ids ascend with position — this pins that. It does NOT
// discriminate against a positional implementation (position and id agree on
// this log, as they do on every log core writes); the test below that one is the
// one that does.
test("placementsByEntity attributes correctly on a log that is NOT id-ordered (the post-reconfigure shape)", () => {
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

// Position and id agree on every log core WRITES — commitGenerator lays a span
// immediately before its entity op, and reconfigureGenerator "requires and
// preserves" that layout (its own contract's words). They part company on a log
// core only READS: parseOps validates op ids and union tags and, for an entity
// op, `action` / `entity.type` / the record's presence — never the LAYOUT. A
// loaded oplog.json therefore carries whatever order its file has.
//
// So this is the discriminating case for the natural positional implementation
// ("attribute a placement op to the next entity op after it in log order"),
// which the id-ordering test above cannot tell apart from id-keying.
test("placementsByEntity attributes by span id even when the NEXT entity op in log order is not the owner", () => {
  const ops: FieldOp[] = [
    placementOp(3, [record({ archetypeId: "rock" })]), // entity 4's placement…
    entityOp(9, "cave", [7, 8]), // …but THIS entity op follows it
    entityOp(4, "scatter", [3, 3]), // and this one owns id 3
  ];
  const byEntity = placementsByEntity(ops);
  expect(byEntity.get(4)).toEqual([{ archetypeId: "rock", count: 1 }]);
  expect(byEntity.has(9)).toBe(false); // the cave carved; it placed nothing
});

// ——— log → per-RECORD attribution (the viewport pick's prop candidates) ———
//
// The sibling of the above at record granularity. It exists because a ray hits
// ONE prop and has to answer with the stamp that placed it, which a per-entity
// tally cannot say — and it lives here, in the pure module, precisely so the
// attribution is assertable without a canvas: through the host it is only
// reachable by clicking, which needs a GPU device.

test("placementOwners pairs every record with the entity whose span claims its op", () => {
  const rock = record({ archetypeId: "rock", position: [1, 0, 0] });
  const spike = record({ archetypeId: "stalagmite", position: [2, 0, 0] });
  const ops: FieldOp[] = [
    {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [0, 0, 0], radius: 1 },
    },
    entityOp(2, "cave", [1, 1]), // a carver: places nothing
    placementOp(3, [rock, spike]),
    entityOp(4, "scatter", [3, 3]),
  ];
  // One entry per RECORD (not per archetype, not per op), in log order.
  expect(placementOwners(ops)).toEqual([
    { entityId: 4, record: rock },
    { entityId: 4, record: spike },
  ]);
  // …and the record is the LOG's own object, not a copy: the pick reads a pose
  // off it and must see later edits to the log rather than a snapshot.
  expect(placementOwners(ops)[0]?.record).toBe(rock);
});

test("placementOwners attributes by SPAN, not by the next entity op in log order", () => {
  // The discriminating shape from the sibling case above, at record granularity:
  // a positional implementation ("the next entity op after it") answers 9 here.
  // A prop click would then select a carver that placed nothing.
  const ops: FieldOp[] = [
    placementOp(3, [record({ archetypeId: "rock" })]),
    entityOp(9, "cave", [7, 8]),
    entityOp(4, "scatter", [3, 3]),
  ];
  expect(placementOwners(ops).map((o) => o.entityId)).toEqual([4]);
});

test("placementOwners skips an ORPHAN placement op instead of guessing an owner", () => {
  // No span claims id 3. Runtime-quiet, matching placementsByEntity: no commit
  // path produces one, and a pick that invented an owner would select an entity
  // the user cannot see the connection to. The drawn prop layer still shows it
  // (groupPlacements counts every record whatever owns it) — so on a corrupt log
  // there is a visible prop that cannot be selected, which is the safe direction.
  const ops: FieldOp[] = [
    placementOp(3, [record({ archetypeId: "rock" })]),
    entityOp(4, "scatter", [10, 12]),
  ];
  expect(placementOwners(ops)).toEqual([]);
});

// `opSpan` is TRUSTED numeric data on load — core's parseOps validates op ids
// and union tags but never span bounds — so a hand-edited or truncated
// oplog.json can carry an arbitrarily wide one. Attribution must therefore never
// WALK the range.
//
// The budget converts ONE spelling of that regression from a hang into a red
// test, and it is worth being exact about which. `for (let id = span[0]; id <=
// span[1]; id++)` re-evaluates span[1] on every iteration, so it trips the
// budget in microseconds (verified). Hoist the bounds first — `const [lo, hi] =
// e.opSpan` — and the proxy is read twice, the budget never fires, and the walk
// HANGS instead (also verified: killed at 15 s, no output). Hoisting is at least
// as natural a spelling, so this is a tripwire on the shape that was actually
// written and replaced here, not a guarantee against every range walk. A
// subprocess-with-timeout harness would close the gap and is not worth its
// weight for the risk.
//
// The result assertion below is the real one either way; the budget never fires
// for a correct implementation, which reads the bound once per placement op ×
// entity.
const SPAN_READ_BUDGET = 1000;

/** An `opSpan` whose upper bound throws once read more than `SPAN_READ_BUDGET`
 *  times — generous for any id-membership test, instant for a range walk that
 *  re-reads the bound per iteration. */
const budgetedSpan = (first: number, last: number): [number, number] => {
  let reads = 0;
  return new Proxy([first, last] as [number, number], {
    get(target, prop, receiver) {
      if (prop === "1" && ++reads > SPAN_READ_BUDGET)
        throw new Error(
          `opSpan[1] read ${reads} times — the id RANGE is being walked`,
        );
      return Reflect.get(target, prop, receiver);
    },
  });
};

test("placementsByEntity survives a corrupt, arbitrarily wide opSpan (it tests ids, it does not walk the range)", () => {
  const ops: FieldOp[] = [
    placementOp(1, [record({ archetypeId: "rock" })]),
    entityOp(2, "scatter", budgetedSpan(0, Number.MAX_SAFE_INTEGER)),
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

// The MID-SESSION re-seed (D-25's "defaults behave"): switching archetype has to move the
// params the user has not spoken about and leave the ones they have. The filter is what
// makes one function serve both moments — a fresh session passes no filter and takes every
// hint, a live one passes its untouched keys.
test("seedArchetypeParams applies only the FILTERED hints when keys are given", () => {
  const catalog = [
    archetype("rock", BOX, { density: 0.9, minSpacing: 1.4 }),
    archetype("stalagmite", CAPSULE, { density: 0.15, minSpacing: 0.6 }),
  ];
  const live = { archetypeId: "stalagmite", density: 0.42, minSpacing: 1.4 };
  const seeded = seedArchetypeParams(live, catalog, ["minSpacing"]);
  expect(seeded).toEqual({
    archetypeId: "stalagmite",
    // NOT 0.15: `density` is not in the filter, so the value already there stands.
    density: 0.42,
    // …and the one that IS takes the new archetype's hint.
    minSpacing: 0.6,
  });
  // An EMPTY filter is a real answer ("everything is touched"), not a missing one — the
  // archetype id still lands, because that is the change being applied rather than a hint.
  expect(seedArchetypeParams(live, catalog, [])).toEqual({
    archetypeId: "stalagmite",
    density: 0.42,
    minSpacing: 1.4,
  });
});

// --- touchedParamKeys: what the user has spoken about -----------------------

test("touchedParamKeys accumulates the keys whose VALUE changed, and never forgets one", () => {
  const seen = touchedParamKeys(
    { density: 0.42, minSpacing: 1.4, archetypeId: "rock" },
    { density: 0.3, minSpacing: 1.4, archetypeId: "rock" },
    new Set<string>(),
  );
  expect([...seen].sort()).toEqual(["density"]);

  // A later edit ADDS to the set rather than replacing it: an update that changes
  // `minSpacing` must not un-touch the `density` the user set two edits ago.
  const later = touchedParamKeys(
    { density: 0.42, minSpacing: 0.9, archetypeId: "rock" },
    { density: 0.42, minSpacing: 1.4, archetypeId: "rock" },
    seen,
  );
  expect([...later].sort()).toEqual(["density", "minSpacing"]);

  // An update that changes NOTHING (a seed re-roll or a policy switch pushes the same
  // params record) touches nothing.
  const idle = touchedParamKeys(
    { density: 0.42, minSpacing: 0.9, archetypeId: "rock" },
    { density: 0.42, minSpacing: 0.9, archetypeId: "rock" },
    later,
  );
  expect([...idle].sort()).toEqual(["density", "minSpacing"]);

  // A key that only the INCOMING record carries is a change (there was nothing there
  // before), and a non-primitive value is conservatively treated as one — the safe
  // direction, since a touched key is a key the re-seed leaves alone.
  const added = touchedParamKeys(
    { doors: ["N", "S"], width: 4 },
    { width: 4 },
    new Set<string>(),
  );
  expect([...added].sort()).toEqual(["doors"]);
});

// --- placesProps: the emits → "does this place props?" rule (D-F4-15) --------
//
// A one-line predicate with a test, because the mistake it exists to prevent is
// invisible to every registry-driven test in the repo. `placesProps` is read by
// the stamp form's props count (via FieldGeneratorInfo) and by the host's
// empty-preview refusal; both used to sniff the param schema for an
// `archetypeId`, and both now read core's declaration.

test('placesProps is `!== "ops"`, so a MIXED emitter places props too', () => {
  // The whole reason this is a function. `"both"` is the case a test built from
  // FIELD_GENERATORS cannot reach — no built-in declares it — so the narrowing
  // mistake `emits === "placements"` agrees with the correct rule everywhere the
  // registry can see and diverges on the first mixed emitter added. Naming the
  // union member directly is the only way to pin it before that day.
  expect(placesProps("both")).toBe(true);
  expect(placesProps("placements")).toBe(true);
  expect(placesProps("ops")).toBe(false);
});
