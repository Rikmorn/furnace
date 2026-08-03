import { describe, expect, test } from "bun:test";
import type {
  BrushOp,
  FieldStore,
  GeneratorEntity,
  MaterialTable,
  OpLog,
  SnapshotRecord,
} from "@furnace/core/field";
import {
  bakeGeneratorEntity,
  captureDueSnapshots,
  commitGenerator,
  compactRuns,
  createFieldStore,
  createOpLog,
  fieldOpChunks,
  generatorById,
  logApply,
  logStats,
  reconfigureGenerator,
  redo,
  restoreImages,
  setGeneratorFrozen,
  undo,
} from "@furnace/core/field";
import { snapshotAll } from "../../tests/_helpers/field-store.ts";
// In-core surfaces, deliberately NOT on the public index (the spliceOps
// precedent): `applyFieldOp` is what a from-scratch rebuild of a log looks like
// — the reference every compaction assertion below is measured against — and
// `restoreSeeds` is the restore fast path's own decision, tested directly
// because an equal-bytes assertion downstream of it passes whether or not the
// path was ever taken.
import { applyFieldOp } from "./ops.ts";
import { restoreSeeds } from "./snapshots.ts";

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
const DIRT_CLASS_ID = 1;
const KIT_CLASS_ID = 2;

/** The same catalog after class 2 was dropped — a project whose material table
 *  shrank between the session that wrote the ops and the one compacting them.
 *  `applyOp` never resolves `op.material` against the table (only masks do, and
 *  those fail CLOSED), so the ops still replay; it is the PATCH synthesized from
 *  them that carries an id nothing can resolve. */
const SHRUNK_TABLE: MaterialTable = { classes: TABLE.classes.slice(0, 2) };

const HALL = generatorById("hall");

const makeWorld = (): { store: FieldStore; log: OpLog } => ({
  store: createFieldStore(),
  log: createOpLog(),
});

const commitHall = (
  store: FieldStore,
  log: OpLog,
  min: [number, number, number] = [0, 0, 0],
): GeneratorEntity =>
  commitGenerator(store, log, HALL, {
    params: structuredClone(HALL.defaults),
    seed: 7,
    region: { min, max: [min[0] + 8, min[1] + 8, min[2] + 8] },
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

const fillSphere = (
  center: [number, number, number],
  radius: number,
  material: number,
): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "fill",
  material,
  shape: { kind: "sphere", center, radius },
});

const smoothSphere = (center: [number, number, number]): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "smooth",
  shape: { kind: "sphere", center, radius: 2 },
  smooth: { strength: 8, iterations: 1, mode: "both" },
});

/** A run of `count` digs marching along +x from `from`, half a metre apart. */
const digRun = (
  store: FieldStore,
  log: OpLog,
  from: [number, number, number],
  count: number,
): void => {
  for (let i = 0; i < count; i++)
    logApply(
      store,
      log,
      digSphere([from[0] + i * 0.5, from[1], from[2]], 0.6),
      TABLE,
    );
};

/** Drops the undo window the way an editor whose history has aged out does —
 *  the precondition {@link compactRuns} enforces. */
const dropHistory = (log: OpLog): void => {
  log.undoStack.length = 0;
  log.redoStack.length = 0;
};

/** A from-scratch rebuild of the whole log — the reference a compacted log must
 *  still reproduce byte-for-byte. */
const replayAll = (
  log: OpLog,
  table: MaterialTable,
  cellSize: number,
): FieldStore => {
  const store = createFieldStore(cellSize);
  for (const op of log.ops) applyFieldOp(store, op, table);
  return store;
};

const idsOf = (log: OpLog): number[] => log.ops.map((o) => o.id);

const snapshotLog = (log: OpLog): { ops: string; nextId: number } => ({
  ops: JSON.stringify(log.ops),
  nextId: log.nextId,
});

const NO_KEPT_IDS = (): { keepIds: Set<number> } => ({ keepIds: new Set() });

