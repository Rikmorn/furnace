// THE SPATIAL READ — the agent's tape measure (foundations T4c).
//
// THREE LEVELS, and the split is the one `mutation.test.ts` argues one module over, with a
// level this seam needs that the mutation seam did not.
//
//   - PURE (the exported helpers over hand-built inputs) for the definitions: what an
//     oriented box's AABB is, what counts as an overlap, and what CONTACT means. These are
//     the claims a caller acts on, and each is a function of its arguments alone — so they
//     are asserted directly rather than inferred from a composed answer where a wrong
//     tolerance and a wrong probe origin look identical.
//   - SEAM (`createQuery` over a real store and log with stub deps) for the composition: that
//     the lint finds what it should, reports its caps honestly, and hands out copies.
//   - HOST (`createFieldHost`) for the wiring: that the facade member reaches the seam over
//     the real substrate. No GPU anywhere — every path here is store and log work.
//
// THE FIXTURES ARE HAND-AUTHORED LOGS rather than committed generators, which is
// `field-placements.test.ts`' own pattern and is what makes the two required pins EXACT: "a
// deliberately-overlapping pair" has to be deliberate, and a scatter's records are wherever
// the surface projection put them. `OpLog.ops` is a plain `FieldOp[]`, so a test can lay down
// exactly the entity spans and placement records it means.
import { expect, test } from "bun:test";
import {
  createFieldStore,
  createOpLog,
  type FieldOp,
  type FieldStore,
  logApply,
  type MaterialTable,
  type OpLog,
  type PlacementRecord,
} from "@furnace/core/field";
import { createFieldHost } from "../../src/field-host/field-host.ts";
import {
  boxOverlap,
  contactGap,
  cornersAabb,
  createQuery,
  findOverlaps,
  lint,
  probeBase,
  type QueryDeps,
  scanProps,
} from "../../src/field-host/field-query.ts";
import type {
  FieldEntityInfo,
  FieldGeneratorInfo,
  SelectionInfo,
} from "../../src/field-host/index.ts";
import type { EntityArchetype } from "../../src/shared/catalog.ts";
import { MAX_PROBE_M } from "../../src/shared/field-limits.ts";
import type { SessionQueryRequest } from "../../src/shared/wire.ts";

/** A table with a KIT class, because the host-level case commits a `hall` and every stamp
 *  generator requires one. The FOURTEENTH trimmed copy of this fixture in this suite —
 *  re-measured at this task (`grep -rl 'kind: "kit"' packages/editor/tests --include="*.ts"`,
 *  fourteen hits including this one), which is one more than `mutation.test.ts` counted one
 *  task ago because THIS file is the one more. That file argues why extracting it is a
 *  tidy-up rather than part of any one seam, and the argument is unchanged; its number was
 *  corrected in the same commit that falsified it. */
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

const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];

/** A placement record at a world position, naming an archetype **most cases leave out of the
 *  catalog** — so it measures at `FALLBACK_COLLISION`: a 0.5 m cube with NO anchor, meaning
 *  `collisionCenter` is the position itself and the box is `position ± 0.25` on each axis.
 *  That is what makes the expected numbers below readable by hand. The two catalog cases
 *  override `archetypeId` and install a real primitive, which is the contrast they exist
 *  for. */
const record = (position: [number, number, number]): PlacementRecord => ({
  archetypeId: "rock",
  position,
  quat: IDENTITY,
  scale: [1, 1, 1],
  variantIndex: 0,
});

const placementOp = (id: number, records: PlacementRecord[]): FieldOp => ({
  id,
  kind: "placement",
  records,
});

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
    seed: 7,
    region: { min: [0, 0, 0], max: [4, 4, 4] },
    opSpan,
  },
});

const entityInfo = (entityId: number, generator: string): FieldEntityInfo => ({
  entityId,
  type: "generator",
  generator,
  params: { width: 3 },
  seed: 7,
  region: { min: [0, 0, 0], max: [4, 4, 4] },
  opSpan: [entityId, entityId],
  placed: [],
});

type Harness = {
  store: FieldStore;
  log: OpLog;
  entities: FieldEntityInfo[];
  footprints: Map<
    number,
    { min: [number, number, number]; max: [number, number, number] }
  >;
  selection: SelectionInfo | null;
  /** The installed entity catalog. MUTABLE and empty by default, which is a legitimate
   *  project (the catalog seeds, it never gates) — but a harness that HARD-CODED it empty is
   *  what let the catalog lookup go untested for a whole review, since every record then
   *  measured at the fallback whatever the code did. A case that cares fills this. */
  catalog: Map<string, EntityArchetype>;
  /** What `listGenerators()` would hand back. EMPTY by default and filled by the one case
   *  that asks about it — the seam RELAYS this list, so a fixture here proves the relay and
   *  nothing about the registry. The registry's real content is asserted at the HOST level,
   *  where the projection is the facade's own. */
  generators: FieldGeneratorInfo[];
};

/** A world with a big carved ROOM (floor near y = 0, air above) and, far away, a 32 m SHAFT
 *  — the one fixture in which a downward probe can run out of reach and answer `null`. */
function harness(): { h: Harness; deps: QueryDeps } {
  const store = createFieldStore();
  const log = createOpLog();
  logApply(
    store,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [0, 10, 0], halfExtents: [8, 10, 8] },
    },
    TABLE,
  );
  logApply(
    store,
    log,
    {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [40, 16, 40], halfExtents: [1, 16, 1] },
    },
    TABLE,
  );
  const h: Harness = {
    store,
    log,
    entities: [],
    footprints: new Map(),
    selection: null,
    catalog: new Map(),
    generators: [],
  };
  const deps: QueryDeps = {
    substrate: {
      store: h.store,
      log: h.log,
      // A THUNK ONTO THE HARNESS, not a hard-coded empty map — the substrate's own contract
      // (`archetypeById` is a call because `setEntityCatalog` REBUILDS the map) and, here,
      // what lets a case install one.
      archetypeById: () => h.catalog,
      // The seam reads exactly three substrate members. Modelling the other thirteen would
      // go stale against a record this module never touches (`mutation.test.ts`' rule).
    } as unknown as QueryDeps["substrate"],
    entities: () => h.entities,
    footprints: () => h.footprints,
    selection: () => h.selection,
    // A THUNK ONTO THE HARNESS for `archetypeById`'s reason exactly — the real one re-derives
    // per call because the entity catalog can be swapped under it, and a case that installed
    // a fixed array here would be asserting against a dep shape the host does not have.
    generators: () => h.generators,
  };
  return { h, deps };
}

