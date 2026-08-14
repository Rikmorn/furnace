import { describe, expect, test } from "bun:test";
import type {
  BrushOp,
  ChunkKey,
  EntityOp,
  FieldStore,
  GeneratorEntity,
  MaterialTable,
  OpLog,
} from "@furnace/core/field";
import {
  bakeGeneratorEntity,
  CHUNK_DIM,
  commitGenerator,
  createFieldStore,
  createOpLog,
  generatorById,
  getDensity,
  logApply,
  logApplyPatch,
  reconfigureGenerator,
  redo,
  setGeneratorFrozen,
  undo,
  worldToVoxel,
} from "@furnace/core/field";
import { snapshotAll } from "../../tests/_helpers/field-store.ts";
// In-core helpers, deliberately NOT on the public index (the spliceOps
// precedent). materialsEqual is used here only to prove the density-only drift
// case's premise — that the material channel really is untouched; its own unit
// tests live in field-materials.test.ts, which owns that module.
// evaluateGenerator is the in-core evaluate seam (also off the index) — the
// re-cook tests compare a reconfigure's records against a fresh evaluate.
import { evaluateGenerator } from "./generators.ts";
import { materialsEqual } from "./materials.ts";
import { imagesOf, PATCH_MASK_BYTES } from "./ops.ts";

// Own copy of the 3-class fixture (rock / dirt / kit masonry) — stamps REQUIRE
// a kit class, so BUILTIN_TABLE cannot drive one. Per repo convention each test
// file owns its fixture rather than sharing a module.
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
const KIT_CLASS_ID = 2;

const HALL = generatorById("hall");

// Geometry at cellSize 0.25 (sample = metres × 4), coarse CELL 0.5 m. Origin =
// snapDown(region.min). A `depth` d hall stamps AABB [0,0,0]..[5, 4, (d+2)/2]
// from origin [0,0,0]: interior air cells k ∈ [1..d], shell at k = 0 and
// k = d+1. depth 4 / 8 / 12 evaluate to spans of 31 / 55 / 79 ops (probe-
// measured), so a depth change genuinely resizes the span in BOTH directions.
const makeWorld = (): { store: FieldStore; log: OpLog } => ({
  store: createFieldStore(),
  log: createOpLog(),
});

const hallParams = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...structuredClone(HALL.defaults),
  ...overrides,
});

const regionAt = (
  min: [number, number, number],
): { min: [number, number, number]; max: [number, number, number] } => ({
  min,
  max: [min[0] + 8, min[1] + 8, min[2] + 8],
});

const commitHall = (
  store: FieldStore,
  log: OpLog,
  overrides: Record<string, unknown> = {},
  min: [number, number, number] = [0, 0, 0],
): GeneratorEntity =>
  commitGenerator(store, log, HALL, {
    params: hallParams(overrides),
    seed: 7,
    region: regionAt(min),
    policy: "replace",
    table: TABLE,
  }).entity;

const digSphere = (
  center: [number, number, number],
  radius: number,
): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "dig",
  shape: { kind: "sphere", center, radius },
});

/** Digs through the hall's SOUTH shell (z ∈ [0, 0.5] m) — overlaps the span's
 *  chunks whatever the depth, so it is always in the affected set. */
const SHELL_DIG = digSphere([4, 2, 0.25], 1);
/** Straddles the depth-8 north shell (z ≈ 4.5 m): at depth 12 that band is
 *  interior air instead, so the op's chunk "0,0,1" reads differently after a
 *  8 → 12 reconfigure. Writes at every depth, so it is never orphaned. */
const DRIFT_DIG = digSphere([2, 2, 4.6], 0.8);
/** Paints masonry over the floor band at z ∈ [5.5, 6.5] m — virgin rock at
 *  depth 8 (so it really writes), already masonry at depth 12 (so its replay
 *  writes NOTHING: orphaned by the reconfigure, not by construction). */
const ORPHAN_PAINT: BrushOp = {
  id: 0,
  kind: "brush",
  effect: "paint",
  material: KIT_CLASS_ID,
  shape: { kind: "box", center: [2, 0.25, 6], halfExtents: [1, 0.25, 0.5] },
};
/** 200 m away — chunks 49..50 on x and z, disjoint from every hall chunk. */
const FAR_DIG = digSphere([200, 2, 200], 1);
const FAR_CHUNKS: ChunkKey[] = ["49,0,49", "50,0,49", "49,0,50", "50,0,50"];

type LogSnapshot = {
  ops: string;
  nextId: number;
  undoDepth: number;
  redoDepth: number;
};

const snapshotLog = (log: OpLog): LogSnapshot => ({
  ops: JSON.stringify(log.ops),
  nextId: log.nextId,
  undoDepth: log.undoStack.length,
  redoDepth: log.redoStack.length,
});

const entityOpOf = (log: OpLog, entityId: number): EntityOp => {
  const op = log.ops.find(
    (o): o is EntityOp => o.kind === "entity" && o.entity.entityId === entityId,
  );
  if (op === undefined) throw new Error(`test: no entity op ${entityId}`);
  return op;
};

const spanLengthOf = (e: GeneratorEntity): number =>
  e.opSpan[1] - e.opSpan[0] + 1;

/** A record carrying a field no verb in this module has an opinion about —
 *  stand-in for whatever the wire format and later slices add next. */
type Labelled = GeneratorEntity & { label?: string };

/** Id of the op just appended — narrowed, so assertions compare numbers. */
const lastOpId = (log: OpLog): number => {
  const id = log.ops.at(-1)?.id;
  if (id === undefined) throw new Error("test: the log is empty");
  return id;
};

/** The layout every committed generator keeps and reconfigure must preserve:
 *  the span's ops sit IMMEDIATELY before the entity op, with sequential ids
 *  matching `opSpan`, and `entityId` is the entity op's own id. */
