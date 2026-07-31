// The history LABELS (F4.5b Task 12), with no host and no GPU — which is why the
// derivation is its own module. `LogEntry` carries no label field, so every string the
// Undo menu item, the Redo item and the History palette show is DERIVED from the entry,
// and this file is where that derivation is pinned.
//
// The entries are built by CORE's own verbs wherever core can reach them — `logApply`,
// `commitGenerator`, `reconfigureGenerator`, `deleteGeneratorEntity`,
// `setGeneratorFrozen`, `bakeGeneratorEntity` — rather than hand-written literals. A
// hand-written entry pins this module against my reading of core's shape; a real one
// pins it against core, and goes red the day core changes what it pushes. The two cases
// core cannot reach from a public verb (a patch-only entry, an entity op naming a
// generator that has been retired from the registry) are hand-built, and are labelled as
// such.
import { expect, test } from "bun:test";
import type {
  BrushOp,
  EntityOp,
  FieldStore,
  GeneratorEntity,
  LogEntry,
  MaterialTable,
  OpLog,
} from "@furnace/core/field";
import {
  bakeGeneratorEntity,
  commitGenerator,
  createFieldStore,
  createOpLog,
  deleteGeneratorEntity,
  generatorById,
  logApply,
  reconfigureGenerator,
  setGeneratorFrozen,
} from "@furnace/core/field";
import {
  entryLabel,
  fieldHistory,
  HISTORY_TAIL,
} from "../../src/viewport-host/field-history.ts";

/** The 3-class table every headless field suite in this package uses (one kit class,
 *  which every stamp requires), trimmed to what a hall reads. */
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

type V3 = [number, number, number];

const HALL_REGION = { min: [0, 0, 0] as V3, max: [5, 4, 5] as V3 };

const world = (): { store: FieldStore; log: OpLog } => ({
  store: createFieldStore(),
  log: createOpLog(),
});

/** The entry the last mutation pushed — every verb below pushes exactly one. */
const top = (log: OpLog): LogEntry => {
  const entry = log.undoStack.at(-1);
  if (entry === undefined) throw new Error("test: nothing on the undo stack");
  return entry;
};

/** A sphere brush op at the origin. `id` is overwritten by `logApply`. */
const sphere = (effect: BrushOp["effect"], extra: Partial<BrushOp> = {}) =>
  ({
    id: 0,
    kind: "brush",
    effect,
    shape: { kind: "sphere", center: [1, 1, 1], radius: 1 },
    ...extra,
  }) as BrushOp;

/** Commits a hall and returns its entity id. */
function commitHall(store: FieldStore, log: OpLog): number {
  return commitGenerator(store, log, generatorById("hall"), {
    params: structuredClone(generatorById("hall").defaults),
    seed: 7,
    region: HALL_REGION,
    policy: "replace",
    table: TABLE,
  }).entity.entityId;
}

// --- ops entries: the brush -------------------------------------------------

test("a brush op labels with its EFFECT", () => {
  for (const effect of ["dig", "fill", "paint", "smooth"] as const) {
    const { store, log } = world();
    // Smooth needs its params; the others ignore them.
    logApply(
      store,
      log,
      sphere(
        effect,
        effect === "smooth"
          ? { smooth: { strength: 16, iterations: 1, mode: "both" } }
          : {},
      ),
      TABLE,
    );
    expect(entryLabel(top(log))).toBe(effect);
  }
});

test("a HOLLOW fill still labels 'fill' — the shell is a fill, not a third verb", () => {
  const { store, log } = world();
  logApply(store, log, sphere("fill", { hollow: 0.5, material: 0 }), TABLE);
  expect(entryLabel(top(log))).toBe("fill");
});

test("a CAPSULE brush op labels 'segment <effect>' — the two-click sweep", () => {
  const { store, log } = world();
  logApply(
    store,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "capsule", a: [0, 1, 0], b: [3, 1, 0], radius: 1 },
    },
    TABLE,
  );
  expect(entryLabel(top(log))).toBe("segment dig");
  // …and the sphere case above is what proves the prefix is the SHAPE talking and
  // not a constant: same effect, different shape, different label.
});

// --- ops entries: a generator commit ----------------------------------------

test("a commit labels 'stamp <Name>' — the registry's display name, not the id", () => {
  const { store, log } = world();
  commitHall(store, log);
  // "Hall", not "hall": the id is lower-case and the name is what every other
  // surface (the rail, the session strip) shows.
  expect(generatorById("hall").name).not.toBe("hall");
  expect(entryLabel(top(log))).toBe(`stamp ${generatorById("hall").name}`);
});