/**
 * The field's DENSITY CONTENTS, key by key — what a read-only claim has to be compared on.
 *
 * Not `chunks.size`: a write into an already-allocated chunk changes no key, and every probe
 * on the query path runs through carved (therefore allocated) space. Not core's
 * `densityEqual` either, which would be the natural tool and is deliberately NOT on the
 * public field index — its own docblock calls it "in-core comparator surface", so reaching
 * for it would mean widening core's surface for a test's convenience. `FieldStore`'s density
 * layout IS public (`chunks: Map<ChunkKey, Int8Array>`), so a plain copy compared with
 * `toEqual` needs nothing new from anybody.
 *
 * Arrays are COPIED rather than referenced — a snapshot holding the store's own `Int8Array`s
 * would mutate along with them and compare equal to anything.
 */
const fieldSnapshot = (store: FieldStore): Map<string, Int8Array> =>
  new Map(
    [...store.chunks].map(([key, cells]) => [key, Int8Array.from(cells)]),
  );

/** Narrow an answer to the arm it says it is, failing loudly rather than casting past it. */
function entitiesArm(
  answer: ReturnType<ReturnType<typeof createQuery>["answer"]>,
) {
  if (answer.about !== "entities") throw new Error("expected the entities arm");
  return answer;
}

// --- the definitions, as pure functions -------------------------------------

test("cornersAabb bounds an oriented box — and OVER-covers a rotated one", () => {
  // Axis-aligned first: the AABB of an axis-aligned box is the box.
  const flat = new Float32Array([
    -1, -1, -1, 1, -1, -1, -1, 1, -1, 1, 1, -1, -1, -1, 1, 1, -1, 1, -1, 1, 1,
    1, 1, 1,
  ]);
  expect(cornersAabb(flat)).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] });

  // The SAME unit box under a 45° yaw about Y, rotated here rather than written out as
  // twenty-four literals — the numbers are what the rotation produces, and a hand-typed copy
  // of them would be a fixture a reader has to verify instead of read.
  const yaw = Math.PI / 4;
  const tilted = new Float32Array(24);
  for (let i = 0; i < 8; i++) {
    const x = (i & 1) === 0 ? -1 : 1;
    const y = (i & 2) === 0 ? -1 : 1;
    const z = (i & 4) === 0 ? -1 : 1;
    tilted[i * 3] = x * Math.cos(yaw) + z * Math.sin(yaw);
    tilted[i * 3 + 1] = y;
    tilted[i * 3 + 2] = -x * Math.sin(yaw) + z * Math.cos(yaw);
  }
  // THE OVER-COVERAGE IS THE POINT: the corners swing out to ±√2 in X and Z while Y is
  // untouched, so the AABB is strictly larger than the box. That is what makes the overlap
  // lint report a tilted pair that may not actually interpenetrate — the direction the module
  // chose deliberately (over-inclusion keeps a finding true; under-inclusion drops it).
  const box = cornersAabb(tilted);
  expect(box.min[0]).toBeCloseTo(-Math.SQRT2, 5);
  expect(box.max[0]).toBeCloseTo(Math.SQRT2, 5);
  expect(box.min[2]).toBeCloseTo(-Math.SQRT2, 5);
  expect(box.max[2]).toBeCloseTo(Math.SQRT2, 5);
  expect(box.min[1]).toBeCloseTo(-1, 5);
  expect(box.max[1]).toBeCloseTo(1, 5);
});

test("boxOverlap answers the penetration extents — and TOUCHING is not overlapping", () => {
  const a = {
    min: [0, 0, 0] as [number, number, number],
    max: [1, 1, 1] as [number, number, number],
  };
  expect(boxOverlap(a, { min: [0.75, 0, 0], max: [1.75, 1, 1] })).toEqual([
    0.25, 1, 1,
  ]);
  // FLUSH FACES ARE NOT AN OVERLAP, and this is the case the strict `> 0` exists for: a run
  // of crates against a wall, or a tiled floor, shares a face exactly. A `>=` test would
  // report every one of them and drown the real findings — a lint an agent learns to ignore
  // returns nothing to anybody.
  expect(boxOverlap(a, { min: [1, 0, 0], max: [2, 1, 1] })).toBeNull();
  // A gap on ONE axis is enough to separate them, even with the other two fully covered.
  expect(boxOverlap(a, { min: [0, 0, 1.5], max: [1, 1, 2.5] })).toBeNull();
});

test("probeBase is the centre of the box's BASE face", () => {
  expect(probeBase({ min: [0, 2, 0], max: [4, 6, 2] })).toEqual([2, 2, 1]);
});

test("contactGap measures down to the first solid surface — and reads 0 from inside rock", () => {
  const { h } = harness();
  const cell = h.store.cellSize;

  // SELF-CALIBRATING rather than asserting an absolute floor height: the probe finds where
  // the carve's floor actually is, and every claim below is relative to that. A test that
  // hard-coded `0` would be asserting the box brush's boundary rule, which is not what this
  // function is about.
  const fromHigh = contactGap(h.store, [0, 4, 0]);
  if (fromHigh === null) throw new Error("the room fixture has no floor");
  const floorY = 4 - fromHigh;

  // A prop RESTING on it — base one tenth of a metre up — is inside the one-cell tolerance.
  const resting = contactGap(h.store, [0, floorY + 0.1, 0]);
  expect(resting).toBeCloseTo(0.1, 5);
  expect(resting).toBeLessThanOrEqual(cell);

  // A prop FLOATING two metres up is not, by a wide margin.
  const floating = contactGap(h.store, [0, floorY + 2, 0]);
  expect(floating).toBeCloseTo(2, 5);
  expect(floating).toBeGreaterThan(cell);

  // BURIED READS CONTACT, at exactly zero. Core's raycast hits its own start voxel at t=0
  // when it begins inside rock, and "sunk into the floor" is not the defect this probe hunts.
  expect(contactGap(h.store, [0, floorY - 1, 0])).toBe(0);

  // AND `null` IS A REAL ANSWER: from the top of the 32 m shaft there is no surface within
  // the probe's 30 m reach. This is the arm that says "nothing under this at all" rather
  // than "the walk gave up" — the distinction `shared/field-limits.ts` argues out.
  expect(contactGap(h.store, [40, 31, 40])).toBeNull();
});