const expectContiguousSpan = (log: OpLog, entityId: number): void => {
  const entityIdx = log.ops.findIndex(
    (o) => o.kind === "entity" && o.entity.entityId === entityId,
  );
  const entityOp = entityOpOf(log, entityId);
  const [first, last] = entityOp.entity.opSpan;
  const start = entityIdx - (last - first + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  for (let i = start; i < entityIdx; i++) {
    const op = log.ops[i];
    expect(op?.kind).not.toBe("entity");
    expect(op?.id).toBe(first + (i - start));
  }
  expect(entityOp.id).toBe(entityId);
};

describe("reconfigureGenerator — re-evaluate + replay", () => {
  test("re-evaluates in place and replays an overlapping downstream dig", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    logApply(store, log, SHELL_DIG, TABLE);
    const digId = lastOpId(log);
    const opsBefore = log.ops.length;
    const spanBefore = spanLengthOf(e);

    const r = reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 12 }) },
      TABLE,
    );

    // the span really resized — the array grew by exactly the difference
    expect(spanLengthOf(r.entity)).toBeGreaterThan(spanBefore);
    expect(log.ops.length).toBe(
      opsBefore + (spanLengthOf(r.entity) - spanBefore),
    );
    // the downstream dig kept its identity, its place, and its effect
    expect(lastOpId(log)).toBe(digId);
    expect(getDensity(store, 16, 8, 1)).toBe(32);
    // the record carries the new params under the SAME entityId
    const rec = entityOpOf(log, e.entityId).entity;
    expect(rec.params["depth"]).toBe(12);
    expect(rec.entityId).toBe(e.entityId);
    expect(rec.generator).toBe("hall");
    expect(rec.seed).toBe(e.seed);
    expectContiguousSpan(log, e.entityId);
    // one splice entry, redo cleared
    expect(log.undoStack.length).toBe(3);
    expect(log.undoStack.at(-1)?.kind).toBe("splice");
    expect(log.redoStack.length).toBe(0);
    // the fresh span consumed real ids: the next op cannot collide with them
    logApply(store, log, FAR_DIG, TABLE);
    const ids = log.ops.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The correctness property, and the strongest teeth in the file: it fails if
  // the pre-span restore is skipped, if the affected set misses a chunk, or if a
  // downstream op is replayed out of order.
  //
  // It holds only while every downstream op READS inside its own bounded
  // influence, which all four effects, the class-kind masks and region
  // selections do. A FLOOD-masked op reads unboundedly and can replay against
  // un-rewound end-of-log state — see the known gap on reconfigureGenerator and
  // `docs/backlog/engine-architecture/field-reconfigure-and-parse-edges.md`,
  // §"a flood-masked downstream op replays against end-of-log state".
  test("with bounded-read downstream ops, the result is byte-identical to committing the new params from the start", () => {
    const reconfigured = makeWorld();
    const e = commitHall(reconfigured.store, reconfigured.log, { depth: 12 });
    logApply(reconfigured.store, reconfigured.log, SHELL_DIG, TABLE);
    logApply(reconfigured.store, reconfigured.log, DRIFT_DIG, TABLE);
    logApply(reconfigured.store, reconfigured.log, ORPHAN_PAINT, TABLE);
    reconfigureGenerator(
      reconfigured.store,
      reconfigured.log,
      e.entityId,
      { params: hallParams({ depth: 4, pillars: "grid" }) },
      TABLE,
    );

    const direct = makeWorld();
    commitHall(direct.store, direct.log, { depth: 4, pillars: "grid" });
    logApply(direct.store, direct.log, SHELL_DIG, TABLE);
    logApply(direct.store, direct.log, DRIFT_DIG, TABLE);
    logApply(direct.store, direct.log, ORPHAN_PAINT, TABLE);

    expect(snapshotAll(reconfigured.store)).toEqual(snapshotAll(direct.store));
  });

  test("changes.params REPLACES the recorded set (a partial object is rejected)", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    expect(() =>
      reconfigureGenerator(
        store,
        log,
        e.entityId,
        { params: { depth: 12 } },
        TABLE,
      ),
    ).toThrow(/field: hall params invalid at/); // a missing required key rejects the partial
    // …and omitting `params` entirely keeps the recorded set verbatim
    const r = reconfigureGenerator(store, log, e.entityId, { seed: 9 }, TABLE);
    expect(r.entity.params).toEqual(e.params);
    expect(r.entity.seed).toBe(9);
  });

  // D-F3-3's closure is TRANSITIVE, and only a multi-hop chain proves it. The
  // three bars overlap in a line but are appended in REVERSE dependency order,
  // so a forward scan absorbs one per pass and the fixpoint needs three:
  // collapse the loop to a single pass and the outer two are never replayed,
  // while the chunk they share with their neighbour is rewound by the first
  // absorption and left holding neither op's writes. Every other test in this
  // file has at most a one-hop chain.
  test("the affected set closes TRANSITIVELY over a backwards-ordered chain", () => {
    // bar chunk ranges (probe-measured, cy = cz = 0): touchesTheHall cx 0..3,
    // middle cx 3..6, farFromTheHall cx 6..9. The hall reaches cx 0..1, so it
    // touches the first bar and nothing else.
    const bar = (y: number, x0: number, x1: number): BrushOp => ({
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: {
        kind: "box",
        center: [(x0 + x1) / 2, y, 1.25],
        halfExtents: [(x1 - x0) / 2, 0.25, 0.25],
      },
    });
    // touchesTheHall ← overlaps → middle ← overlaps → farFromTheHall
    const touchesTheHall = bar(1.25, 3, 15);
    const middle = bar(2.25, 13, 27);
    const farFromTheHall = bar(3.25, 25, 39);
    // …appended FARTHEST-FIRST, so a forward scan can absorb only one per pass
    const CHAIN = [farFromTheHall, middle, touchesTheHall];
    const build = (depth: number, world = makeWorld()) => {
      const e = commitHall(world.store, world.log, { depth });
      for (const op of CHAIN) logApply(world.store, world.log, op, TABLE);
      return { ...world, e };
    };

    const reconfigured = build(8);
    const r = reconfigureGenerator(
      reconfigured.store,
      reconfigured.log,
      reconfigured.e.entityId,
      { params: hallParams({ depth: 12 }) },
      TABLE,
    );
    // all three hops absorbed: the far end of the chain is in the affected set
    expect(r.dirty.has("9,0,0")).toBe(true);

    const direct = build(12);
    expect(snapshotAll(reconfigured.store)).toEqual(snapshotAll(direct.store));
  });

  test("a new region moves the stamp and restores the footprint it left", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    expect(store.chunks.has("0,0,0")).toBe(true);

    const r = reconfigureGenerator(
      store,
      log,
      e.entityId,
      { region: regionAt([8, 0, 8]) },
      TABLE,
    );

    expect(store.chunks.has("0,0,0")).toBe(false); // vacated, back to pristine
    expect(store.chunks.has("2,0,2")).toBe(true); // …and stamped at the new min
    expect(r.dirty.has("0,0,0")).toBe(true);
    expect(r.dirty.has("2,0,2")).toBe(true);
    expect(r.entity.region.min).toEqual([8, 0, 8]);
  });

  test("changes.policy compiles into the new span", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    const shellFillOf = (entity: GeneratorEntity): BrushOp => {
      const op = log.ops.find((o) => o.id === entity.opSpan[0]);
      if (op === undefined || op.kind !== "brush")
        throw new Error("test: the span's first op is not a brush");
      return op;
    };
    expect(shellFillOf(e).effect).toBe("fill");
    expect(shellFillOf(e).mask).toBeUndefined();

    const r = reconfigureGenerator(
      store,
      log,
      e.entityId,
      { policy: "keep-existing-air" },
      TABLE,
    );

    expect(shellFillOf(r.entity).effect).toBe("fill");
    expect(shellFillOf(r.entity).mask).toEqual({ kind: "solid-only" });
  });

  test("a downstream generator entity keeps its own span layout across the splice", () => {
    const { store, log } = makeWorld();
    const first = commitHall(store, log);
    const second = commitHall(store, log, { depth: 4 }, [8, 0, 8]);

    reconfigureGenerator(
      store,
      log,
      first.entityId,
      { params: hallParams({ depth: 12 }) },
      TABLE,
    );

    expectContiguousSpan(log, first.entityId);
    expectContiguousSpan(log, second.entityId);
    // the untouched entity's record is exactly what it committed as
    expect(entityOpOf(log, second.entityId).entity).toEqual(second);
  });

  test("a downstream PATCH op replays its absolute cells after the rewind", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    // one density cell deep inside the hall's floor shell, written absolutely
    const bit = 1 + CHUNK_DIM * (1 + CHUNK_DIM * 1); // local sample (1,1,1)
    const densityMask = new Uint8Array(PATCH_MASK_BYTES);
    densityMask[bit >> 3] = 1 << (bit & 7);
    logApplyPatch(
      store,
      log,
      {
        id: 0,
        kind: "patch",
        chunks: [
          {
            key: "0,0,0",
            densityMask,
            density: Int8Array.from([77]),
            materialMask: null,
            materials: null,
          },
        ],
      },
      TABLE,
    );
    expect(getDensity(store, 1, 1, 1)).toBe(77);

    const r = reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 12 }) },
      TABLE,
    );

    // the rewind wiped chunk "0,0,0"; only a real replay puts 77 back
    expect(getDensity(store, 1, 1, 1)).toBe(77);
    expect(r.dirty.has("0,0,0")).toBe(true);
  });

  // The rebuilt record is a SPREAD of the recorded one, so a field reconfigure
  // has no opinion about survives — `frozen`/`baked` do not exercise it (both
  // reject before the copy). Rebuild the record field-by-field instead and
  // every such field is silently dropped, with nothing else in the suite to
  // notice.
  test("a field the reconfigure has no opinion about survives on the record", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    const tagged = entityOpOf(log, e.entityId).entity as Labelled;
    tagged.label = "west wing";

    const r = reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 12 }) },
      TABLE,
    );

    const after = entityOpOf(log, e.entityId).entity as Labelled;
    expect(after.label).toBe("west wing");
    expect((r.entity as Labelled).label).toBe("west wing");
    // …and the fields reconfigure DOES own were still replaced
    expect(after.params["depth"]).toBe(12);
  });

  test("the returned entity is a copy — mutating it cannot rewrite the log", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    const r = reconfigureGenerator(store, log, e.entityId, { seed: 3 }, TABLE);
    r.entity.params["depth"] = 999;
    r.entity.region.min[0] = 999;
    expect(entityOpOf(log, e.entityId).entity.params["depth"]).toBe(8);
    expect(entityOpOf(log, e.entityId).entity.region.min[0]).toBe(0);
  });

  test("a SMALLER new span shrinks the array and keeps downstream ops intact", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log, { depth: 12 });
    logApply(store, log, SHELL_DIG, TABLE);
    logApply(store, log, FAR_DIG, TABLE);
    const tailIds = log.ops.slice(-2).map((o) => o.id);
    const opsBefore = log.ops.length;

    const r = reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 4 }) },
      TABLE,
    );

    expect(log.ops.length).toBeLessThan(opsBefore);
    expect(log.ops.slice(-2).map((o) => o.id)).toEqual(tailIds);
    expectContiguousSpan(log, e.entityId);
    expect(spanLengthOf(r.entity)).toBeLessThan(spanLengthOf(e));
    expect(getDensity(store, 16, 8, 1)).toBe(32); // the shell dig still applied
  });

  test("chunks the old span owned but the new one does not are restored AND dirtied", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log, { depth: 12 });
    expect(store.chunks.has("0,0,1")).toBe(true); // depth 12 reaches z = 7 m

    const r = reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 4 }) },
      TABLE,
    );

    // depth 4 stops at z = 3 m: the chunk is back to pristine (entry deleted)…
    expect(store.chunks.has("0,0,1")).toBe(false);
    expect(store.materials.has("0,0,1")).toBe(false);
    // …and still needs a remesh, so it must be in the dirty set
    expect(r.dirty.has("0,0,1")).toBe(true);
  });

  test("reconfigures a stamp sitting at negative chunk coordinates", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log, {}, [-8, -4, -8]);
    expect([...store.chunks.keys()].every((k) => k.startsWith("-"))).toBe(true);
    const deepDig = digSphere([-4, -2, -7.75], 1);
    logApply(store, log, deepDig, TABLE);

    const r = reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 12 }) },
      TABLE,
    );

    expect([...r.dirty].some((k) => k.startsWith("-"))).toBe(true);
    expect(getDensity(store, -16, -8, -31)).toBe(32);
    expectContiguousSpan(log, e.entityId);
  });
});