test("an entity op naming a RETIRED generator falls back to the id, never throws", () => {
  // HAND-BUILT, and it has to be: `generatorById` is setup-loud on an unknown id, so
  // core has no verb that produces this. It is reachable from a LOADED world — the
  // host's own comments call it "setup-loud on a retired id" at three call sites — and
  // a throwing label would take down every surface that renders history, from a world
  // file alone.
  const entity = {
    entityId: 3,
    type: "generator",
    generator: "no-such-generator",
    params: {},
    seed: 1,
    region: HALL_REGION,
    opSpan: [1, 1],
  } as GeneratorEntity;
  const op: EntityOp = { id: 1, kind: "entity", action: "place", entity };
  const entry: LogEntry = { kind: "ops", ops: [op], inverse: new Map() };
  expect(entryLabel(entry)).toBe("stamp no-such-generator");
});

test("a PATCH-only entry labels 'compact'", () => {
  // Hand-built: compaction runs at LOAD time (the host calls `compactRuns` inside
  // `loadWorld`, before any subscriber exists), so no mid-session verb pushes one.
  // Labelled anyway rather than left to a fallback — an unlabelled row is worse than
  // an unreachable one.
  const entry: LogEntry = {
    kind: "ops",
    ops: [{ id: 1, kind: "patch", chunks: [] }],
    inverse: new Map(),
  };
  expect(entryLabel(entry)).toBe("compact");
});

// --- splice entries ---------------------------------------------------------

test("a delete labels 'delete <Name>' — read off the REMOVED span", () => {
  const { store, log } = world();
  const id = commitHall(store, log);
  deleteGeneratorEntity(store, log, id, TABLE);
  const entry = top(log);
  expect(entry.kind).toBe("splice");
  // The discriminating fact: `inserted` is empty, which is the only thing that tells
  // a delete from a reconfigure at this level.
  if (entry.kind === "splice") expect(entry.inserted).toEqual([]);
  expect(entryLabel(entry)).toBe(`delete ${generatorById("hall").name}`);
});

test("a region-only reconfigure labels 'move <Name>'", () => {
  const { store, log } = world();
  const id = commitHall(store, log);
  reconfigureGenerator(
    store,
    log,
    id,
    { region: { min: [2, 0, 0], max: [7, 4, 5] } },
    TABLE,
  );
  expect(entryLabel(top(log))).toBe(`move ${generatorById("hall").name}`);
});

test("a params reconfigure labels 'reconfigure <Name>', region unmoved", () => {
  const { store, log } = world();
  const id = commitHall(store, log);
  const params = structuredClone(generatorById("hall").defaults);
  reconfigureGenerator(
    store,
    log,
    id,
    { params: { ...params, width: 10 } },
    TABLE,
  );
  expect(params["width"]).not.toBe(10); // the change was real
  expect(entryLabel(top(log))).toBe(
    `reconfigure ${generatorById("hall").name}`,
  );
});

test("a reconfigure that moves the region AND changes params is NOT a move", () => {
  // The pair that makes "move" mean something: it is not "the region moved", it is
  // "ONLY the region moved". Without this the label would call a re-shape a move and
  // the History palette would say the user did something they did not do.
  const { store, log } = world();
  const id = commitHall(store, log);
  const params = structuredClone(generatorById("hall").defaults);
  reconfigureGenerator(
    store,
    log,
    id,
    {
      region: { min: [2, 0, 0], max: [7, 4, 5] },
      params: { ...params, width: 10 },
    },
    TABLE,
  );
  expect(entryLabel(top(log))).toBe(
    `reconfigure ${generatorById("hall").name}`,
  );
});

test("a re-roll at the same region is a reconfigure, not a move", () => {
  const { store, log } = world();
  const id = commitHall(store, log);
  reconfigureGenerator(store, log, id, { seed: 99 }, TABLE);
  expect(entryLabel(top(log))).toBe(
    `reconfigure ${generatorById("hall").name}`,
  );
});

test("a reconfigure that moves the region AND re-rolls is NOT a move", () => {
  // The SEED leg of the same pair, and it needs its own case: the re-roll test above
  // cannot see it, because with the region unmoved the label is "reconfigure" whether
  // or not the seed is compared at all. Only a case that moves the region can tell a
  // three-way "nothing else changed" test from a two-way one.
  const { store, log } = world();
  const id = commitHall(store, log);
  reconfigureGenerator(
    store,
    log,
    id,
    { region: { min: [2, 0, 0], max: [7, 4, 5] }, seed: 99 },
    TABLE,
  );
  expect(entryLabel(top(log))).toBe(
    `reconfigure ${generatorById("hall").name}`,
  );
});