describe("logStats — the op-cost readout", () => {
  test("reports totals, live-span count and the compactable ceiling", () => {
    const { store, log } = makeWorld();
    commitHall(store, log);
    logApply(store, log, digSphere([4, 2, 4], 1), TABLE);

    const s = logStats(log);
    expect(s.totalOps).toBe(log.ops.length);
    expect(s.liveGenerators).toBe(1);
    expect(s.bakedGenerators).toBe(0);
    expect(s.frozenGenerators).toBe(0);
    expect(s.compactableOps).toBeGreaterThanOrEqual(0);
    expect(s.undoDepth).toBe(log.undoStack.length);
    expect(s.redoDepth).toBe(0);
  });

  test("an empty log reports zeros", () => {
    expect(logStats(createOpLog())).toEqual({
      totalOps: 0,
      liveGenerators: 0,
      bakedGenerators: 0,
      frozenGenerators: 0,
      compactableOps: 0,
      undoDepth: 0,
      redoDepth: 0,
    });
  });

  test("a frozen entity counts as live; a baked one does not", () => {
    const { store, log } = makeWorld();
    const frozen = commitHall(store, log);
    const baked = commitHall(store, log, [16, 0, 16]);
    setGeneratorFrozen(log, frozen.entityId, true);
    bakeGeneratorEntity(log, baked.entityId);

    const s = logStats(log);
    expect(s.liveGenerators).toBe(1);
    expect(s.frozenGenerators).toBe(1);
    expect(s.bakedGenerators).toBe(1);
  });

  test("compactableOps counts what compactRuns would fold under the SAME options", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [0, 1, 1], 20);
    dropHistory(log);
    const kept = { keepIds: new Set([log.ops[10]?.id ?? -1]) };

    const ceiling = logStats(log).compactableOps;
    const scoped = logStats(log, kept).compactableOps;
    expect(ceiling).toBe(20);
    expect(scoped).toBe(19);

    expect(compactRuns(store, log, TABLE, kept).folded).toBe(scoped);
  });
});