describe("reconfigureGenerator — affected-set culling", () => {
  // SABOTAGE ANCHOR: this test is the teeth for the affected-set intersection
  // in the transitive closure. With culling disabled the far dig is REPLAYED,
  // and a re-dig of cells that are already air writes nothing — so it would be
  // reported orphaned, and its chunks would enter the dirty set.
  test("an op OUTSIDE the affected set is never re-applied (culling teeth)", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    const farId = lastOpId(log);
    logApply(store, log, FAR_DIG, TABLE);
    const farDigId = lastOpId(log);
    expect(farDigId).not.toBe(farId);
    const farBefore = imagesOf(store, FAR_CHUNKS);

    const r = reconfigureGenerator(store, log, e.entityId, { seed: 8 }, TABLE);

    expect(r.drift.find((d) => d.opId === farDigId)).toBeUndefined();
    expect(
      r.drift.some((d) => d.chunks.some((k) => FAR_CHUNKS.includes(k))),
    ).toBe(false);
    for (const key of FAR_CHUNKS) expect(r.dirty.has(key)).toBe(false);
    expect(imagesOf(store, FAR_CHUNKS)).toEqual(farBefore);
  });

  // SABOTAGE ANCHOR: the teeth for `readsOutsideItsWrites`. A flood-selection
  // mask reads state far outside the op's own write cells, so the op must be
  // replayed even though its writes are disjoint from the affected set. Drop
  // that clause and the finding disappears. NOTE this proves inclusion only —
  // the replay itself can still see un-rewound state (the known gap on
  // reconfigureGenerator).
  test("a flood-masked op is replayed even when its writes are disjoint", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    const floodDig: BrushOp = {
      ...FAR_DIG,
      mask: {
        kind: "selection",
        selection: { kind: "flood-void", seed: [8, 8, 8], budget: 5000 },
      },
    };
    logApply(store, log, floodDig, TABLE);
    const floodId = lastOpId(log);

    const r = reconfigureGenerator(store, log, e.entityId, { seed: 8 }, TABLE);

    const finding = r.drift.find((d) => d.opId === floodId);
    expect(finding?.kind).toBe("orphaned");
  });
});