// --- the caps and the truncation arithmetic, asserted directly ---------------
//
// `scanProps`, `findOverlaps` and `lint` were closures over `createQuery` until the T4c
// review. Module-level and exported, the cap logic is reachable without a 2100-record fixture
// and without a store — which is what lets the cases below say exactly which cap fired.
// `field-capture.ts`'s `capturePixels` is the precedent and its docblock the argument: a
// second caller that is a test is the point, not an apology.

/** A scanned prop at a position, with the gap the lint will read. Bypasses the geometry
 *  entirely — these cases are about the CAPS, not about boxes. */
const scanned = (x: number, gap: number | null, width = 0.4) => ({
  ref: {
    entityId: 1,
    archetypeId: "rock",
    at: [x, 0, 0] as [number, number, number],
  },
  aabb: {
    min: [x - width, 0, 0] as [number, number, number],
    max: [x + width, 1, 1] as [number, number, number],
  },
  base: [x, 0, 0] as [number, number, number],
  gap,
});

test("lint reads the TOLERANCE it is given — the contact rule at more than one cell size", () => {
  // The rule is "within one cell size", and taking the tolerance as an argument is what makes
  // that assertable anywhere but the editor's 0.25 m. A 0.3 m gap is contact at a 0.5 m cell
  // and floating at a 0.25 m one — one prop, two answers, decided only by the lattice.
  const props = [scanned(0, 0.3)];
  expect(lint(props, 1, 0.5).floating).toEqual([]);
  expect(lint(props, 1, 0.25).floating.length).toBe(1);
  // A null gap floats at EVERY tolerance: nothing underneath is not a small gap.
  expect(lint([scanned(0, null)], 1, 1e9).floating.length).toBe(1);
  // …and the boundary is inclusive, which is what "within one cell" means.
  expect(lint([scanned(0, 0.25)], 1, 0.25).floating).toEqual([]);
});

test("lint's two truncation causes fire independently, and each sets the flag alone", () => {
  const clean = [scanned(0, 0), scanned(10, 0)];
  // Neither cause: nothing unexamined, nothing cut.
  expect(lint(clean, 2, 0.25).truncated).toBe(false);

  // CAUSE 1 — props went unexamined. `scanned < total` with both lists EMPTY, which is the
  // exact state a silently-capped answer is indistinguishable from.
  const unexamined = lint(clean, 5000, 0.25);
  expect(unexamined.truncated).toBe(true);
  expect([unexamined.scanned, unexamined.total]).toEqual([2, 5000]);
  expect(unexamined.floating).toEqual([]);
  expect(unexamined.overlapping).toEqual([]);

  // CAUSE 2 — a list hit its report cap, with `scanned === total`. 40 floaters, 32 reported.
  const many = Array.from({ length: 40 }, (_, i) => scanned(i * 10, 9));
  const capped = lint(many, 40, 0.25);
  expect(capped.truncated).toBe(true);
  expect([capped.scanned, capped.total]).toEqual([40, 40]);
  expect(capped.floating.length).toBe(32);

  // EXACTLY at the cap is NOT truncation for `floating`, because the filter runs whole before
  // the slice — the exactness the docblock claims for that half, asserted.
  const exact = Array.from({ length: 32 }, (_, i) => scanned(i * 10, 9));
  expect(lint(exact, 32, 0.25).truncated).toBe(false);
});

test("findOverlaps stops AT the report cap rather than scanning on", () => {
  // 40 props all at one X: every pair overlaps, so an uncapped sweep would return 780. The
  // cap is what keeps the answer readable, and the count is what proves it is a CAP rather
  // than a filter that happened to match 32.
  const stacked = Array.from({ length: 40 }, () => scanned(0, 0, 1));
  expect(findOverlaps(stacked).length).toBe(32);
  // …and that state sets `truncated` through the conservative `>=` arm, which over-reports at
  // exactly 32 pairs and is the safe direction for a flag guarding against a false "clean".
  expect(lint(stacked, 40, 0.25).truncated).toBe(true);
});

test("scanProps stops at the WORK cap — 2100 records in, 2048 examined", () => {
  // The cost ceiling, asserted on the function that enforces it rather than inferred from an
  // answer. No catalog and a bare store: every record measures at the fallback and every
  // probe hits solid rock immediately, so this is the cap and nothing else.
  const store = createFieldStore();
  const owned = Array.from({ length: 2100 }, (_, i) => ({
    entityId: 1,
    record: record([i * 2, 0, 0]),
  }));
  expect(scanProps(store, owned, new Map()).length).toBe(2048);
  // Under the cap, everything is examined.
  expect(scanProps(store, owned.slice(0, 10), new Map()).length).toBe(10);
});

// --- the two pins the plan names --------------------------------------------

test("PIN: a deliberately-overlapping pair reports its overlap", () => {
  const { h, deps } = harness();
  // Two fallback cubes (0.5 m across) whose centres are 0.3 m apart on X: they interpenetrate
  // by 0.2 m on X and completely on Y and Z. Both are placed BELOW the floor so neither can
  // also show up as floating — this case is about the overlap and nothing else.
  h.log.ops.push(placementOp(50, [record([0, -1, 0]), record([0.3, -1, 0])]));
  h.log.ops.push(entityOp(51, "scatter", [50, 50]));

  const answer = entitiesArm(createQuery(deps).answer({ about: "entities" }));
  expect(answer.props.total).toBe(2);
  expect(answer.props.overlapping.length).toBe(1);
  const pair = answer.props.overlapping[0];
  if (pair === undefined) throw new Error("expected one reported pair");
  // THE PENETRATION IS THE ACTIONABLE HALF — 0.2 m on X is how far one of them has to move.
  expect(pair.overlap[0]).toBeCloseTo(0.2, 5);
  expect(pair.overlap[1]).toBeCloseTo(0.5, 5);
  expect(pair.overlap[2]).toBeCloseTo(0.5, 5);
  // Both ends name the entity whose span placed them, which is the only locator an agent has
  // a verb for.
  expect([pair.a.entityId, pair.b.entityId]).toEqual([51, 51]);
  // …and the list is not merely non-empty by accident: nothing was cut.
  expect(answer.props.truncated).toBe(false);
});