// --- entity-update entries --------------------------------------------------

test("freeze and unfreeze label themselves", () => {
  const { store, log } = world();
  const id = commitHall(store, log);
  setGeneratorFrozen(log, id, true);
  expect(entryLabel(top(log))).toBe(`freeze ${generatorById("hall").name}`);
  setGeneratorFrozen(log, id, false);
  expect(entryLabel(top(log))).toBe(`unfreeze ${generatorById("hall").name}`);
});

test("a bake labels 'bake <Name>'", () => {
  const { store, log } = world();
  const id = commitHall(store, log);
  bakeGeneratorEntity(log, id);
  expect(entryLabel(top(log))).toBe(`bake ${generatorById("hall").name}`);
});

test("baking a FROZEN entity labels 'bake', not 'unfreeze'", () => {
  // The ordering trap, and it is core's contract rather than an invented case:
  // `bakeGeneratorEntity` CLEARS `frozen` (its TSDoc: "a severed recipe has nothing
  // left to protect"), so this one entry moves BOTH flags. A derivation that asks
  // about `frozen` first reads true→absent and calls the irreversible verb an
  // unfreeze — on the one row a user would most want named correctly.
  const { store, log } = world();
  const id = commitHall(store, log);
  setGeneratorFrozen(log, id, true);
  bakeGeneratorEntity(log, id);
  const entry = top(log);
  // Both halves of the trap are really present in this entry.
  if (entry.kind === "entity-update") {
    expect(entry.before.entity.frozen).toBe(true);
    expect(entry.after.entity.frozen).toBeUndefined();
    expect(entry.after.entity.baked).toBe(true);
  }
  expect(entryLabel(entry)).toBe(`bake ${generatorById("hall").name}`);
});

// --- the payload ------------------------------------------------------------

test("fieldHistory orders newest LAST on both sides", () => {
  const { store, log } = world();
  logApply(store, log, sphere("dig"), TABLE);
  logApply(store, log, sphere("paint", { material: 1 }), TABLE);
  const h = fieldHistory(log.undoStack, log.redoStack);
  // The ordering contract the ActionCtx reads with `.at(-1)`: the top of the stack —
  // what ⌘Z would step — is the LAST element.
  expect(h.undo).toEqual(["dig", "paint"]);
  expect(h.undo.at(-1)).toBe("paint");
  expect(h.redo).toEqual([]);
  expect(h.undoDepth).toBe(2);
  expect(h.redoDepth).toBe(0);
});

test("the tail is bounded per side, and the DEPTHS still tell the whole truth", () => {
  const { store, log } = world();
  const total = HISTORY_TAIL + 10;
  // A FOUR-effect cycle against a 50-long window, and the length of the cycle is the
  // whole point. The first shape of this fixture alternated dig/fill, which made the
  // oldest 50 and the newest 50 read IDENTICALLY (both windows end on an odd index) —
  // so `slice(0, 50)` in place of `slice(-50)` passed, and the direction of the bound
  // was pinned by nothing. 50 is not a multiple of 4, so the two windows now differ.
  const EFFECTS = ["dig", "fill", "paint", "smooth"] as const;
  const effectAt = (i: number) =>
    EFFECTS[i % EFFECTS.length] as BrushOp["effect"];
  for (let i = 0; i < total; i++)
    logApply(
      store,
      log,
      sphere(effectAt(i), {
        smooth: { strength: 16, iterations: 1, mode: "both" },
        material: 0,
      }),
      TABLE,
    );
  const h = fieldHistory(log.undoStack, log.redoStack);
  expect(log.undoStack.length).toBe(total);
  expect(h.undo.length).toBe(HISTORY_TAIL);
  // The bound drops the OLDEST end. Asserted as the WHOLE window rather than as its
  // last element, so no coincidence of the fixture can make a wrongly-trimmed window
  // satisfy it.
  const all = Array.from({ length: total }, (_, i) => effectAt(i) as string);
  expect(h.undo).toEqual(all.slice(-HISTORY_TAIL));
  // …and the two candidate windows really do differ, so the assertion above
  // discriminates rather than merely holding.
  expect(all.slice(0, HISTORY_TAIL)).not.toEqual(all.slice(-HISTORY_TAIL));
  // …and the depth is the REAL one, not the array's length. The palette's "older
  // steps are not listed" line is derived from the difference, so a depth that just
  // repeated `undo.length` would make that line unwritable — and would silently claim
  // the whole history fits.
  expect(h.undoDepth).toBe(total);
  expect(h.undoDepth).toBeGreaterThan(h.undo.length);
});
