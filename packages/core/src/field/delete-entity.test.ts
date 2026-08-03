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
  commitGenerator,
  createFieldStore,
  createOpLog,
  deleteGeneratorEntity,
  fieldOpChunks,
  generatorById,
  getDensity,
  logApply,
  redo,
  setGeneratorFrozen,
  undo,
} from "@furnace/core/field";
import { snapshotAll } from "../../tests/_helpers/field-store.ts";

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

const HALL = generatorById("hall");

// Geometry at cellSize 0.25 (sample = metres × 4), coarse CELL 0.5 m — the
// field-reconfigure.test.ts fixture, which the delete verb shares machinery
// with. Origin = snapDown(region.min); a depth-8 hall stamps from [0,0,0].
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
 *  chunks, so it is always absorbed into the affected set. */
const SHELL_DIG = digSphere([4, 2, 0.25], 1);
/** Sample coords of SHELL_DIG's centre (metres × 4) — reads as air wherever the
 *  dig actually landed. */
const SHELL_DIG_SAMPLE: [number, number, number] = [16, 8, 1];
/** 200 m away — chunks 49..50 on x and z, disjoint from every hall chunk. */
const FAR_DIG = digSphere([200, 2, 200], 1);
const FAR_CHUNK: ChunkKey = "49,0,49";

const entityOpOf = (log: OpLog, entityId: number): EntityOp => {
  const op = log.ops.find(
    (o): o is EntityOp => o.kind === "entity" && o.entity.entityId === entityId,
  );
  if (op === undefined) throw new Error(`test: no entity op ${entityId}`);
  return op;
};

/** The entity-record scan a consumer does today (there is no public reader —
 *  `docs/backlog/engine-architecture/field-entity-record-reader.md`). */
const findEntity = (
  log: OpLog,
  entityId: number,
): GeneratorEntity | undefined =>
  log.ops.find(
    (o): o is EntityOp => o.kind === "entity" && o.entity.entityId === entityId,
  )?.entity;

const snapshotLog = (
  log: OpLog,
): { ops: string; nextId: number; undoDepth: number; redoDepth: number } => ({
  ops: JSON.stringify(log.ops),
  nextId: log.nextId,
  undoDepth: log.undoStack.length,
  redoDepth: log.redoStack.length,
});

/** The layout every committed generator keeps and every splice verb must
 *  preserve: the span's ops sit IMMEDIATELY before the entity op, with
 *  sequential ids matching `opSpan`, and `entityId` is the entity op's own id. */
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

describe("deleteGeneratorEntity — removal + restore", () => {
  test("removes the span + entity op and restores the field to its pre-span state", () => {
    const { store, log } = makeWorld();
    // An UPSTREAM dig, so the pre-span state the delete rewinds to is not the
    // trivial empty store: a delete that rewound to "empty" would pass an
    // empty-store fixture and destroy this one.
    logApply(store, log, SHELL_DIG, TABLE);
    const beforeCommit = snapshotAll(store);
    const opsBeforeCommit = JSON.stringify(log.ops);
    const nextIdBeforeDelete = (): number => log.nextId;

    const e = commitHall(store, log);
    const [firstId, lastId] = e.opSpan;
    const spanChunks = new Set<ChunkKey>();
    for (const op of log.ops)
      if (op.id >= firstId && op.id <= lastId)
        for (const key of fieldOpChunks(op, store.cellSize))
          spanChunks.add(key);
    expect(spanChunks.size).toBeGreaterThan(0);
    expect(snapshotAll(store)).not.toEqual(beforeCommit);
    const nextIdAfterCommit = nextIdBeforeDelete();

    const r = deleteGeneratorEntity(store, log, e.entityId, TABLE);

    // no op of the span, and no entity op for it, survives
    expect(log.ops.some((op) => op.id >= firstId && op.id <= lastId)).toBe(
      false,
    );
    expect(findEntity(log, e.entityId)).toBeUndefined();
    expect(JSON.stringify(log.ops)).toBe(opsBeforeCommit);
    // the field is back to exactly what it was before the commit
    expect(snapshotAll(store)).toEqual(beforeCommit);
    // dirty covers every chunk the span wrote
    for (const key of spanChunks) expect(r.dirty.has(key)).toBe(true);
    // ids are handed out once: nextId is NOT rolled back
    expect(log.nextId).toBe(nextIdAfterCommit);
  });

  test("downstream ops replay over the deletion (the culled-replay contract)", () => {
    const deleted = makeWorld();
    const e = commitHall(deleted.store, deleted.log);
    logApply(deleted.store, deleted.log, SHELL_DIG, TABLE);
    logApply(deleted.store, deleted.log, FAR_DIG, TABLE);
    const farBefore = deleted.store.chunks.get(FAR_CHUNK);
    expect(farBefore).toBeDefined();

    const r = deleteGeneratorEntity(
      deleted.store,
      deleted.log,
      e.entityId,
      TABLE,
    );

    // the intersecting dig's effect SURVIVED — it was replayed onto the rewound
    // field, not reverted along with the span
    const [sx, sy, sz] = SHELL_DIG_SAMPLE;
    expect(getDensity(deleted.store, sx, sy, sz)).toBeGreaterThan(0);

    // …and the whole store is byte-identical to a log that never held the hall
    const never = makeWorld();
    logApply(never.store, never.log, SHELL_DIG, TABLE);
    logApply(never.store, never.log, FAR_DIG, TABLE);
    expect(snapshotAll(deleted.store)).toEqual(snapshotAll(never.store));

    // culling has teeth: the far dig's chunks never entered the affected set
    expect(r.dirty.has(FAR_CHUNK)).toBe(false);
  });

  test("a downstream generator entity keeps its own span layout across the deletion", () => {
    const { store, log } = makeWorld();
    const first = commitHall(store, log);
    const second = commitHall(store, log, { depth: 4 }, [8, 0, 8]);
    const secondSpan = structuredClone(second.opSpan);

    deleteGeneratorEntity(store, log, first.entityId, TABLE);

    expect(findEntity(log, first.entityId)).toBeUndefined();
    const survivor = findEntity(log, second.entityId);
    expect(survivor?.opSpan).toEqual(secondSpan);
    expectContiguousSpan(log, second.entityId);
  });
});