test("PIN: a floating prop reports no floor contact, and a resting one does not appear", () => {
  const { h, deps } = harness();
  // Three props in the carved room, far enough apart on X that none of them overlaps:
  //  - buried (base inside the rock)      → contact, gap 0
  //  - floating six metres up             → no contact, a measurable gap
  //  - floating at the top of the shaft   → no contact, and NO surface within reach
  h.log.ops.push(
    placementOp(50, [
      record([0, -1, 0]),
      record([4, 6, 0]),
      record([40, 31, 40]),
    ]),
  );
  h.log.ops.push(entityOp(51, "scatter", [50, 50]));

  const answer = entitiesArm(createQuery(deps).answer({ about: "entities" }));
  expect(answer.props.total).toBe(3);
  expect(answer.props.overlapping).toEqual([]);

  // EXACTLY THE TWO FLOATERS. The buried one's absence is half the pin: a rule that reported
  // everything would satisfy "the floating prop is listed" and say nothing.
  expect(answer.props.floating.length).toBe(2);
  const byX = [...answer.props.floating].sort((a, b) => a.at[0] - b.at[0]);
  const [midair, inShaft] = byX;
  if (midair === undefined || inShaft === undefined)
    throw new Error("expected two floaters");

  // A MEASURED GAP, not just a boolean: the prop's base is at 6 − 0.25 = 5.75 and the floor
  // is at ~0, so the answer tells a caller how far to drop it.
  expect(midair.gap).not.toBeNull();
  expect(midair.gap ?? 0).toBeGreaterThan(5);
  // `base` IS THE PROBE'S OWN ORIGIN — the centre of the box's base face — so the finding can
  // be re-derived with `{about:"ray", origin: base, dir:[0,-1,0]}` rather than merely
  // believed. That round trip is asserted below.
  expect(midair.base).toEqual([4, 5.75, 0]);

  // …and the other floater has NO floor at all within the probe's reach.
  expect(inShaft.gap).toBeNull();

  // THE RE-DERIVATION, which is the posture applied to the tool's own output: the ray arm run
  // from the reported `base` reproduces the reported `gap`.
  const probe = createQuery(deps).answer({
    about: "ray",
    origin: midair.base,
    dir: [0, -1, 0],
  });
  if (probe.about !== "ray") throw new Error("expected the ray arm");
  if (probe.hit === null) throw new Error("expected the re-probe to hit");
  expect(midair.base[1] - probe.hit.point[1]).toBeCloseTo(midair.gap ?? -1, 5);
});

// --- the rest of the entities arm -------------------------------------------

test("the LIST row is three fields — the fat ones are ABSENT, not merely unasserted", () => {
  const { h, deps } = harness();
  h.entities = [entityInfo(3, "hall")];
  h.footprints.set(3, { min: [0, 0, 0], max: [2, 2, 2] });

  const answer = entitiesArm(createQuery(deps).answer({ about: "entities" }));
  // **THE WHOLE-OBJECT `toEqual` IS THE PIN, and it is the only shape of assertion that can
  // hold this reshape (T5).** Asserting the three slim fields are PRESENT stays green over a
  // row that also still carries `seed`, `region`, `frozen`, `baked` and `placed` — i.e. over
  // the reshape not having happened at all. What the split bought is the absence, so the
  // absence is what is asserted. `params` and `opSpan` were never here and ride the same
  // match.
  expect(answer.entities).toEqual([
    {
      entityId: 3,
      generator: "hall",
      footprint: { min: [0, 0, 0], max: [2, 2, 2] },
    },
  ]);

  // An entity with NO footprint answers null rather than an invented box.
  h.footprints.clear();
  const bare = entitiesArm(createQuery(deps).answer({ about: "entities" }));
  expect(bare.entities[0]?.footprint).toBeNull();
});

test("`entityTotal` counts the committed entities — the honesty signal a bound would use", () => {
  const { h, deps } = harness();
  expect(
    entitiesArm(createQuery(deps).answer({ about: "entities" })).entityTotal,
  ).toBe(0);

  h.entities = [entityInfo(3, "hall"), entityInfo(5, "maze")];
  const answer = entitiesArm(createQuery(deps).answer({ about: "entities" }));
  // EQUAL TO THE LIST LENGTH, asserted as such rather than as the literal 2 — nothing is cut
  // today, so the two agreeing IS the claim. The day they differ is the day a bound lands, and
  // this case is what would then have to be rewritten deliberately.
  expect(answer.entityTotal).toBe(answer.entities.length);
  expect(answer.entityTotal).toBe(2);
});

test("the DETAIL arm carries what the list dropped — for ONE entity", () => {
  const { h, deps } = harness();
  h.entities = [
    entityInfo(3, "hall"),
    { ...entityInfo(4, "maze"), frozen: true, baked: true },
  ];
  h.footprints.set(4, { min: [0, 0, 0], max: [2, 2, 2] });

  const answer = createQuery(deps).answer({ about: "entity", entityId: 4 });
  if (answer.about !== "entity") throw new Error("expected the entity arm");
  // A SUPERSET of the list row, matched whole: the three the list keeps plus the five it
  // drops, and nothing else. `params` and `opSpan` are still refused — the projection argument
  // that predates the split is unchanged by it.
  expect(answer.entity).toEqual({
    entityId: 4,
    generator: "maze",
    footprint: { min: [0, 0, 0], max: [2, 2, 2] },
    seed: 7,
    region: { min: [0, 0, 0], max: [4, 4, 4] },
    // BOOLEANS where core spells absence as absent — and asserted on the entity that HAS
    // them, so the conversion is visible rather than defaulting to false either way.
    frozen: true,
    baked: true,
    placed: [],
  });
  // The id is ECHOED beside the record, so an answer is self-describing.
  expect(answer.entityId).toBe(4);

  // …and it answers about the entity ASKED FOR, not the first one. A `find` that ignored its
  // predicate would pass every assertion above if entity 4 were alone in the list.
  const first = createQuery(deps).answer({ about: "entity", entityId: 3 });
  if (first.about !== "entity") throw new Error("expected the entity arm");
  expect(first.entity?.generator).toBe("hall");
  // The absent booleans on THIS one become false rather than undefined.
  expect([first.entity?.frozen, first.entity?.baked]).toEqual([false, false]);
});