describe("reconfigureGenerator — drift report", () => {
  test("a downstream op whose context changed is drifted; a no-delta replay is orphaned", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    expect(logApply(store, log, DRIFT_DIG, TABLE).size).toBeGreaterThan(0);
    const digId = lastOpId(log);
    expect(logApply(store, log, ORPHAN_PAINT, TABLE).size).toBeGreaterThan(0);
    const paintId = lastOpId(log);

    const r = reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 12 }) },
      TABLE,
    );

    expect(r.drift.find((d) => d.opId === digId)?.kind).toBe("drifted");
    expect(r.drift.find((d) => d.opId === paintId)?.kind).toBe("orphaned");
    // findings arrive in log order and carry chunk-quantized locations
    expect(r.drift.map((d) => d.opId)).toEqual([digId, paintId]);
    for (const finding of r.drift) {
      expect(finding.chunks.length).toBeGreaterThan(0);
      for (const key of finding.chunks) expect(r.dirty.has(key)).toBe(true);
    }
  });

  // Pillars change which x-runs the span digs but NOT which cells its shell
  // fill paints, so the affected chunks differ in the density channel only —
  // the leg the depth cases above cannot isolate.
  test("drift is detected from the density channel alone", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    const interiorDig = digSphere([2, 2, 2], 0.6);
    expect(logApply(store, log, interiorDig, TABLE).size).toBeGreaterThan(0);
    const digId = lastOpId(log);
    const materialsBefore = new Map(store.materials);

    const r = reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ pillars: "grid" }) },
      TABLE,
    );

    for (const [key, before] of materialsBefore)
      expect(materialsEqual(before, store.materials.get(key))).toBe(true);
    expect(r.drift.find((d) => d.opId === digId)?.kind).toBe("drifted");
  });

  test("a downstream op the reconfigure did not disturb produces no finding", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    logApply(store, log, SHELL_DIG, TABLE);
    const digId = lastOpId(log);
    // same params, same seed: the new span is byte-identical to the old one
    const r = reconfigureGenerator(store, log, e.entityId, {}, TABLE);
    expect(r.drift.find((d) => d.opId === digId)).toBeUndefined();
  });
});

describe("reconfigureGenerator — undo / redo", () => {
  test("undo restores the ENTIRE reconfigure exactly; redo re-applies it", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    logApply(store, log, DRIFT_DIG, TABLE);
    logApply(store, log, ORPHAN_PAINT, TABLE);
    const beforeStore = snapshotAll(store);
    const beforeLog = snapshotLog(log);

    reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 12 }) },
      TABLE,
    );
    const afterStore = snapshotAll(store);
    const afterOps = JSON.stringify(log.ops);
    expect(afterOps).not.toBe(beforeLog.ops);

    undo(store, log);
    expect(snapshotAll(store)).toEqual(beforeStore);
    expect(JSON.stringify(log.ops)).toBe(beforeLog.ops);
    expect(log.undoStack.length).toBe(beforeLog.undoDepth);
    expect(log.redoStack.length).toBe(1);

    redo(store, log, TABLE);
    expect(snapshotAll(store)).toEqual(afterStore);
    expect(JSON.stringify(log.ops)).toBe(afterOps);
    expect(log.redoStack.length).toBe(0);
  });

  test("undo leaves nextId advanced — ids stay unique afterwards", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 12 }) },
      TABLE,
    );
    const advanced = log.nextId;
    undo(store, log);
    expect(log.nextId).toBe(advanced);
    logApply(store, log, FAR_DIG, TABLE);
    const ids = log.ops.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(lastOpId(log)).toBe(advanced);
  });

  test("a second reconfigure is undoable back through the first", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    logApply(store, log, SHELL_DIG, TABLE);
    const afterCommit = snapshotAll(store);
    const opsAfterCommit = JSON.stringify(log.ops);

    reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 12 }) },
      TABLE,
    );
    const afterFirst = snapshotAll(store);
    reconfigureGenerator(
      store,
      log,
      e.entityId,
      { params: hallParams({ depth: 4 }) },
      TABLE,
    );

    undo(store, log);
    expect(snapshotAll(store)).toEqual(afterFirst);
    undo(store, log);
    expect(snapshotAll(store)).toEqual(afterCommit);
    expect(JSON.stringify(log.ops)).toBe(opsAfterCommit);
  });
});