describe("compactRuns — semantic compaction", () => {
  test("folds an old dig run into one patch with byte-identical replay", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [0, 1, 1], 20);
    dropHistory(log);
    const bytes = snapshotAll(store);
    const opsBefore = log.ops.length;

    const r = compactRuns(store, log, TABLE, NO_KEPT_IDS());

    expect(r.folded).toBe(20);
    expect(log.ops.length).toBeLessThan(opsBefore);
    expect(log.ops).toHaveLength(1);
    expect(log.ops[0]?.kind).toBe("patch");
    // the LOG changed but the STORE did not — compaction is state-preserving
    expect(snapshotAll(store)).toEqual(bytes);
    // and a from-scratch replay of the compacted log reproduces the same bytes
    expect(snapshotAll(replayAll(log, TABLE, store.cellSize))).toEqual(bytes);
  });

  test("a run crossing a chunk boundary folds every chunk it wrote", () => {
    const { store, log } = makeWorld();
    // cellSize 0.25 → a chunk spans 4 m; this run straddles x = 4 m.
    digRun(store, log, [3, 1, 1], 6);
    dropHistory(log);
    const bytes = snapshotAll(store);
    expect(store.chunks.size).toBeGreaterThan(1);

    compactRuns(store, log, TABLE, NO_KEPT_IDS());

    const patch = log.ops[0];
    if (patch === undefined || patch.kind !== "patch")
      throw new Error("test: expected one patch op");
    expect(new Set(patch.chunks.map((c) => c.key))).toEqual(
      new Set(store.chunks.keys()),
    );
    expect(snapshotAll(replayAll(log, TABLE, store.cellSize))).toEqual(bytes);
  });

  test("a run at NEGATIVE chunk coordinates folds byte-exactly", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [-5, -2, -3], 8);
    dropHistory(log);
    const bytes = snapshotAll(store);
    expect([...store.chunks.keys()].every((k) => k.startsWith("-"))).toBe(true);

    expect(compactRuns(store, log, TABLE, NO_KEPT_IDS()).folded).toBe(8);

    expect(snapshotAll(store)).toEqual(bytes);
    expect(snapshotAll(replayAll(log, TABLE, store.cellSize))).toEqual(bytes);
  });

  test("a run that writes MATERIALS folds both channels", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [1, 1, 1], 3);
    for (let i = 0; i < 3; i++)
      logApply(store, log, fillSphere([1 + i * 0.5, 1, 1], 0.7, 1), TABLE);
    dropHistory(log);
    const bytes = snapshotAll(store);
    expect(store.materials.size).toBeGreaterThan(0);

    compactRuns(store, log, TABLE, NO_KEPT_IDS());

    const patch = log.ops[0];
    if (patch === undefined || patch.kind !== "patch")
      throw new Error("test: expected one patch op");
    expect(patch.chunks.some((c) => c.materialMask !== null)).toBe(true);
    expect(
      patch.chunks.some((c) => c.materials?.includes(DIRT_CLASS_ID) ?? false),
    ).toBe(true);
    expect(snapshotAll(replayAll(log, TABLE, store.cellSize))).toEqual(bytes);
  });

  test("refuses live generator spans, smooth ops and selection-masked ops", () => {
    const { store, log } = makeWorld();
    commitHall(store, log); // live span — must survive
    logApply(store, log, smoothSphere([4, 2, 4]), TABLE);
    logApply(
      store,
      log,
      {
        ...digSphere([4, 2, 4], 1),
        mask: {
          kind: "selection",
          selection: { kind: "flood-void", seed: [16, 8, 16], budget: 64 },
        },
      },
      TABLE,
    );
    const idsBefore = idsOf(log);
    dropHistory(log);

    expect(compactRuns(store, log, TABLE, NO_KEPT_IDS()).folded).toBe(0);

    for (const id of idsBefore)
      expect(log.ops.some((o) => o.id === id)).toBe(true);
  });

  test("keepIds protects one op and splits the run around it", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [0, 1, 1], 20);
    dropHistory(log);
    const bytes = snapshotAll(store);
    const keptId = log.ops[9]?.id ?? -1;

    const r = compactRuns(store, log, TABLE, { keepIds: new Set([keptId]) });

    expect(r.folded).toBe(19);
    expect(log.ops.some((o) => o.id === keptId)).toBe(true);
    expect(log.ops.map((o) => o.kind)).toEqual(["patch", "brush", "patch"]);
    expect(snapshotAll(replayAll(log, TABLE, store.cellSize))).toEqual(bytes);
  });

  test("leaves runs shorter than the fold threshold alone", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [0, 1, 1], 3);
    dropHistory(log);
    const before = snapshotLog(log);

    expect(compactRuns(store, log, TABLE, NO_KEPT_IDS()).folded).toBe(0);

    expect(snapshotLog(log)).toEqual(before);
  });

  test("REGION-masked ops fold — the mask reads position, not the field", () => {
    const { store, log } = makeWorld();
    // A region selection is materialized without touching the store
    // (selection.ts: the spec's bounds are copied), so it replays identically
    // from absolute cell values. A FLOOD in the same slot would not.
    for (let i = 0; i < 8; i++)
      logApply(
        store,
        log,
        {
          ...digSphere([i * 0.5, 1, 1], 0.6),
          mask: {
            kind: "selection",
            selection: { kind: "region", min: [0, 0, 0], max: [2, 4, 4] },
          },
        },
        TABLE,
      );
    dropHistory(log);
    const bytes = snapshotAll(store);
    expect(store.chunks.size).toBeGreaterThan(0);

    expect(compactRuns(store, log, TABLE, NO_KEPT_IDS()).folded).toBe(8);

    expect(log.ops.map((o) => o.kind)).toEqual(["patch"]);
    expect(snapshotAll(store)).toEqual(bytes);
    expect(snapshotAll(replayAll(log, TABLE, store.cellSize))).toEqual(bytes);
  });

  test("a run of FLOOD-masked ops is refused — length alone would not refuse it", () => {
    const { store, log } = makeWorld();
    logApply(store, log, digSphere([2, 1, 1], 2), TABLE); // give the flood a void
    // Four in a row: long enough to clear MIN_FOLD_RUN, so the refusal is
    // eligibility and not arithmetic. (The mixed-op case elsewhere has exactly
    // one flood op, where a length-1 run would be refused either way.)
    for (let i = 0; i < 4; i++)
      logApply(
        store,
        log,
        {
          ...digSphere([1 + i * 0.5, 1, 1], 0.6),
          mask: {
            kind: "selection",
            selection: { kind: "flood-void", seed: [8, 4, 4], budget: 512 },
          },
        },
        TABLE,
      );
    dropHistory(log);
    const idsBefore = idsOf(log);

    expect(compactRuns(store, log, TABLE, NO_KEPT_IDS()).folded).toBe(0);

    expect(idsOf(log)).toEqual(idsBefore);
    expect(logStats(log).compactableOps).toBe(0);
  });

  test("the discard guard REFUSES a fold whose class ids no longer resolve", () => {
    const { store, log } = makeWorld();
    // Fills of the kit class, lattice-aligned so assertOpValid accepts them.
    for (let i = 0; i < 5; i++)
      logApply(
        store,
        log,
        {
          id: 0,
          kind: "brush",
          effect: "fill",
          material: KIT_CLASS_ID,
          shape: {
            kind: "box",
            center: [1 + i * 0.5, 1, 1],
            halfExtents: [0.5, 0.5, 0.5],
          },
        },
        TABLE,
      );
    dropHistory(log);
    const beforeStore = snapshotAll(store);
    const beforeLog = snapshotLog(log);

    // The catalog has since dropped class 2: the diff would carry an id the
    // table cannot resolve, so the run must NOT be discarded.
    expect(() => compactRuns(store, log, SHRUNK_TABLE, NO_KEPT_IDS())).toThrow(
      /field compaction/,
    );
    expect(() => compactRuns(store, log, SHRUNK_TABLE, NO_KEPT_IDS())).toThrow(
      /unknown class id 2/,
    );

    expect(snapshotLog(log)).toEqual(beforeLog);
    expect(snapshotAll(store)).toEqual(beforeStore);
    // and the SAME log still folds under the table its ops were written with
    expect(compactRuns(store, log, TABLE, NO_KEPT_IDS()).folded).toBe(5);
  });

  test("a run whose net effect is NOTHING is removed outright", () => {
    const { store, log } = makeWorld();
    // Class-masked digs that match no cell: legal, eligible, and they write
    // nothing at all — the diff is empty, so there is no patch to keep.
    for (let i = 0; i < 5; i++)
      logApply(
        store,
        log,
        {
          ...digSphere([i * 0.5, 1, 1], 0.6),
          mask: { kind: "class", classId: DIRT_CLASS_ID },
        },
        TABLE,
      );
    dropHistory(log);
    expect(store.chunks.size).toBe(0);
    const nextIdBefore = log.nextId;

    expect(compactRuns(store, log, TABLE, NO_KEPT_IDS()).folded).toBe(5);

    expect(log.ops).toHaveLength(0);
    expect(log.nextId).toBe(nextIdBefore); // no patch op, so no id burned
  });

  test("compacting twice is a no-op the second time", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [0, 1, 1], 20);
    dropHistory(log);

    compactRuns(store, log, TABLE, NO_KEPT_IDS());
    const after = snapshotLog(log);

    expect(compactRuns(store, log, TABLE, NO_KEPT_IDS()).folded).toBe(0);
    expect(snapshotLog(log)).toEqual(after);
  });

  test("folds several runs in one pass, in log order", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [0, 1, 1], 5);
    logApply(store, log, smoothSphere([1, 1, 1]), TABLE);
    digRun(store, log, [10, 1, 1], 6);
    dropHistory(log);
    const bytes = snapshotAll(store);

    expect(compactRuns(store, log, TABLE, NO_KEPT_IDS()).folded).toBe(11);

    expect(log.ops.map((o) => o.kind)).toEqual(["patch", "brush", "patch"]);
    expect(idsOf(log)[0]).toBeLessThan(idsOf(log)[2] ?? 0);
    expect(snapshotAll(replayAll(log, TABLE, store.cellSize))).toEqual(bytes);
  });

  test("a BAKED entity's span folds, and every verb still refuses the entity safely", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    bakeGeneratorEntity(log, e.entityId);
    dropHistory(log);
    const bytes = snapshotAll(store);

    expect(
      compactRuns(store, log, TABLE, NO_KEPT_IDS()).folded,
    ).toBeGreaterThan(0);

    expect(snapshotAll(store)).toEqual(bytes);
    expect(snapshotAll(replayAll(log, TABLE, store.cellSize))).toEqual(bytes);
    // the entity op survives; its opSpan now names ids that no longer exist
    const entityOp = log.ops.find((o) => o.kind === "entity");
    expect(entityOp).toBeDefined();
    // and the verbs report the entity's STATE, not a corrupt-span accident
    expect(() =>
      reconfigureGenerator(store, log, e.entityId, {}, TABLE),
    ).toThrow(/baked/);
    expect(() => setGeneratorFrozen(log, e.entityId, true)).toThrow(/baked/);
    expect(() => bakeGeneratorEntity(log, e.entityId)).toThrow(/already baked/);
  });
});