test("an unknown entityId answers null — a fact about the world, not a broken call", () => {
  // THE RACE THE SPLIT CREATES, pinned: a caller lists, the human deletes a row, the caller
  // asks about it. `null` says "no entity carries that id" and the echoed `entityId` says
  // which — a throw here would reach the agent as `internal`, i.e. "the editor broke", for a
  // question that has a true answer.
  const { h, deps } = harness();
  h.entities = [entityInfo(3, "hall")];
  const answer = createQuery(deps).answer({ about: "entity", entityId: 41 });
  if (answer.about !== "entity") throw new Error("expected the entity arm");
  expect(answer).toEqual({ about: "entity", entityId: 41, entity: null });
});

test("an empty world answers empty lists with `truncated: false` — nothing is wrong", () => {
  const { deps } = harness();
  const answer = entitiesArm(createQuery(deps).answer({ about: "entities" }));
  expect(answer.props).toEqual({
    total: 0,
    scanned: 0,
    floating: [],
    overlapping: [],
    truncated: false,
  });
});

test("past the work cap the lists are a FLOOR, and `truncated` says so", () => {
  const { h, deps } = harness();
  // 2100 props, above the module's 2048 cap. Every one is in SOLID ROCK — they march out
  // along +X past the carved room, and an unallocated chunk reads as solid — so the FLOATING
  // list is empty; they are 2 m apart, so the OVERLAPPING list is too. That is exactly the
  // state a silently-capped answer would be indistinguishable from, which is the point:
  // `truncated` plus `scanned < total` is what stops "no findings" reading as "nothing is
  // wrong".
  const many: PlacementRecord[] = [];
  for (let i = 0; i < 2100; i++) many.push(record([i * 2, -1, 0]));
  h.log.ops.push(placementOp(50, many));
  h.log.ops.push(entityOp(51, "scatter", [50, 50]));

  const answer = entitiesArm(createQuery(deps).answer({ about: "entities" }));
  expect(answer.props.total).toBe(2100);
  expect(answer.props.scanned).toBe(2048);
  expect(answer.props.floating).toEqual([]);
  expect(answer.props.overlapping).toEqual([]);
  expect(answer.props.truncated).toBe(true);
});

test("a lint list is cut at its report cap, and that ALSO sets `truncated`", () => {
  const { h, deps } = harness();
  // 40 floaters, above the 32-row report cap and below the 2048 work cap — so the OTHER
  // truncation cause fires, with `scanned === total`.
  //
  // ALL FORTY INSIDE THE CARVED ROOM, which the first draft of this fixture got wrong by
  // marching them out along +X: past the carve every prop sits in solid rock and reads as
  // RESTING, so only five of them floated. Two rows of twenty at 0.7 m spacing fit inside
  // x ∈ [−8, 8] and clear the 0.5 m fallback cube, so none of them overlaps either.
  const many: PlacementRecord[] = [];
  for (let i = 0; i < 40; i++)
    many.push(record([-7 + (i % 20) * 0.7, 6, i < 20 ? -2 : 2]));
  h.log.ops.push(placementOp(50, many));
  h.log.ops.push(entityOp(51, "scatter", [50, 50]));

  const answer = entitiesArm(createQuery(deps).answer({ about: "entities" }));
  expect(answer.props.scanned).toBe(40);
  expect(answer.props.total).toBe(40);
  expect(answer.props.floating.length).toBe(32);
  expect(answer.props.truncated).toBe(true);
});

test("a prop is measured at its CATALOG collision — not at the fallback", () => {
  // **THE CASE THE FIRST DRAFT OF THIS SUITE DID NOT HAVE, and the gap was a live production
  // hazard rather than a coverage statistic.** Every fixture ran against an empty catalog, so
  // all 19 cases stayed green with the lookup replaced by a bare `FALLBACK_COLLISION`
  // (measured at review). If that regressed in a real project every prop would measure as a
  // 0.5 m cube: a 4 m pillar reports as floating (its true base is on the floor, the cube's
  // is 1.75 m above it) and never as overlapping — both lint lists wrong, from the one verb
  // whose whole purpose is to be trusted over a rendered image.
  const { h, deps } = harness();
  // A PILLAR: 1 m across and 4 m tall, nothing like the 0.5 m fallback cube on any axis, so
  // no expected number below can be produced by the wrong primitive.
  h.catalog.set("pillar", {
    id: "pillar",
    name: "Pillar",
    color: [0.5, 0.5, 0.5],
    collision: { kind: "box", halfExtents: [0.5, 2, 0.5] },
    scatter: {},
  });
  // Centre at y = 2, so the pillar's base is exactly on the room's floor at y = 0 and it is
  // RESTING. Under the fallback the same record's base would be at 1.75 — floating.
  h.log.ops.push(
    placementOp(50, [
      { ...record([0, 2, 0]), archetypeId: "pillar" },
      // A second record naming an archetype the catalog does NOT define, in the same scan, so
      // this case pins the seeding and the fallback against each other rather than one at a
      // time. Placed clear of the pillar on X.
      record([6, 6, 0]),
    ]),
  );
  h.log.ops.push(entityOp(51, "scatter", [50, 50]));

  const answer = entitiesArm(createQuery(deps).answer({ about: "entities" }));
  expect(answer.props.scanned).toBe(2);
  // THE SEEDED ONE RESTS. Its `at` is the collision box's centre — y = 2, which only the real
  // 4 m primitive produces.
  expect(answer.props.floating.map((p) => p.archetypeId)).toEqual(["rock"]);

  // THE FALLBACK ONE FLOATS, at the fallback's own half-extent below its centre. The catalog
  // SEEDS and never gates: a prop the viewport would still draw is one this answer still
  // sees, rather than being skipped.
  const fell = answer.props.floating[0];
  if (fell === undefined) throw new Error("expected the uncatalogued prop");
  expect(fell.base).toEqual([6, 5.75, 0]);
  expect(fell.at).toEqual([6, 6, 0]);
});