describe("deleteGeneratorEntity — undo / redo", () => {
  test("pushes ONE splice entry with inserted []; undo restores the entity + field; redo re-deletes", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    logApply(store, log, SHELL_DIG, TABLE);
    const afterCommit = snapshotAll(store);
    const afterCommitLog = snapshotLog(log);

    deleteGeneratorEntity(store, log, e.entityId, TABLE);
    const afterDelete = snapshotAll(store);
    const afterDeleteOps = JSON.stringify(log.ops);

    const entry = log.undoStack.at(-1);
    expect(entry?.kind).toBe("splice");
    if (entry?.kind !== "splice") throw new Error("test: expected a splice");
    expect(entry.inserted).toEqual([]);
    expect(entry.removed.at(-1)?.kind).toBe("entity");
    expect(entry.removed.length).toBe(e.opSpan[1] - e.opSpan[0] + 2);
    expect(log.undoStack.length).toBe(afterCommitLog.undoDepth + 1);
    expect(log.redoStack.length).toBe(0);

    undo(store, log);
    expect(findEntity(log, e.entityId)).toBeDefined();
    expect(JSON.stringify(log.ops)).toBe(afterCommitLog.ops);
    expect(snapshotAll(store)).toEqual(afterCommit);
    expectContiguousSpan(log, e.entityId);
    expect(log.redoStack.length).toBe(1);

    redo(store, log, TABLE);
    expect(findEntity(log, e.entityId)).toBeUndefined();
    expect(JSON.stringify(log.ops)).toBe(afterDeleteOps);
    expect(snapshotAll(store)).toEqual(afterDelete);
    expect(log.redoStack.length).toBe(0);
  });

  test("delete CLEARS the redo stack, and a later mutation clears the redo it leaves", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    logApply(store, log, SHELL_DIG, TABLE);
    undo(store, log); // park a live redo entry
    expect(log.redoStack.length).toBe(1);

    deleteGeneratorEntity(store, log, e.entityId, TABLE);
    expect(log.redoStack.length).toBe(0);

    undo(store, log);
    expect(log.redoStack.length).toBe(1);
    logApply(store, log, FAR_DIG, TABLE);
    expect(log.redoStack.length).toBe(0);
  });
});