describe("reconfigureGenerator — setup-loud guards", () => {
  type ThrowCase = {
    name: string;
    /** Corrupts/flags the committed record before the call under test. */
    arrange?: (log: OpLog, entityId: number) => void;
    /** `null` id = "use the committed entity"; a number overrides it. */
    entityId?: number;
    changes?: Parameters<typeof reconfigureGenerator>[3];
    message: RegExp;
  };

  const CASES: ThrowCase[] = [
    {
      name: "unknown entity id",
      entityId: 999,
      message: /^reconfigureGenerator: unknown entity 999$/,
    },
    {
      name: "frozen entity",
      arrange: (log, id) => {
        entityOpOf(log, id).entity.frozen = true;
      },
      message: /frozen/,
    },
    {
      name: "baked entity",
      arrange: (log, id) => {
        entityOpOf(log, id).entity.baked = true;
      },
      message: /baked/,
    },
    {
      name: "unknown generator id in the record",
      arrange: (log, id) => {
        entityOpOf(log, id).entity.generator = "no-such-generator";
      },
      message: /unknown field generator/,
    },
    {
      name: "span that does not sit where the record says",
      arrange: (log, id) => {
        entityOpOf(log, id).entity.opSpan = [900, 999];
      },
      message: /span/,
    },
    {
      // right LENGTH, wrong ids: the window holds real ops, just not this
      // entity's, so only the per-op id check can reject it
      name: "span whose ids do not match the ops in that window",
      arrange: (log, id) => {
        const record = entityOpOf(log, id).entity;
        record.opSpan = [record.opSpan[0] + 1, record.opSpan[1] + 1];
      },
      message: /span/,
    },
    {
      name: "params the generator rejects",
      changes: { params: { width: 999 } },
      message: /invalid at "width".*<=24/,
    },
    {
      name: "params that break a door walk lane",
      changes: { params: { depth: 4, pillars: "grid", pillarSpacing: 2 } },
      message: /walk lane|must be/,
    },
  ];

  for (const c of CASES) {
    test(`${c.name} throws with NOTHING mutated`, () => {
      const { store, log } = makeWorld();
      const e = commitHall(store, log);
      logApply(store, log, SHELL_DIG, TABLE);
      c.arrange?.(log, e.entityId);
      const beforeStore = snapshotAll(store);
      const beforeLog = snapshotLog(log);
      const changes =
        c.changes?.params === undefined
          ? (c.changes ?? {})
          : { ...c.changes, params: hallParams(c.changes.params) };

      expect(() =>
        reconfigureGenerator(
          store,
          log,
          c.entityId ?? e.entityId,
          changes,
          TABLE,
        ),
      ).toThrow(c.message);

      expect(snapshotAll(store)).toEqual(beforeStore);
      expect(snapshotLog(log)).toEqual(beforeLog);
    });
  }

  // The only corruption whose window has the right length AND the right ids:
  // the SECOND entity's span slid back by one so it starts on the FIRST
  // entity's op. Nothing but the "no entity op inside a span" rule rejects it,
  // and splicing it would delete a live entity.
  test("a span window that swallows another entity op is rejected", () => {
    const { store, log } = makeWorld();
    const first = commitHall(store, log);
    const second = commitHall(store, log, { depth: 4 }, [8, 0, 8]);
    const record = entityOpOf(log, second.entityId).entity;
    record.opSpan = [first.entityId, record.opSpan[1]];
    expect(record.opSpan[1] - record.opSpan[0] + 1).toBe(
      spanLengthOf(second) + 1,
    );
    const beforeLog = snapshotLog(log);

    expect(() =>
      reconfigureGenerator(store, log, second.entityId, {}, TABLE),
    ).toThrow(/span/);

    expect(snapshotLog(log)).toEqual(beforeLog);
  });

  // The return value is cloned BEFORE the splice, so a record carrying an
  // unknown non-cloneable field is a VALIDATION failure like every other case
  // above. Measured before that fix: the clone threw at `return` with the log
  // already rewritten — nextId 57 → 112, an undo entry pushed, redo cleared —
  // and the caller saw only the exception. Unknown fields are precisely the
  // ones whose cloneability the type system does not vouch for, and the spread
  // exists to carry them.
  test("a non-cloneable field on the RECORD throws with NOTHING mutated", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    const hooked = entityOpOf(log, e.entityId).entity as GeneratorEntity & {
      hook?: unknown;
    };
    hooked.hook = () => 1;
    const beforeStore = snapshotAll(store);
    const beforeLog = snapshotLog(log);

    expect(() =>
      reconfigureGenerator(store, log, e.entityId, { seed: 9 }, TABLE),
    ).toThrow(/cloned/);

    expect(snapshotAll(store)).toEqual(beforeStore);
    expect(snapshotLog(log)).toEqual(beforeLog);
  });

  // `evaluateSpan`'s per-op `assertOpValid` loop is the one clause of this
  // function's @throws contract that no case above reaches: every rejection they
  // pin fires in step 1 or inside `evaluateGenerator`, strictly ABOVE that loop,
  // so the clause had zero coverage while the docblock asserted it.
  //
  // Reaching it needs a span carrying a bad op, and none of the four registered
  // generators can produce one — hall and maze re-run `assertOpValid` with the
  // same table inside their own evaluate, the cave emits at most one op, and
  // scatter emits none. Since reconfigure re-resolves its def through the
  // registry (a synthetic def never gets there), the registered def's own
  // `evaluate` is swapped and restored under `finally` — the pattern
  // `generators.test.ts` already uses in "reconfigureGenerator enforces the fact
  // too", where the hall is made to lie about `emits`.
  test("an evaluated op that fails validation throws with NOTHING mutated", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    logApply(store, log, SHELL_DIG, TABLE);
    const beforeStore = snapshotAll(store);
    const beforeLog = snapshotLog(log);

    const kitFill: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: KIT_CLASS_ID,
      shape: { kind: "box", center: [1, 1, 1], halfExtents: [0.5, 0.5, 0.5] },
    };
    const real = HALL.evaluate;
    let caught: unknown;
    try {
      // op 1 valid, op 2 not — a single-pass reconfigure would have taken the
      // first before rejecting the second.
      HALL.evaluate = () => ({
        ops: [kitFill, { ...kitFill, material: 99 }],
        placements: [],
      });
      try {
        reconfigureGenerator(store, log, e.entityId, {}, TABLE);
      } catch (err) {
        caught = err;
      }
    } finally {
      HALL.evaluate = real;
    }
    expect(HALL.evaluate).toBe(real); // the lie really was reverted

    // Addressed by the DEF, not by a position in a span nobody wrote — the
    // `commitGenerator` form. What every committing path shares is the SHAPE
    // (locator, em dash, the predicate's message intact, the original on
    // `cause`); the DEF locator is shared with `commitGenerator` only, since
    // `logApplyGroup` names a list index for ops the CALLER handed over.
    if (!(caught instanceof Error))
      throw new Error(`expected an Error, got ${String(caught)}`);
    expect(caught.message).toMatch(
      /^reconfigureGenerator: generator "hall" — /,
    );
    expect(caught.message).toContain("unknown class");
    const cause = caught.cause;
    if (!(cause instanceof Error))
      throw new Error(`expected an Error cause, got ${String(cause)}`);
    expect(caught.message.endsWith(cause.message)).toBe(true);

    expect(snapshotAll(store)).toEqual(beforeStore);
    expect(snapshotLog(log)).toEqual(beforeLog);
    // Non-vacuity: the SAME call with the real evaluate back succeeds, so the
    // rejection came from the span and not from anything about this fixture.
    expect(() =>
      reconfigureGenerator(store, log, e.entityId, {}, TABLE),
    ).not.toThrow();
  });

  // The empty-evaluation leg is DEFENSIVE: every registered generator emits at
  // least its shell fill, so no params reach it — the same unreachable guard
  // commitGenerator carries. It is left untested rather than faked, and the
  // `evaluate` swap above would hold it the same way. Filed:
  // docs/backlog/engine-architecture/field-reconfigure-and-parse-edges.md
  // (§"`reconfigureGenerator`'s empty-evaluation leg")
});