test("the catalog's EXTENTS drive the overlap test too, not just contact", () => {
  // The other half, because contact reads only the box's BASE and would survive a primitive
  // that was the right height and the wrong width. Two pillars 1 m apart on X: at the
  // catalog's 1 m width their faces are flush (touching is not overlapping), and at the
  // fallback's 0.5 m they are half a metre apart. So a fallback regression would report
  // nothing here either — which is why the case that catches it is the WIDER pair below.
  const { h, deps } = harness();
  h.catalog.set("pillar", {
    id: "pillar",
    name: "Pillar",
    color: [0.5, 0.5, 0.5],
    collision: { kind: "box", halfExtents: [0.5, 2, 0.5] },
    scatter: {},
  });
  // 0.6 m apart: the catalogued pillars interpenetrate by 0.4 m on X, while two fallback
  // cubes at that spacing miss each other entirely.
  h.log.ops.push(
    placementOp(50, [
      { ...record([0, 2, 0]), archetypeId: "pillar" },
      { ...record([0.6, 2, 0]), archetypeId: "pillar" },
    ]),
  );
  h.log.ops.push(entityOp(51, "scatter", [50, 50]));

  const answer = entitiesArm(createQuery(deps).answer({ about: "entities" }));
  expect(answer.props.overlapping.length).toBe(1);
  const pair = answer.props.overlapping[0];
  if (pair === undefined) throw new Error("expected one reported pair");
  expect(pair.overlap[0]).toBeCloseTo(0.4, 5);
  // …and 4 m on Y, which is the catalogued height and is unreachable from the 0.5 m cube.
  expect(pair.overlap[1]).toBeCloseTo(4, 5);
});

// --- the ray arm ------------------------------------------------------------

test("the ray arm reports the hit, the distance, and the air cell before it", () => {
  const { h, deps } = harness();
  // OFF THE ORIGIN ON PURPOSE, and the first draft of this case was not — measured by
  // sabotage rather than supposed. From `[0, 4, 0]` the hit voxel is `[0, -1, 0]` and the
  // sample above it is `[0, 0, 0]`, so `prev` replaced wholesale by `[0, 0, 0]` still
  // satisfied every assertion here: the pin passed with its own subject deleted. At
  // `[3, 4, -2]` the lateral sample indices are 12 and −8, so a zeroed `prev` reds.
  const answer = createQuery(deps).answer({
    about: "ray",
    origin: [3, 4, -2],
    dir: [0, -1, 0],
  });
  if (answer.about !== "ray") throw new Error("expected the ray arm");
  if (answer.hit === null)
    throw new Error("expected a hit on the room's floor");
  // The DISTANCE is derived here rather than carried by core, so it is worth asserting
  // against the geometry rather than against itself: the hit is directly below the origin.
  expect(answer.hit.distance).toBeCloseTo(4 - answer.hit.point[1], 5);
  expect(answer.hit.distance).toBeGreaterThan(3);
  // `prev` is the last sample before the hit — the air cell a fill would land in — and for a
  // ray travelling −Y it is the solid sample's neighbour one step up, laterally IDENTICAL.
  // The whole triple, not just the Y: that is the half the origin change above makes real.
  expect(answer.hit.prev).toEqual([
    answer.hit.voxel[0],
    answer.hit.voxel[1] + 1,
    answer.hit.voxel[2],
  ]);
  // …and the lateral indices are the non-zero ones the fixture was moved for, so a zeroed
  // `prev` cannot satisfy the line above by coincidence.
  expect(answer.hit.voxel[0]).toBe(12);
  expect(answer.hit.voxel[2]).toBe(-8);
  // The reach actually used is ECHOED, which is what makes a `null` hit legible.
  expect(answer.maxDist).toBe(30);
  expect(h.store.chunks.size).toBeGreaterThan(0);
});

test("the ray arm answers null past its reach, and honours a caller's maxDist", () => {
  const { deps } = harness();
  const q = createQuery(deps);
  // Straight UP out of the room: nothing but air for 10 m, then rock — reachable at the
  // default and not at 1 m.
  const near = q.answer({
    about: "ray",
    origin: [0, 4, 0],
    dir: [0, 1, 0],
    maxDist: 1,
  });
  if (near.about !== "ray") throw new Error("expected the ray arm");
  expect(near.hit).toBeNull();
  expect(near.maxDist).toBe(1);

  const far = q.answer({ about: "ray", origin: [0, 4, 0], dir: [0, 1, 0] });
  if (far.about !== "ray") throw new Error("expected the ray arm");
  expect(far.hit).not.toBeNull();
});

test("the ray arm CLAMPS maxDist to MAX_PROBE_M rather than leaning on the door", () => {
  // The host's half of the two-postures split: the daemon REFUSES out of range (a schema is
  // an advertisement), and the host clamps because it is also reachable from a test and from
  // any in-process caller. Before the clamp this module's own contract — that a `null` hit
  // means "nothing there" rather than "the walk ran out of steps" — depended on a sibling
  // door being in the call path. `maxDist` is echoed, so the clamp is visible rather than
  // silent.
  const { deps } = harness();
  const answer = createQuery(deps).answer({
    about: "ray",
    origin: [0, 4, 0],
    dir: [0, -1, 0],
    maxDist: 1e9,
  });
  if (answer.about !== "ray") throw new Error("expected the ray arm");
  expect(answer.maxDist).toBe(MAX_PROBE_M);
  // A value UNDER the ceiling is untouched — the clamp is a ceiling, not a substitution.
  const near = createQuery(deps).answer({
    about: "ray",
    origin: [0, 4, 0],
    dir: [0, -1, 0],
    maxDist: 5,
  });
  if (near.about !== "ray") throw new Error("expected the ray arm");
  expect(near.maxDist).toBe(5);
});

test("an `about` no arm handles THROWS — it does not answer about entities", () => {
  // THE EXHAUSTIVENESS GUARD's runtime half. Its compile-time half is a `never` binding and is
  // the one that matters (a fourth arm added to the wire type stops the build), but the
  // binding alone would let a request forged past the daemon's schema fall through. The
  // defect this replaces: an if-chain ending in a bare `return entitiesAnswer()`, which
  // answered confidently about the whole world for any unknown `about`.
  const { deps } = harness();
  const forged = { about: "lights" } as unknown as SessionQueryRequest;
  expect(() => createQuery(deps).answer(forged)).toThrow(
    /no arm for about=lights/,
  );
});