describe("compactRuns — the quiescent-history precondition", () => {
  // Undo entries reference log.ops POSITIONALLY: an `ops` entry by tail length,
  // a `splice` entry by `at`, an `entity-update` entry by `opIndex`. Compaction
  // removes ops and shifts every index after the fold, so no id-based opt-out
  // can keep those references valid — the verb refuses instead.
  test("throws with NOTHING mutated when the undo stack is live", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [0, 1, 1], 20);
    const beforeLog = snapshotLog(log);
    const beforeStore = snapshotAll(store);

    expect(() => compactRuns(store, log, TABLE, NO_KEPT_IDS())).toThrow(
      /quiescent/,
    );

    expect(snapshotLog(log)).toEqual(beforeLog);
    expect(snapshotAll(store)).toEqual(beforeStore);
    expect(log.undoStack).toHaveLength(20);
  });

  test("throws when only the REDO stack is live", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [0, 1, 1], 20);
    undo(store, log);
    log.undoStack.length = 0;
    expect(log.redoStack).toHaveLength(1);

    expect(() => compactRuns(store, log, TABLE, NO_KEPT_IDS())).toThrow(
      /quiescent/,
    );
  });

  test("undo/redo still work exactly after a compaction that met the precondition", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [0, 1, 1], 20);
    dropHistory(log);
    compactRuns(store, log, TABLE, NO_KEPT_IDS());
    // the caller resumes editing: new history over the compacted log
    const compacted = snapshotAll(store);
    const compactedOps = snapshotLog(log).ops;
    logApply(store, log, digSphere([20, 1, 1], 1), TABLE);
    const edited = snapshotAll(store);

    undo(store, log);

    expect(snapshotAll(store)).toEqual(compacted);
    // ops come back exactly; nextId does not roll back (ids are handed out once)
    expect(snapshotLog(log).ops).toEqual(compactedOps);
    expect(redo(store, log, TABLE).size).toBeGreaterThan(0);
    expect(snapshotAll(store)).toEqual(edited);
  });
});