describe("setGeneratorFrozen / bakeGeneratorEntity — the protection verbs", () => {
  test("freeze blocks reconfigure, unfreeze re-enables it, and each undoes cleanly", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);

    const frozen = setGeneratorFrozen(log, e.entityId, true);
    expect(frozen.frozen).toBe(true);
    expect(entityOpOf(log, e.entityId).entity.frozen).toBe(true);
    expect(() =>
      reconfigureGenerator(store, log, e.entityId, {}, TABLE),
    ).toThrow(/frozen/);

    // unfreeze DELETES the field — `frozen: false` is not a spelling of it
    const thawed = setGeneratorFrozen(log, e.entityId, false);
    expect("frozen" in thawed).toBe(false);
    expect("frozen" in entityOpOf(log, e.entityId).entity).toBe(false);
    expect(() =>
      reconfigureGenerator(store, log, e.entityId, { seed: 9 }, TABLE),
    ).not.toThrow();

    // …and ⌘Z back through each verb restores the record it swapped out
    undo(store, log); // the reconfigure
    undo(store, log); // the unfreeze
    expect(entityOpOf(log, e.entityId).entity.frozen).toBe(true);
    undo(store, log); // the freeze
    expect("frozen" in entityOpOf(log, e.entityId).entity).toBe(false);
    // …and redo walks the same two record swaps forward again
    redo(store, log, TABLE);
    expect(entityOpOf(log, e.entityId).entity.frozen).toBe(true);
    redo(store, log, TABLE);
    expect("frozen" in entityOpOf(log, e.entityId).entity).toBe(false);
  });

  test("bake severs the recipe; undo is the ONLY thing that puts it back", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);

    const baked = bakeGeneratorEntity(log, e.entityId);

    expect(baked.baked).toBe(true);
    // provenance is RETAINED for history — bake severs the recipe, not the record
    expect(baked.generator).toBe("hall");
    expect(baked.params).toEqual(e.params);
    expect(baked.seed).toBe(e.seed);
    expect(baked.region).toEqual(e.region);
    expect(baked.opSpan).toEqual(e.opSpan);
    expect(() =>
      reconfigureGenerator(store, log, e.entityId, {}, TABLE),
    ).toThrow(/baked/);
    // no VERB reverses it: neither protection verb will touch a baked entity
    expect(() => setGeneratorFrozen(log, e.entityId, false)).toThrow(/baked/);
    expect(() => bakeGeneratorEntity(log, e.entityId)).toThrow(/already baked/);

    // …but the undo ENTRY does, for exactly as long as it is on the stack
    undo(store, log);
    expect("baked" in entityOpOf(log, e.entityId).entity).toBe(false);
    expect(() =>
      reconfigureGenerator(store, log, e.entityId, { seed: 9 }, TABLE),
    ).not.toThrow();
  });

  test("bake CLEARS frozen — a severed entity is not also protected", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    setGeneratorFrozen(log, e.entityId, true);

    const baked = bakeGeneratorEntity(log, e.entityId);

    expect(baked.baked).toBe(true);
    expect("frozen" in baked).toBe(false);
    expect("frozen" in entityOpOf(log, e.entityId).entity).toBe(false);
    // …and undo restores the FROZEN record, not a bare one
    undo(store, log);
    expect(entityOpOf(log, e.entityId).entity.frozen).toBe(true);
  });

  test("neither verb touches a chunk — at negative chunk coordinates either", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log, {}, [-8, -4, -8]);
    expect([...store.chunks.keys()].every((k) => k.startsWith("-"))).toBe(true);
    const beforeStore = snapshotAll(store);

    setGeneratorFrozen(log, e.entityId, true);
    bakeGeneratorEntity(log, e.entityId);
    expect(snapshotAll(store)).toEqual(beforeStore);

    // an in-place record swap has NOTHING to remesh, in either direction
    expect(undo(store, log).size).toBe(0);
    expect(undo(store, log).size).toBe(0);
    expect(redo(store, log, TABLE).size).toBe(0);
    expect(redo(store, log, TABLE).size).toBe(0);
    expect(snapshotAll(store)).toEqual(beforeStore);
  });

  test("each verb pushes exactly ONE entity-update entry and clears redo", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    reconfigureGenerator(store, log, e.entityId, { seed: 9 }, TABLE);
    undo(store, log); // park a live redo entry
    const depth = log.undoStack.length;
    expect(log.redoStack.length).toBe(1);

    setGeneratorFrozen(log, e.entityId, true);
    expect(log.undoStack.length).toBe(depth + 1);
    expect(log.undoStack.at(-1)?.kind).toBe("entity-update");
    expect(log.redoStack.length).toBe(0);

    bakeGeneratorEntity(log, e.entityId);
    expect(log.undoStack.length).toBe(depth + 2);
    expect(log.undoStack.at(-1)?.kind).toBe("entity-update");
  });

  test("both verbs return a COPY, and carry fields they have no opinion about", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    (entityOpOf(log, e.entityId).entity as Labelled).label = "west wing";

    const frozen = setGeneratorFrozen(log, e.entityId, true) as Labelled;
    expect(frozen.label).toBe("west wing");
    frozen.seed = 999;
    frozen.params["depth"] = 999;
    expect(entityOpOf(log, e.entityId).entity.seed).toBe(e.seed);
    expect(entityOpOf(log, e.entityId).entity.params["depth"]).toBe(8);

    const baked = bakeGeneratorEntity(log, e.entityId) as Labelled;
    expect(baked.label).toBe("west wing");
    expect((entityOpOf(log, e.entityId).entity as Labelled).label).toBe(
      "west wing",
    );
  });

  // Why findEntityOp is split from verifySpanLayout: these verbs write the
  // RECORD and read no span, and being unable to protect — or retire — a
  // corrupt entity is the wrong failure mode. Bake matters most here: it is the
  // escape hatch that demotes an unreconfigurable entity to plain history.
  test("both verbs reach an entity whose SPAN layout is corrupt", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    entityOpOf(log, e.entityId).entity.opSpan = [900, 999];
    expect(() =>
      reconfigureGenerator(store, log, e.entityId, {}, TABLE),
    ).toThrow(/span/);

    expect(setGeneratorFrozen(log, e.entityId, true).frozen).toBe(true);
    setGeneratorFrozen(log, e.entityId, false);
    expect(bakeGeneratorEntity(log, e.entityId).baked).toBe(true);
  });
});

describe("setGeneratorFrozen / bakeGeneratorEntity — no-ops and setup-loud guards", () => {
  // A no-op that still burns an undo slot AND clears the redo stack is a bad
  // ⌘Z: the redo entry it destroys is unrecoverable, for a call that changed
  // nothing. `setGeneratorFrozen` is a SETTER — "after this call the entity is
  // frozen" — so a redundant call is a well-formed request already satisfied,
  // not bad input. (Contrast the empty patch, which is a malformed OP.)
  test("a redundant unfreeze changes nothing — and spares a live redo entry", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    reconfigureGenerator(store, log, e.entityId, { seed: 9 }, TABLE);
    undo(store, log);
    const before = snapshotLog(log);
    expect(before.redoDepth).toBe(1); // the entry a no-op entry would destroy

    const record = setGeneratorFrozen(log, e.entityId, false);

    expect("frozen" in record).toBe(false);
    expect(snapshotLog(log)).toEqual(before);
  });

  test("a redundant freeze changes nothing and still returns a COPY", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    setGeneratorFrozen(log, e.entityId, true);
    const before = snapshotLog(log);

    const record = setGeneratorFrozen(log, e.entityId, true);

    expect(record.frozen).toBe(true);
    expect(snapshotLog(log)).toEqual(before);
    record.seed = 999;
    expect(entityOpOf(log, e.entityId).entity.seed).toBe(e.seed);
  });

  type VerbCase = {
    name: string;
    /** Flags the committed record before the call under test. */
    arrange?: (log: OpLog, entityId: number) => void;
    call: (log: OpLog, entityId: number) => void;
    message: RegExp;
  };

  const CASES: VerbCase[] = [
    {
      // the throw names the PUBLIC verb, not the shared locator: these strings
      // reach an editor's error surface with no stack frame attached
      name: "freeze of an unknown entity",
      call: (log) => {
        setGeneratorFrozen(log, 42, true);
      },
      message: /^setGeneratorFrozen: unknown entity 42$/,
    },
    {
      name: "bake of an unknown entity",
      call: (log) => {
        bakeGeneratorEntity(log, 42);
      },
      message: /^bakeGeneratorEntity: unknown entity 42$/,
    },
    {
      name: "freeze of a baked entity",
      arrange: (log, id) => {
        bakeGeneratorEntity(log, id);
      },
      call: (log, id) => {
        setGeneratorFrozen(log, id, true);
      },
      message: /baked/,
    },
    {
      name: "unfreeze of a baked entity",
      arrange: (log, id) => {
        bakeGeneratorEntity(log, id);
      },
      call: (log, id) => {
        setGeneratorFrozen(log, id, false);
      },
      message: /baked/,
    },
    // Bake is the one IRREVERSIBLE verb, so it is NOT an idempotent setter: a
    // second bake would push an entry whose before === after, a ⌘Z that
    // visibly does nothing (the shape assertPatchValid rejects for the empty
    // patch), and would silence a UI that believes it just severed something.
    {
      name: "bake of an already-baked entity",
      arrange: (log, id) => {
        bakeGeneratorEntity(log, id);
      },
      call: (log, id) => {
        bakeGeneratorEntity(log, id);
      },
      message: /already baked/,
    },
  ];

  for (const c of CASES) {
    test(`${c.name} throws with NOTHING mutated`, () => {
      const { store, log } = makeWorld();
      const e = commitHall(store, log);
      c.arrange?.(log, e.entityId);
      const beforeStore = snapshotAll(store);
      const beforeLog = snapshotLog(log);

      expect(() => c.call(log, e.entityId)).toThrow(c.message);

      expect(snapshotAll(store)).toEqual(beforeStore);
      expect(snapshotLog(log)).toEqual(beforeLog);
    });
  }
});