test("a non-unit direction measures the same distance — and is ECHOED as the caller sent it", () => {
  const { deps } = harness();
  const q = createQuery(deps);
  const unit = q.answer({ about: "ray", origin: [0, 4, 0], dir: [0, -1, 0] });
  const long = q.answer({ about: "ray", origin: [0, 4, 0], dir: [0, -17, 0] });
  if (unit.about !== "ray" || long.about !== "ray")
    throw new Error("expected two ray arms");
  // `maxDist` is in METRES whatever the direction's length. That is CORE's contract rather
  // than this module's, surfaced here because it is the half a caller would most reasonably
  // get wrong — a 17-long direction does not mean a 17× reach.
  expect(long.hit?.distance).toBeCloseTo(unit.hit?.distance ?? -1, 5);
  // THE ECHO IS THIS MODULE'S CLAIM, and it is the one a sabotage can reach: the answer
  // reports the direction the CALLER sent, not the unit vector the engine walked. A
  // normalized echo would silently rewrite the request in the reply an agent reads back.
  expect(long.dir).toEqual([0, -17, 0]);
  // …and it is a COPY, not the request's own array.
  const sent: [number, number, number] = [0, -17, 0];
  const echoed = q.answer({ about: "ray", origin: [0, 4, 0], dir: sent });
  if (echoed.about !== "ray") throw new Error("expected the ray arm");
  expect(echoed.dir).not.toBe(sent);
  expect(echoed.dir).toEqual(sent);
});

// --- the selection arm ------------------------------------------------------

test("the selection arm answers the SPEC and the shape — never the cells", () => {
  const { h, deps } = harness();
  h.selection = {
    spec: { kind: "flood-void", seed: [1, 2, 3], budget: 200_000 },
    count: 1234,
    truncated: true,
    aabb: { min: [0, 0, 0], max: [3, 3, 3] },
    // The display cap — a fact about the human's SCREEN. It must not travel.
    displayed: 40,
  };
  const answer = createQuery(deps).answer({ about: "selection" });
  if (answer.about !== "selection")
    throw new Error("expected the selection arm");
  expect(answer.selection).toEqual({
    spec: { kind: "flood-void", seed: [1, 2, 3], budget: 200_000 },
    count: 1234,
    truncated: true,
    aabb: { min: [0, 0, 0], max: [3, 3, 3] },
  });
  // THE WHOLE-OBJECT MATCH IS THE ASSERTION. `displayed` is absent, and so is any `cells`
  // member — 262 144 coordinates is what this arm exists NOT to send, and a projection that
  // grew one would fail here rather than at the token budget.
});

// --- the generators arm (T5) ------------------------------------------------

test("the generators arm RELAYS the host's projection — it authors no second schema", () => {
  const { h, deps } = harness();
  const stub: FieldGeneratorInfo = {
    id: "stub",
    name: "Stub",
    paramSchema: { type: "object", properties: { widget: { type: "number" } } },
    defaults: { widget: 3 },
    placesProps: false,
    usesSeed: true,
  };
  h.generators = [stub];

  const answer = createQuery(deps).answer({ about: "generators" });
  if (answer.about !== "generators")
    throw new Error("expected the generators arm");
  // BY IDENTITY, which is the whole claim of a pass-through: the seam adds nothing and copies
  // nothing, because the facade already `structuredClone`s per call. `toEqual` would stay green
  // over a seam that rebuilt the record field by field — which is exactly where a member
  // silently stops being forwarded (`session-mutation.test.ts` measured that failure).
  expect(answer.generators[0]).toBe(stub);
});

test("the generators arm re-reads per call — a swapped catalog is not a photograph", () => {
  // WHY THE DEP IS A CALL. `listGenerators()` folds the project's archetype ids into every
  // `archetypeId` param, so the projection changes when `setEntityCatalog` runs. A dep held as
  // an array would go on advertising archetypes the project no longer has.
  const { h, deps } = harness();
  const q = createQuery(deps);
  expect(
    (q.answer({ about: "generators" }) as { generators: unknown[] }).generators,
  ).toEqual([]);
  h.generators = [
    {
      id: "late",
      name: "Late",
      paramSchema: {},
      defaults: {},
      placesProps: true,
      usesSeed: false,
    },
  ];
  const after = q.answer({ about: "generators" });
  if (after.about !== "generators")
    throw new Error("expected the generators arm");
  expect(after.generators.map((g) => g.id)).toEqual(["late"]);
});

test("no selection answers null, not an empty selection", () => {
  const { deps } = harness();
  const answer = createQuery(deps).answer({ about: "selection" });
  if (answer.about !== "selection")
    throw new Error("expected the selection arm");
  expect(answer.selection).toBeNull();
});

// --- read-only, and copies --------------------------------------------------

test("the read WRITES NOTHING — the store, the log and the answer's boxes are all safe", () => {
  const { h, deps } = harness();
  h.entities = [entityInfo(3, "hall")];
  h.footprints.set(3, { min: [0, 0, 0], max: [2, 2, 2] });
  h.log.ops.push(placementOp(50, [record([0, 6, 0])]));
  h.log.ops.push(entityOp(51, "scatter", [50, 50]));

  const before = fieldSnapshot(h.store);
  const opsBefore = h.log.ops.length;
  const undoBefore = h.log.undoStack.length;
  const q = createQuery(deps);
  q.answer({ about: "entities" });
  q.answer({ about: "entity", entityId: 3 });
  q.answer({ about: "generators" });
  q.answer({ about: "ray", origin: [0, 4, 0], dir: [0, -1, 0] });
  q.answer({ about: "selection" });
  // THE `readOnlyHint` THE DOOR ADVERTISES (T4c Task 6, `daemon/mcp.ts`'s `session_query`
  // row), EARNED here. Nothing on any of the three paths touches the store, the log or the
  // undo stacks — the annotation is a HINT by specification, so this is the only thing that
  // makes it true.
  //
  // CONTENTS, NOT `chunks.size` — and the first draft of this case compared the size, which
  // is the guard that cannot see the realistic write. Measured at review: injecting a
  // `setDensity(store, 0, 0, 0, -127)` into the query path left the size-based version GREEN,
  // because writing into an ALREADY-ALLOCATED chunk changes no key. Every probe here runs
  // through carved space by definition, so an allocated chunk is exactly where a regression
  // would land. Only a write into virgin space (which allocates) moved the old number.
  expect(fieldSnapshot(h.store)).toEqual(before);
  expect(h.log.ops.length).toBe(opsBefore);
  expect(h.log.undoStack.length).toBe(undoBefore);

  // AND THE BOXES ARE COPIES. A caller mutating what it was handed must not reach into the
  // footprint memo — which is host state the camera framing and the pick both read.
  const answer = entitiesArm(q.answer({ about: "entities" }));
  const footprint = answer.entities[0]?.footprint;
  if (footprint === undefined || footprint === null)
    throw new Error("expected a footprint");
  footprint.min[0] = 999;
  expect(h.footprints.get(3)?.min[0]).toBe(0);
});