describe("deleteGeneratorEntity — setup-loud guards", () => {
  test("refuses a FROZEN entity, naming the frozen state, with NOTHING mutated", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    setGeneratorFrozen(log, e.entityId, true);
    const beforeStore = snapshotAll(store);
    const beforeLog = snapshotLog(log);

    expect(() => deleteGeneratorEntity(store, log, e.entityId, TABLE)).toThrow(
      /deleteGeneratorEntity: entity \d+ is frozen/,
    );
    expect(snapshotAll(store)).toEqual(beforeStore);
    expect(snapshotLog(log)).toEqual(beforeLog);

    // unfreezing re-enables it — freeze is protection, not a dead end
    setGeneratorFrozen(log, e.entityId, false);
    expect(() =>
      deleteGeneratorEntity(store, log, e.entityId, TABLE),
    ).not.toThrow();
  });

  test("refuses a BAKED entity — compaction can fold a baked span, so delete-by-span is unsound", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    bakeGeneratorEntity(log, e.entityId);
    const beforeStore = snapshotAll(store);
    const beforeLog = snapshotLog(log);

    // The REASON is load-bearing, not decoration: a reader who only learns
    // "baked" will file it as a policy choice and try to work around it. The
    // message has to carry the structural fact — a compacted baked span makes
    // the recorded opSpan a lie — so the regex pins that clause too.
    expect(() => deleteGeneratorEntity(store, log, e.entityId, TABLE)).toThrow(
      /deleteGeneratorEntity: entity \d+ is baked — its span ops are compactable history, so its recorded opSpan is no longer a claim about the log/,
    );
    expect(snapshotAll(store)).toEqual(beforeStore);
    expect(snapshotLog(log)).toEqual(beforeLog);
  });

  test("an unknown entityId throws", () => {
    const { store, log } = makeWorld();
    commitHall(store, log);
    const beforeStore = snapshotAll(store);
    const beforeLog = snapshotLog(log);

    expect(() => deleteGeneratorEntity(store, log, 999, TABLE)).toThrow(
      /^deleteGeneratorEntity: unknown entity 999$/,
    );
    expect(snapshotAll(store)).toEqual(beforeStore);
    expect(snapshotLog(log)).toEqual(beforeLog);
  });

  test("a corrupt span layout is rejected BY NAME — never spliced blind", () => {
    const { store, log } = makeWorld();
    const e = commitHall(store, log);
    entityOpOf(log, e.entityId).entity.opSpan = [900, 999];
    const beforeStore = snapshotAll(store);
    const beforeLog = snapshotLog(log);

    expect(() => deleteGeneratorEntity(store, log, e.entityId, TABLE)).toThrow(
      /^deleteGeneratorEntity: .*span.*corrupt$/,
    );
    expect(snapshotAll(store)).toEqual(beforeStore);
    expect(snapshotLog(log)).toEqual(beforeLog);
  });
});

describe("deleteGeneratorEntity — a placement-only entity", () => {
  // Scatter's whole span is ONE placement op, which writes no field cells. So
  // deleting it must take the props away (the op is gone from the log) while
  // touching no chunk and reporting an EMPTY dirty set — there is nothing to
  // remesh. A verb that seeded `dirty` from anything but the span's writes, or
  // that skipped the splice when the affected set came back empty, fails here.
  test("takes its props away and reports an empty dirty set — no chunk moved", () => {
    const CAVE = generatorById("cave");
    const SCATTER = generatorById("scatter");
    const REGION = {
      min: [0, 0, 0] as [number, number, number],
      max: [12, 8, 12] as [number, number, number],
    };
    const { store, log } = makeWorld();
    commitGenerator(store, log, CAVE, {
      params: structuredClone(CAVE.defaults),
      seed: 5,
      region: REGION,
      policy: "replace",
      table: TABLE,
    });
    const fieldAfterCave = snapshotAll(store);
    const scatter = commitGenerator(store, log, SCATTER, {
      params: { ...structuredClone(SCATTER.defaults), density: 0.8 },
      seed: 3,
      region: REGION,
      policy: "replace",
      table: TABLE,
    }).entity;
    const placement = log.ops.find((o) => o.kind === "placement");
    expect(placement?.kind).toBe("placement");

    const r = deleteGeneratorEntity(store, log, scatter.entityId, TABLE);

    expect(log.ops.some((o) => o.kind === "placement")).toBe(false);
    expect(findEntity(log, scatter.entityId)).toBeUndefined();
    expect([...r.dirty]).toEqual([]);
    // the cave underneath is byte-untouched — scatter only ever READ it
    expect(snapshotAll(store)).toEqual(fieldAfterCave);

    // …and undo brings the props back
    undo(store, log);
    expect(log.ops.some((o) => o.kind === "placement")).toBe(true);
    expect(findEntity(log, scatter.entityId)).toBeDefined();
  });
});