// ─── contextFree:false re-cook + placement drift (scatter over a cave) ───
// Scatter is the first contextFree:false generator: it READS the carved field
// and emits placement records. Two reconfigure behaviours are unique to it —
// (1) when an UPSTREAM generator (the cave) is reconfigured, scatter's placement
// op replays as DATA (records unchanged) but its props DRIFT (the field beneath
// them moved); (2) when SCATTER itself is reconfigured, it re-cooks against the
// restored pre-span field, so its records follow the NEW cave.
describe("reconfigureGenerator — contextFree:false re-cook + placement drift", () => {
  const CAVE = generatorById("cave");
  const SCATTER = generatorById("scatter");
  const CAVE_REGION = {
    min: [0, 0, 0] as [number, number, number],
    max: [12, 8, 12] as [number, number, number],
  };
  const SCATTER_PARAMS = (): Record<string, unknown> => ({
    ...structuredClone(SCATTER.defaults),
    density: 0.8, // enough sites to reliably populate the cave floors
  });

  /** Commits a cave then a scatter reading it; returns their entities, the
   *  scatter placement op id, and its committed records. */
  const commitCaveThenScatter = (
    store: FieldStore,
    log: OpLog,
    caveSeed: number,
    scatterSeed: number,
  ) => {
    const cave = commitGenerator(store, log, CAVE, {
      params: structuredClone(CAVE.defaults),
      seed: caveSeed,
      region: CAVE_REGION,
      policy: "replace",
      table: TABLE,
    }).entity;
    const scatter = commitGenerator(store, log, SCATTER, {
      params: SCATTER_PARAMS(),
      seed: scatterSeed,
      region: CAVE_REGION,
      policy: "replace",
      table: TABLE,
    }).entity;
    const placement = log.ops.find((o) => o.kind === "placement");
    if (placement === undefined || placement.kind !== "placement")
      throw new Error("test: scatter committed no placement op");
    return {
      cave,
      scatter,
      placementId: placement.id,
      records: placement.records,
    };
  };

  const placementRecordsOf = (log: OpLog) => {
    const op = log.ops.find((o) => o.kind === "placement");
    if (op === undefined || op.kind !== "placement")
      throw new Error("test: no placement op in the log");
    return op.records;
  };

  test("reconfiguring the CAVE leaves scatter's records untouched but flags the props as drifted", () => {
    const { store, log } = makeWorld();
    const { cave, placementId, records } = commitCaveThenScatter(
      store,
      log,
      5,
      3,
    );
    expect(records.length).toBeGreaterThan(0);

    const r = reconfigureGenerator(
      store,
      log,
      cave.entityId,
      { seed: 9 },
      TABLE,
    );

    // the placement op REPLAYS AS DATA — the cave reconfigure does not re-cook
    // scatter, so its records are byte-identical
    expect(placementRecordsOf(log)).toEqual(records);
    // …but its props sit on field that MOVED, so the op is reported drifted
    // (the D-F3-4 props-drift contract), with chunk-quantized locations
    const finding = r.drift.find((d) => d.opId === placementId);
    expect(finding?.kind).toBe("drifted");
    expect(finding?.chunks.length ?? 0).toBeGreaterThan(0);
  });

  test("reconfiguring SCATTER re-cooks against the reconfigured cave (new surfaces)", () => {
    const { store, log } = makeWorld();
    const {
      cave,
      scatter,
      records: before,
    } = commitCaveThenScatter(store, log, 5, 3);
    // reconfigure the cave FIRST — the field scatter reads is now different
    reconfigureGenerator(store, log, cave.entityId, { seed: 9 }, TABLE);
    // …then re-cook scatter with NO changes: same params + seed, so any change
    // in the records can ONLY come from re-reading the new pre-span field.
    reconfigureGenerator(store, log, scatter.entityId, {}, TABLE);
    const after = placementRecordsOf(log);

    // the re-cook read the NEW cave: records changed even at the same seed…
    expect(after).not.toEqual(before);
    // …and they are EXACTLY what a fresh evaluate against the current (post-cave-
    // reconfigure) field produces — proof the scratch was the pre-span state,
    // which for a write-nothing scatter equals the live store here.
    const fresh = evaluateGenerator(
      SCATTER,
      { ...SCATTER_PARAMS(), density: 0.8 },
      3,
      CAVE_REGION,
      TABLE,
      "replace",
      { store },
    ).placements;
    expect(after).toEqual(fresh);
  });

  test("a re-roll (new seed) re-cooks against the current field and lands on real surfaces", () => {
    const { store, log } = makeWorld();
    const { scatter, records: before } = commitCaveThenScatter(
      store,
      log,
      5,
      3,
    );

    const r = reconfigureGenerator(
      store,
      log,
      scatter.entityId,
      { seed: 21 },
      TABLE,
    );
    const after = placementRecordsOf(log);
    expect(after).not.toEqual(before);
    expect(r.dirty.size).toBe(0); // scatter writes no field cells
    // Every re-rolled floor prop sits near a real rock→air crossing in the
    // CURRENT store (it projected onto the actual field, not stale data). The
    // recorded position is offset along the surface normal (props sit proud of
    // the surface), so on a sloped floor worldToVoxel(pos) can be one sample off
    // the column scatter read — scan a 3×3 column neighbourhood to absorb that.
    for (const rec of after) {
      const cx = worldToVoxel(rec.position[0], 0.25);
      const cz = worldToVoxel(rec.position[2], 0.25);
      let onSurface = false;
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (let y = -CHUNK_DIM; y < 3 * CHUNK_DIM; y++) {
            const d0 = getDensity(store, cx + dx, y, cz + dz);
            const d1 = getDensity(store, cx + dx, y + 1, cz + dz);
            // Zero-tolerant rising crossing, mirroring scatter's own scan (the
            // F3b gate fix): a boundary sample reading exactly 0 counts as the
            // rock side when rock lies directly beneath it.
            const rising =
              d0 <= 0 &&
              d1 > 0 &&
              (d0 < 0 || getDensity(store, cx + dx, y - 1, cz + dz) < 0);
            if (rising) {
              const cw = (y + d0 / (d0 - d1)) * 0.25;
              if (Math.abs(cw - rec.position[1]) <= 0.3) onSurface = true;
            }
          }
      expect(onSurface).toBe(true);
    }
  });

  // THE no-mutation-on-throw proof for the re-cook (the tranche's riskiest
  // point). The re-cook builds a SCRATCH pre-span restore (preStateImages, which
  // never touches the live store) before evaluate runs; a rejecting evaluate
  // must therefore leave the live store, log and stacks byte-identical.
  //
  // The DOWNSTREAM dig is what gives this teeth: it edits scatter's region AFTER
  // its span, so scatter's PRE-SPAN state (what the re-cook restores) now differs
  // from the live bytes. A live-mutating restore would rewind the dig before the
  // throw and leave the store visibly changed. SABOTAGE ANCHOR: route the re-cook
  // scratch through the live-mutating restorePreState instead of preStateImages
  // + a fresh scratch, and this goes red.
  test("a re-cook whose evaluate REJECTS leaves the live store byte-unchanged", () => {
    const { store, log } = makeWorld();
    const { scatter } = commitCaveThenScatter(store, log, 5, 3);
    // an edit INSIDE scatter's region (a solid corner the cave leaves rock),
    // committed AFTER its span — so the pre-span restore genuinely differs from
    // the live store, giving the sabotage teeth. Self-validated: the dig must
    // actually write, or the scenario proves nothing.
    expect(logApply(store, log, digSphere([1, 1, 1], 1.5), TABLE).size).toBe(8);
    const beforeStore = snapshotAll(store);
    const beforeLog = snapshotLog(log);

    expect(() =>
      reconfigureGenerator(
        store,
        log,
        scatter.entityId,
        { params: { ...SCATTER_PARAMS(), density: 999 } },
        TABLE,
      ),
    ).toThrow(/invalid at "density"/);

    expect(snapshotAll(store)).toEqual(beforeStore);
    expect(snapshotLog(log)).toEqual(beforeLog);
  });
});