describe("snapshot records — the reconfigure restore fast path", () => {
  /** Index in `log.ops` where an entity's span begins — the position a
   *  reconfigure of it rewinds to, and therefore the only position at which a
   *  record can be usable. */
  const spanStartOf = (log: OpLog, entity: GeneratorEntity): number => {
    const entityIdx = log.ops.findIndex(
      (o) => o.kind === "entity" && o.entity.entityId === entity.entityId,
    );
    return entityIdx - (entity.opSpan[1] - entity.opSpan[0] + 1);
  };

  /** A world whose records PREDATE the stamp — records taken after it sit above
   *  the rewind position and can never be used. Both channels are exercised: the
   *  pre-record run digs and fills, the window run digs. */
  const buildWorld = (): {
    store: FieldStore;
    log: OpLog;
    entity: GeneratorEntity;
    records: SnapshotRecord[];
    spanStart: number;
  } => {
    const { store, log } = makeWorld();
    digRun(store, log, [16, 1, 16], 12);
    for (let i = 0; i < 4; i++)
      logApply(store, log, fillSphere([16 + i * 0.5, 1, 16], 0.7, 1), TABLE);
    const records = captureDueSnapshots(store, log, [], 2);
    digRun(store, log, [16, 1, 17], 6);
    const entity = commitHall(store, log, [16, 0, 16]);
    return { store, log, entity, records, spanStart: spanStartOf(log, entity) };
  };

  test("records a chunk whose replay tail exceeds the budget", () => {
    const { store, log } = buildWorld();

    const records = captureDueSnapshots(store, log, [], 4);

    expect(records.length).toBeGreaterThan(0);
    for (const r of records) expect(r.position).toBe(log.ops.length);
    // a second sweep against those records finds nothing new — the tail reset
    expect(captureDueSnapshots(store, log, records, 4)).toHaveLength(0);
  });

  test("rejects a non-positive or non-integer budget", () => {
    const { store, log } = buildWorld();
    expect(() => captureDueSnapshots(store, log, [], 0)).toThrow(/budget/);
    expect(() => captureDueSnapshots(store, log, [], 1.5)).toThrow(/budget/);
  });

  test("a seeded per-chunk rebuild equals the full-prefix replay, culled", () => {
    const { store, log, records, spanStart } = buildWorld();
    const affected = new Set(store.chunks.keys());

    const seeds = restoreSeeds(
      log,
      spanStart,
      affected,
      records,
      store.cellSize,
    );

    expect(seeds.size).toBeGreaterThan(0);
    const reference = createFieldStore(store.cellSize);
    for (const op of log.ops.slice(0, spanStart))
      applyFieldOp(reference, op, TABLE);
    for (const [key, seed] of seeds) {
      // the point of a record: fewer ops than the prefix it stands in for
      expect(seed.ops.length).toBeLessThan(spanStart);
      const scratch = createFieldStore(store.cellSize);
      restoreImages(scratch, new Map([[key, seed.image]]));
      for (const op of seed.ops) applyFieldOp(scratch, op, TABLE);
      expect(scratch.chunks.get(key) ?? null).toEqual(
        reference.chunks.get(key) ?? null,
      );
      expect(scratch.materials.get(key) ?? null).toEqual(
        reference.materials.get(key) ?? null,
      );
    }
  });

  test("a smooth op over a chunk disqualifies that chunk's record", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [16, 1, 16], 12);
    const records = captureDueSnapshots(store, log, [], 2);
    const smooth = smoothSphere([16, 1, 16]);
    logApply(store, log, smooth, TABLE);
    const entity = commitHall(store, log, [16, 0, 16]);
    const spanStart = spanStartOf(log, entity);
    const recorded = new Set(records.map((r) => r.key));

    const seeds = restoreSeeds(
      log,
      spanStart,
      recorded,
      records,
      store.cellSize,
    );

    const smoothed = fieldOpChunks(smooth, store.cellSize);
    expect([...recorded].some((key) => smoothed.has(key))).toBe(true);
    for (const key of smoothed) expect(seeds.has(key)).toBe(false);
    // and the chunks the smooth never reached keep theirs
    expect([...recorded].filter((key) => !smoothed.has(key)).length).toBe(
      seeds.size,
    );
  });

  test("a FLOOD-masked op over a chunk disqualifies it — the read set is unbounded", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [16, 1, 16], 12);
    const records = captureDueSnapshots(store, log, [], 2);
    // A flood re-materializes against replayed state and walks wherever the
    // void goes — across chunks a per-chunk rebuild does not have. Forcing it
    // through the culled route is a wrong-BYTES defect, not a slow one.
    const flood: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "paint",
      material: DIRT_CLASS_ID,
      shape: { kind: "box", center: [18, 1, 16], halfExtents: [4, 2, 4] },
      mask: {
        kind: "selection",
        selection: { kind: "flood-void", seed: [64, 4, 64], budget: 4096 },
      },
    };
    logApply(store, log, flood, TABLE);
    const entity = commitHall(store, log, [16, 0, 16]);
    const spanStart = spanStartOf(log, entity);
    const recorded = new Set(records.map((r) => r.key));

    const seeds = restoreSeeds(
      log,
      spanStart,
      recorded,
      records,
      store.cellSize,
    );

    const touched = fieldOpChunks(flood, store.cellSize);
    expect([...recorded].some((key) => touched.has(key))).toBe(true);
    for (const key of touched) expect(seeds.has(key)).toBe(false);
  });

  test("a REGION-masked op in the window keeps its chunk on the fast path", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [16, 1, 16], 12);
    const records = captureDueSnapshots(store, log, [], 2);
    // The other side of the same rule: a region mask is a position predicate,
    // so the chunk stays rebuildable alone — and the rebuild must MATCH.
    const regional: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "paint",
      material: DIRT_CLASS_ID,
      shape: { kind: "box", center: [18, 1, 16], halfExtents: [4, 2, 4] },
      mask: {
        kind: "selection",
        selection: { kind: "region", min: [16, 0, 15], max: [20, 3, 18] },
      },
    };
    const regionalId = log.nextId; // logApply stamps a COPY — match by id
    logApply(store, log, regional, TABLE);
    const entity = commitHall(store, log, [16, 0, 16]);
    const spanStart = spanStartOf(log, entity);
    const recorded = new Set(records.map((r) => r.key));

    const seeds = restoreSeeds(
      log,
      spanStart,
      recorded,
      records,
      store.cellSize,
    );

    const touched = fieldOpChunks(regional, store.cellSize);
    const shared = [...recorded].filter((key) => touched.has(key));
    expect(shared.length).toBeGreaterThan(0);
    const reference = createFieldStore(store.cellSize);
    for (const op of log.ops.slice(0, spanStart))
      applyFieldOp(reference, op, TABLE);
    for (const key of shared) {
      const seed = seeds.get(key);
      if (seed === undefined) throw new Error(`test: no seed for ${key}`);
      expect(seed.ops.some((op) => op.id === regionalId)).toBe(true);
      const scratch = createFieldStore(store.cellSize);
      restoreImages(scratch, new Map([[key, seed.image]]));
      for (const op of seed.ops) applyFieldOp(scratch, op, TABLE);
      expect(scratch.chunks.get(key) ?? null).toEqual(
        reference.chunks.get(key) ?? null,
      );
      expect(scratch.materials.get(key) ?? null).toEqual(
        reference.materials.get(key) ?? null,
      );
    }
  });

  test("a record ahead of the restore position is ignored", () => {
    const { store, log, records, spanStart } = buildWorld();
    const ahead = records.map((r) => ({ ...r, position: spanStart + 1 }));
    const keys = new Set(store.chunks.keys());

    const withAhead = restoreSeeds(log, spanStart, keys, ahead, store.cellSize);
    const withNone = restoreSeeds(log, spanStart, keys, [], store.cellSize);

    // falls all the way back to pristine — the record is not merely re-dated
    expect(withAhead.size).toBe(withNone.size);
    for (const [key, seed] of withAhead) {
      expect(seed.image).toEqual({ density: null, materials: null });
      expect(seed.ops).toEqual(withNone.get(key)?.ops ?? []);
    }
  });

  test("a usable record SHORTENS the window a pristine seed would replay", () => {
    const { store, log, records, spanStart } = buildWorld();
    const keys = new Set(store.chunks.keys());

    const seeded = restoreSeeds(log, spanStart, keys, records, store.cellSize);
    const pristine = restoreSeeds(log, spanStart, keys, [], store.cellSize);

    const opsIn = (m: Map<string, { ops: readonly unknown[] }>): number =>
      [...m.values()].reduce((n, seed) => n + seed.ops.length, 0);
    expect(opsIn(seeded)).toBeLessThan(opsIn(pristine));
    for (const [key, seed] of seeded)
      expect(seed.ops.length).toBeLessThanOrEqual(
        pristine.get(key)?.ops.length ?? 0,
      );
  });

  test("a reconfigure seeded from records produces byte-identical output", () => {
    const plain = buildWorld();
    const seeded = buildWorld();
    // the seeded run really takes the fast path — otherwise this proves nothing
    expect(
      restoreSeeds(
        seeded.log,
        seeded.spanStart,
        new Set(seeded.store.chunks.keys()),
        seeded.records,
        seeded.store.cellSize,
      ).size,
    ).toBeGreaterThan(0);
    const changes = {
      params: { ...structuredClone(HALL.defaults), depth: 12 },
    };

    const a = reconfigureGenerator(
      plain.store,
      plain.log,
      plain.entity.entityId,
      changes,
      TABLE,
    );
    const b = reconfigureGenerator(
      seeded.store,
      seeded.log,
      seeded.entity.entityId,
      changes,
      TABLE,
      seeded.records,
    );

    expect(snapshotAll(seeded.store)).toEqual(snapshotAll(plain.store));
    expect(b.dirty).toEqual(a.dirty);
    expect(b.drift).toEqual(a.drift);
    expect(JSON.stringify(seeded.log.ops)).toBe(JSON.stringify(plain.log.ops));
    // and both agree with a from-scratch rebuild of the reconfigured log
    const rebuilt = replayAll(seeded.log, TABLE, seeded.store.cellSize);
    for (const key of b.dirty)
      expect(seeded.store.chunks.get(key) ?? null).toEqual(
        rebuilt.chunks.get(key) ?? null,
      );
  });

  test("a DISQUALIFIED chunk is still rewound — the routes are all-or-nothing", () => {
    // The sharp case: a chunk the OLD span owned and the NEW one does not, so
    // its pre-span bytes have to come back rather than being overwritten. A
    // smooth op disqualifies it from the culled route, and skipping it there
    // instead of falling back would leave the old stamp behind, visibly.
    const { store, log } = makeWorld();
    digRun(store, log, [16, 1, 16], 8);
    const records = captureDueSnapshots(store, log, [], 2);
    logApply(store, log, smoothSphere([16, 1, 16]), TABLE);
    const entity = commitHall(store, log, [16, 0, 16]);

    const r = reconfigureGenerator(
      store,
      log,
      entity.entityId,
      { region: { min: [40, 0, 40], max: [48, 8, 48] } },
      TABLE,
      records,
    );

    const rebuilt = replayAll(log, TABLE, store.cellSize);
    expect(r.dirty.size).toBeGreaterThan(0);
    // the vacated footprint is among the dirtied chunks, and reads pre-span
    expect([...r.dirty].some((key) => key.startsWith("4,"))).toBe(true);
    for (const key of r.dirty) {
      expect(store.chunks.get(key) ?? null).toEqual(
        rebuilt.chunks.get(key) ?? null,
      );
      expect(store.materials.get(key) ?? null).toEqual(
        rebuilt.materials.get(key) ?? null,
      );
    }
  });

  test("a stale record whose window hides a smooth op still restores exactly", () => {
    const { store, log } = makeWorld();
    digRun(store, log, [16, 1, 16], 8);
    const records = captureDueSnapshots(store, log, [], 2);
    logApply(store, log, smoothSphere([16, 1, 16]), TABLE);
    const entity = commitHall(store, log, [16, 0, 16]);

    const r = reconfigureGenerator(
      store,
      log,
      entity.entityId,
      { params: { ...structuredClone(HALL.defaults), depth: 12 } },
      TABLE,
      records,
    );

    const rebuilt = replayAll(log, TABLE, store.cellSize);
    expect(r.dirty.size).toBeGreaterThan(0);
    for (const key of r.dirty)
      expect(store.chunks.get(key) ?? null).toEqual(
        rebuilt.chunks.get(key) ?? null,
      );
  });
});