// --- the facade wiring ------------------------------------------------------

test("the HOST's query member reaches the seam over the real substrate", () => {
  // No GPU: every path is store and log work (`field-host-headless.test.ts`' set).
  const host = createFieldHost();
  host.setMaterialTable(TABLE);

  // An empty world first, so the arms are reachable before anything exists.
  const empty = host.query({ about: "entities" });
  if (empty.about !== "entities") throw new Error("expected the entities arm");
  expect(empty.entities).toEqual([]);
  expect(empty.props.total).toBe(0);

  // …then a committed generator, so the entity projection is fed by the REAL log rather than
  // by a stub list. This is the half a module-level harness cannot see: that the facade
  // handed the seam `entities.list` and `entities.footprints` and not something else.
  const out = host.generate({
    generatorId: "hall",
    region: { min: [0, 0, 0], max: [8, 5, 8] },
  });
  if (!out.ok) throw new Error(`expected a commit, got: ${out.message}`);
  const answer = host.query({ about: "entities" });
  if (answer.about !== "entities") throw new Error("expected the entities arm");
  expect(answer.entities.map((e) => e.entityId)).toEqual([out.entityId]);
  expect(answer.entities[0]?.generator).toBe("hall");
  expect(answer.entityTotal).toBe(1);
  // The footprint came off the host's own memo, so it is a real box rather than the null a
  // mis-wired dep would produce.
  expect(answer.entities[0]?.footprint).not.toBeNull();

  // …and the DETAIL arm reaches the same record through the same dep, with the fields the
  // list drops. `seed` is the one that matters at this level: the facade committed it, so a
  // real number here says the detail arm read the LOG rather than a stub.
  const detail = host.query({ about: "entity", entityId: out.entityId });
  if (detail.about !== "entity") throw new Error("expected the entity arm");
  expect(detail.entity?.generator).toBe("hall");
  expect(typeof detail.entity?.seed).toBe("number");
  expect(detail.entity?.region).toEqual({ min: [0, 0, 0], max: [8, 5, 8] });
  // An id nothing carries is null even over the real host.
  const missing = host.query({ about: "entity", entityId: 999_999 });
  if (missing.about !== "entity") throw new Error("expected the entity arm");
  expect(missing.entity).toBeNull();

  // The ray arm sees what `generate` carved: a hall's floor is under the region's centre.
  const ray = host.query({ about: "ray", origin: [4, 4, 4], dir: [0, -1, 0] });
  if (ray.about !== "ray") throw new Error("expected the ray arm");
  expect(ray.hit).not.toBeNull();

  // And the selection arm is wired to the selection seam, which on a fresh host holds
  // nothing — `null`, not a throw and not an empty selection.
  const selection = host.query({ about: "selection" });
  if (selection.about !== "selection")
    throw new Error("expected the selection arm");
  expect(selection.selection).toBeNull();
});

test("the generators arm round-trips a REAL param schema off the real registry", () => {
  // **THE PIN THE WHOLE ARM EXISTS FOR (T5).** The gap it closes is that an agent could NAME a
  // generator and not read its params, so what has to be true is not "an answer arrived" but
  // "a param an agent could actually pass came back with its rules attached". Asserted against
  // a name READ OUT OF `packages/core/src/field/generators.ts` — a plausible-looking invented
  // key would satisfy any presence check vacuously and pin nothing.
  const host = createFieldHost();
  const answer = host.query({ about: "generators" });
  if (answer.about !== "generators")
    throw new Error("expected the generators arm");

  const byId = new Map(answer.generators.map((g) => [g.id, g]));
  // The registry's own four, which is also what `generate`'s refusal lists.
  expect([...byId.keys()].sort()).toEqual(["cave", "hall", "maze", "scatter"]);

  const hall = byId.get("hall");
  if (hall === undefined) throw new Error("expected the hall generator");
  // `paramSchema` is JSON Schema, so the params are under `properties` — and `pillarSpacing`
  // is a real HALL param with a real range. The RANGE is half the value of this arm: an agent
  // that can read `minimum`/`maximum` can tune without a round trip per guess.
  const properties = (
    hall.paramSchema as { properties?: Record<string, unknown> }
  ).properties;
  const pillarSpacing = properties?.["pillarSpacing"] as
    | Record<string, unknown>
    | undefined;
  expect(pillarSpacing).toBeDefined();
  expect({
    type: pillarSpacing?.["type"],
    bounded:
      typeof pillarSpacing?.["minimum"] === "number" &&
      typeof pillarSpacing?.["maximum"] === "number",
  }).toEqual({ type: "number", bounded: true });
  // …and `defaults` describes the SAME params, key for key. That is what makes "omit params
  // entirely and it still works" checkable rather than believed — a defaults record that had
  // drifted from the schema would mean an agent reading one and being validated by the other.
  const declared = new Set(Object.keys(properties ?? {}));
  expect(
    Object.keys(hall.defaults).filter((key) => !declared.has(key)),
  ).toEqual([]);
  expect(hall.defaults["pillarSpacing"]).toBeDefined();

  // **THE KEY SET, EXACTLY — the price of relaying instead of projecting.** A seventh member
  // added to `FieldGeneratorInfo` for the stamp form's sake would reach an agent without
  // anybody deciding it should. This reds instead, and the decision gets made.
  expect(Object.keys(hall).sort()).toEqual([
    "defaults",
    "id",
    "name",
    "paramSchema",
    "placesProps",
    "usesSeed",
  ]);
  // The two declarative booleans are the registry's own, not defaults: the hall is the ONE
  // seedless generator and it places nothing.
  expect({ usesSeed: hall.usesSeed, placesProps: hall.placesProps }).toEqual({
    usesSeed: false,
    placesProps: false,
  });
  expect(byId.get("scatter")?.placesProps).toBe(true);
});