// T2's two-altitude attribution across the reconfigure verbs. The
// `entity-update` pair is the reason the ENTRY carries a field of its own
// rather than the guard deriving one from the contained ops: a freeze/bake
// entry's `before`/`after` are the entity op, whose op-level origin names the
// entity's ORIGINAL author — while the entry belongs to whoever called the
// verb. Every fixture below makes those two values DIFFER, in both directions,
// so an implementation that derived one from the other cannot pass.
describe("origin stamping — the reconfigure verbs", () => {
  const AGENT = "agent:mcp";

  /** commitHall, but authored by `origin` — so the entity op in the log carries
   *  an op-level origin the later verbs must NOT overwrite. */
  const commitHallAs = (
    store: FieldStore,
    log: OpLog,
    origin?: string,
  ): GeneratorEntity =>
    commitGenerator(store, log, HALL, {
      params: hallParams(),
      seed: 7,
      region: regionAt([0, 0, 0]),
      policy: "replace",
      table: TABLE,
      ...(origin === undefined ? {} : { origin }),
    }).entity;

  test("reconfigureGenerator stamps the splice ENTRY and the ops it INSERTS", () => {
    const { store, log } = makeWorld();
    // Authored by the human, reconfigured by the agent: the inserted span is
    // the agent's work even though the entity is not.
    const e = commitHallAs(store, log);
    reconfigureGenerator(store, log, e.entityId, { seed: 9 }, TABLE, [], AGENT);

    const entry = log.undoStack.at(-1);
    expect(entry?.kind).toBe("splice");
    expect(entry?.origin).toBe(AGENT);
    if (entry?.kind !== "splice") return;
    // The re-cooked SPAN is the reconfiguring caller's work...
    const span = entry.inserted.filter((op) => op.kind !== "entity");
    expect(span.length).toBeGreaterThan(0);
    expect(span.every((op) => op.origin === AGENT)).toBe(true);
    // ...the entity RECORD is not: it keeps its original author's op-level
    // origin (absent here — the human committed it), the same rule the
    // entity-update pair below pins.
    const entityOp = entry.inserted.find((op) => op.kind === "entity");
    expect(Object.hasOwn(entityOp ?? {}, "origin")).toBe(false);
    // ...and the REMOVED span keeps whoever authored it (the human).
    expect(entry.removed.some((op) => Object.hasOwn(op, "origin"))).toBe(false);
  });

  test("reconfigureGenerator without origin stamps NOTHING, over an AGENT-authored entity", () => {
    const { store, log } = makeWorld();
    const e = commitHallAs(store, log, AGENT);
    reconfigureGenerator(store, log, e.entityId, { seed: 9 }, TABLE);

    const entry = log.undoStack.at(-1);
    expect(Object.hasOwn(entry ?? {}, "origin")).toBe(false);
    if (entry?.kind !== "splice") return;
    const span = entry.inserted.filter((op) => op.kind !== "entity");
    expect(span.length).toBeGreaterThan(0);
    expect(span.some((op) => Object.hasOwn(op, "origin"))).toBe(false);
    // The entity record still carries ITS author — the human reconfigure did
    // not launder the agent's authorship of the entity away.
    expect(entry.inserted.find((op) => op.kind === "entity")?.origin).toBe(
      AGENT,
    );
  });

  test("setGeneratorFrozen: the ENTRY is the caller's, the entity records keep their AUTHOR's origin", () => {
    const { store, log } = makeWorld();
    // Agent-authored entity, HUMAN freeze — the two values differ.
    const e = commitHallAs(store, log, AGENT);
    setGeneratorFrozen(log, e.entityId, true);

    const entry = log.undoStack.at(-1);
    expect(entry?.kind).toBe("entity-update");
    expect(Object.hasOwn(entry ?? {}, "origin")).toBe(false); // the human's
    if (entry?.kind !== "entity-update") return;
    expect(entry.before.origin).toBe(AGENT); // the entity's author
    expect(entry.after.origin).toBe(AGENT);
  });

  test("setGeneratorFrozen: the mirror — human entity, AGENT freeze", () => {
    const { store, log } = makeWorld();
    const e = commitHallAs(store, log);
    setGeneratorFrozen(log, e.entityId, true, AGENT);

    const entry = log.undoStack.at(-1);
    expect(entry?.kind).toBe("entity-update");
    expect(entry?.origin).toBe(AGENT); // the freezing caller's
    if (entry?.kind !== "entity-update") return;
    expect(Object.hasOwn(entry.before, "origin")).toBe(false); // the author's
    expect(Object.hasOwn(entry.after, "origin")).toBe(false);
  });

  test("bakeGeneratorEntity: same asymmetry, both directions", () => {
    const agentWorld = makeWorld();
    const agentEntity = commitHallAs(agentWorld.store, agentWorld.log, AGENT);
    bakeGeneratorEntity(agentWorld.log, agentEntity.entityId); // human bake
    const humanBake = agentWorld.log.undoStack.at(-1);
    expect(humanBake?.kind).toBe("entity-update");
    expect(Object.hasOwn(humanBake ?? {}, "origin")).toBe(false);
    if (humanBake?.kind !== "entity-update") return;
    expect(humanBake.before.origin).toBe(AGENT);
    expect(humanBake.after.origin).toBe(AGENT);

    const humanWorld = makeWorld();
    const humanEntity = commitHallAs(humanWorld.store, humanWorld.log);
    bakeGeneratorEntity(humanWorld.log, humanEntity.entityId, AGENT);
    const agentBake = humanWorld.log.undoStack.at(-1);
    expect(agentBake?.origin).toBe(AGENT);
    if (agentBake?.kind !== "entity-update") return;
    expect(Object.hasOwn(agentBake.before, "origin")).toBe(false);
    expect(Object.hasOwn(agentBake.after, "origin")).toBe(false);
  });

  test("a REDUNDANT setGeneratorFrozen pushes no entry, origin or not", () => {
    const { store, log } = makeWorld();
    const e = commitHallAs(store, log);
    const depth = log.undoStack.length;
    setGeneratorFrozen(log, e.entityId, false, AGENT); // already unfrozen
    expect(log.undoStack.length).toBe(depth);
  });
});
