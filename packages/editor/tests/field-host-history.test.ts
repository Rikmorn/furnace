// FieldHost's named-history seam (F4.5b Task 12), headless.
//
// No GPU is needed: the payload is derived from `log.undoStack`/`log.redoStack` — two
// plain public core arrays — and every verb driven below decides its log mutation before
// any upload. The one path this file CANNOT reach is the brush stroke, which needs a
// pointer over a live context; its push is pinned in `field-host-pointer.gpu.test.ts`.
// Between the two files every host path that mutates the log is covered.
//
// HERE and not in `tests/field-host/`, for the reason field-host-entity-verbs.test.ts
// states: that directory holds this slice's PURE module tests, and `bun test` runs
// `tests/chrome/` — which registers happy-dom and replaces `globalThis.navigator` — before
// any sibling subdirectory, so a host suite there passes alone and fails in the full run.
//
// The world arrives through `loadWorld` because that is the only headless route to a
// committed entity (a stamp session needs a pointer-made selection).
import { expect, test } from "bun:test";
import type { FieldManifest, MaterialTable } from "@furnace/core/field";
import {
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  encodeMaterialFile,
  generatorById,
  serializeOps,
} from "@furnace/core/field";
import { createFieldHost } from "../src/field-host/field-host.ts";
import type { FieldHistory } from "../src/field-host/index.ts";

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** The package's shared 3-class headless table (one kit class — every stamp needs one). */
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

/** `Hall` — the registry's display name, which is what every label carries. */
const HALL = generatorById("hall").name;

/** Builds a one-hall world with CORE and hands it to `host` through loadWorld. Returns
 *  the entity id. The load itself pushes NO undo entry (the stacks are cleared by the
 *  reset and `parseOps` re-seeds `log.ops` alone), so every test below starts from an
 *  empty history however many ops the world holds. */
function loadHallWorld(host: ReturnType<typeof createFieldHost>): number {
  const store = createFieldStore();
  const log = createOpLog();
  const entityId = commitGenerator(store, log, generatorById("hall"), {
    params: structuredClone(generatorById("hall").defaults),
    seed: 7,
    region: HALL_REGION,
    policy: "replace",
    table: TABLE,
  }).entity.entityId;
  host.setMaterialTable(TABLE);
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [...store.chunks].map(([key, density]) => ({
      key,
      bytes: encodeChunkFile(density),
    })),
    materials: [...store.materials].map(([key, m]) => ({
      key,
      bytes: encodeMaterialFile(m),
    })),
    oplog: serializeOps(log.ops),
  });
  return entityId;
}

/** The payload WITHOUT its change token — what a case about labels and depths means by
 *  "the history". The token is opaque and moves with the log rather than with the words,
 *  so a whole-payload `toEqual` would make every label case restate a string it is not
 *  about; the cases that ARE about it read `.revision` directly. */
const labelled = (h: FieldHistory): Omit<FieldHistory, "revision"> => {
  const { revision: _revision, ...rest } = h;
  return rest;
};

/** Subscribes and records every push. Returns the recorder plus the unsubscribe. */
function watch(host: ReturnType<typeof createFieldHost>) {
  const pushes: FieldHistory[] = [];
  const off = host.subscribeHistory((h) => pushes.push(h));
  return { pushes, off, last: () => pushes.at(-1) as FieldHistory };
}

test("subscribe pushes the CURRENT history immediately", () => {
  const host = createFieldHost();
  const w = watch(host);
  // The remount rationale every other seam here carries: a surface mounting after the
  // world loaded must not render an empty list beside a live undo stack.
  expect(w.pushes.length).toBe(1);
  expect(labelled(w.last())).toEqual({
    undo: [],
    redo: [],
    undoDepth: 0,
    redoDepth: 0,
  });
});

test("the seam is MULTICAST, and each release frees only its own subscriber", () => {
  const host = createFieldHost();
  const id = loadHallWorld(host);
  const first = watch(host);
  const second = watch(host);
  host.setEntityFrozen(id, true);
  // BOTH hear it. The second subscriber used to steal the slot and leave the first
  // silently dead; since T3a the seam is a channel and every subscriber gets every
  // push (each already had the arrival push, so two apiece).
  expect(first.pushes.length).toBe(2);
  expect(second.pushes.length).toBe(2);
  // Arriving second does not mean seeing something different: one payload is built
  // per publish and shared, so the two agree by construction.
  expect(first.last()).toEqual(second.last());
  // A release frees ONLY its own subscriber — the count is now the leak detector
  // the empty slot used to be. A `first` that kept receiving here is a cleanup that
  // did not run.
  first.off();
  host.setEntityFrozen(id, false);
  expect(first.pushes.length).toBe(2);
  expect(second.pushes.length).toBe(3);
  // …and the seam goes quiet when the LAST one leaves, which is also where the echo
  // signature stops advancing (the feed's `size() === 0` guard).
  second.off();
  host.setEntityFrozen(id, true);
  expect(second.pushes.length).toBe(3);
});

test("a subscriber that arrives mid-world is pushed the history the others hold", () => {
  const host = createFieldHost();
  const id = loadHallWorld(host);
  const first = watch(host);
  host.setEntityFrozen(id, true);
  // The late arrival gets the CURRENT history on the way in — not the empty one the
  // first subscriber saw, and not a re-broadcast to `first`, whose count must not move.
  const late = watch(host);
  expect(late.pushes.length).toBe(1);
  expect(late.last()).toEqual(first.last());
  expect(first.pushes.length).toBe(2);
  // And the arrival did not re-arm the shared echo guard: a tick that moves no
  // history still publishes nothing to anybody.
  host.setEntityFrozen(id, true);
  expect(first.pushes.length).toBe(2);
  expect(late.pushes.length).toBe(1);
});

// --- every log-mutating host verb publishes ---------------------------------
//
// Table-driven, and that is the point rather than a style choice: the feed's `notify` is
// reached from TWO chokepoints (inside `notifyEntities`, which every entity-record path
// funnels through by its own contract, and `commitToolOp`), so what has to be pinned is
// that each verb really does reach one of them. A per-verb `test` block would make each
// row a separate thing to remember to write; a table makes a missing row visible as a
// missing line.
const MUTATORS: readonly (readonly [
  string,
  (host: ReturnType<typeof createFieldHost>, entityId: number) => void,
  string,
])[] = [
  ["deleteEntity", (h, id) => h.deleteEntity(id), `delete ${HALL}`],
  ["duplicateEntity", (h, id) => h.duplicateEntity(id), `stamp ${HALL}`],
  ["setEntityFrozen", (h, id) => h.setEntityFrozen(id, true), `freeze ${HALL}`],
  ["bakeEntity", (h, id) => h.bakeEntity(id), `bake ${HALL}`],
];

test("every entity verb publishes a history whose TOP names what it did", () => {
  for (const [name, run, label] of MUTATORS) {
    const host = createFieldHost();
    const id = loadHallWorld(host);
    const w = watch(host);
    run(host, id);
    expect([name, w.pushes.length]).toEqual([name, 2]);
    expect([name, w.last().undo.at(-1)]).toEqual([name, label]);
    expect([name, w.last().undoDepth]).toEqual([name, 1]);
    expect([name, w.last().redoDepth]).toEqual([name, 0]);
  }
});

test("undo moves the entry to the REDO side and republishes both", () => {
  const host = createFieldHost();
  const id = loadHallWorld(host);
  const w = watch(host);
  host.deleteEntity(id);
  host.undo();
  expect(labelled(w.last())).toEqual({
    undo: [],
    redo: [`delete ${HALL}`],
    undoDepth: 0,
    redoDepth: 1,
  });
  host.redo();
  expect(labelled(w.last())).toEqual({
    undo: [`delete ${HALL}`],
    redo: [],
    undoDepth: 1,
    redoDepth: 0,
  });
});

test("topEntryOrigin reads the TOP entry's tag, per stack — the ownership guard's reader", () => {
  // **THE FACADE HALF OF THE UNDO OWNERSHIP GUARD (undo-attribution slice).** The guard
  // itself is `frontend/lib/actions.ts`' and is unit-tested against a host SPY
  // (`tests/actions.test.ts`), which pins the policy and can say nothing about whether this
  // delegate reads the right array. That is exactly the defect this case exists for: the
  // two stacks are one ternary apart, and a reader that answered the undo stack for both
  // would let an agent redo over the human's work while every policy case stayed green.
  const host = createFieldHost();
  const id = loadHallWorld(host);
  // A LOADED WORLD HAS AN EMPTY HISTORY (the case above states it), and an empty stack
  // answers `undefined` — the same answer a human-authored top gives. The guard never has
  // to tell them apart because `enabled` refuses the empty case first, which is why this is
  // a documented conflation rather than a hole.
  expect(host.topEntryOrigin("undo")).toBeUndefined();
  expect(host.topEntryOrigin("redo")).toBeUndefined();

  host.deleteEntity(id, "agent:mcp");
  expect(host.topEntryOrigin("undo")).toBe("agent:mcp");
  expect(host.topEntryOrigin("redo")).toBeUndefined();

  // THE ENTRY CARRIES ITS TAG ACROSS THE STEP, which is what makes an agent's own redo
  // reachable at all: undo moves the entry to the other stack, and the origin moves with it.
  host.undo();
  expect(host.topEntryOrigin("undo")).toBeUndefined();
  expect(host.topEntryOrigin("redo")).toBe("agent:mcp");

  // ABSENT = HUMAN, on a fresh host so the assertion is about the WRITE and not about a
  // previous entry having been cleared.
  const theirs = createFieldHost();
  theirs.deleteEntity(loadHallWorld(theirs));
  expect(theirs.topEntryOrigin("undo")).toBeUndefined();
});

test("a world reset empties the history", () => {
  const host = createFieldHost();
  const id = loadHallWorld(host);
  const w = watch(host);
  host.setEntityFrozen(id, true);
  expect(w.last().undoDepth).toBe(1);
  host.newWorld();
  expect(labelled(w.last())).toEqual({
    undo: [],
    redo: [],
    undoDepth: 0,
    redoDepth: 0,
  });
});

test("loading a world replaces the previous world's history", () => {
  const host = createFieldHost();
  const id = loadHallWorld(host);
  const w = watch(host);
  host.setEntityFrozen(id, true);
  expect(w.last().undo).toEqual([`freeze ${HALL}`]);
  loadHallWorld(host);
  expect(labelled(w.last())).toEqual({
    undo: [],
    redo: [],
    undoDepth: 0,
    redoDepth: 0,
  });
});

// --- the change guard -------------------------------------------------------

test("an entity tick that moved NO history does not republish", () => {
  const host = createFieldHost();
  const id = loadHallWorld(host);
  const w = watch(host);
  // Core's `setGeneratorFrozen` is a SETTER: unfreezing what is not frozen is a
  // well-formed request that is already satisfied, so it pushes no entry and — this is
  // the part that matters here — clears no redo stack. The host still ticks the entity
  // list for it. Without the guard, that tick would republish an unchanged history to
  // the chrome, which re-renders a 50-row palette for nothing.
  host.setEntityFrozen(id, false);
  expect(w.pushes.length).toBe(1); // the subscribe's own push, and nothing since
});

test("undo, redo, undo, then a NEW op — the top is renamed at every step", () => {
  // The sequence that returns the two stack LENGTHS to numbers they already held: a
  // delete undone and redone lands back on (1, 0) with the same entry, and the fresh
  // freeze after the second undo lands on (1, 0) again with a different one. Every
  // step is a real republish, and the last one is what the Undo menu reads.
  const host = createFieldHost();
  const id = loadHallWorld(host);
  const w = watch(host);
  host.deleteEntity(id); // (undo 1, redo 0) — top: "delete Hall"
  host.undo(); //           (undo 0, redo 1)
  host.redo(); //           (undo 1, redo 0), the same entry back
  expect(w.last().undo).toEqual([`delete ${HALL}`]);
  host.undo(); //           (undo 0, redo 1) — the hall is back
  host.setEntityFrozen(id, true); // clears redo, pushes one: (undo 1, redo 0)
  expect(w.last().undoDepth).toBe(1);
  expect(w.last().redoDepth).toBe(0);
  expect(w.last().undo).toEqual([`freeze ${HALL}`]);
});

// DISCLOSED AS UNPINNED, rather than left to look covered: the signature's TOP-ENTRY
// identity terms cannot be made to fire from this API, and an earlier version of the
// test above claimed they could. They cannot because the property they would catch is
// unreachable while the discipline holds — the feed's `notify` runs after every single log
// mutation, and every single mutation moves at least one stack LENGTH (a push clears
// redo and grows undo; an undo trades one for the other), so two consecutive signatures
// can never agree on both lengths while disagreeing on content. Removing both identity
// terms leaves this file 8/0.
//
// What they defend is the residual risk of routing the push through two chokepoints
// instead of ten: a future path that mutates the log and forgets to notify. Undo
// (silently), then a new op (notified) returns the lengths to where the guard last saw
// them, and a length-only signature would swallow that push for good — the menu would
// offer "Undo delete Hall" over a log whose last act was a freeze, until something else
// happened. With the identity terms the seam self-heals on the very next notify. Two
// reference compares, and the reason they are here is written down rather than assumed.

// --- the revision token (foundations T4b) -----------------------------------
//
// `session.state`'s cursor: an opaque string an agent holds and compares to ask "has
// anything happened since I looked". It rides the PUBLISHED payload rather than a poll,
// so every case here reads it off `w.last().revision` — which is exactly what the wire
// carries, and what makes "the token and the labels beside it describe one moment" a
// thing a test can even ask about. HERE rather than in
// `tests/field-host/field-history-feed.test.ts` because what these cases are about is
// whether the HOST's verbs move it; the composition itself is pinned over a hand-set log
// next door, and neither file proves the other's half.

test("the token moves on a mutation, and an undo/redo round trip returns it", () => {
  const host = createFieldHost();
  const id = loadHallWorld(host);
  const w = watch(host);
  const loaded = w.last().revision;

  host.setEntityFrozen(id, true);
  const frozen = w.last().revision;
  expect(frozen).not.toBe(loaded);

  host.undo();
  expect(w.last().revision).not.toBe(frozen);

  // Back to the state the token was taken over, so back to the token. A value that
  // changed here would make every ⌘Z/⇧⌘Z pair read as an edit.
  host.redo();
  expect(w.last().revision).toBe(frozen);
});

test("a NEW WORLD over an empty one still moves the token — and PUBLISHES", () => {
  // THE CASE THE WORLD TERM EXISTS FOR, at the host, and since the token joined the
  // payload it is two claims rather than one. `resetWorld` clears `log.ops`, both stacks
  // and `nextId`, so over an already-empty world every log-derived term is identical on
  // both sides of the swap and the epoch is the only thing that moved.
  //
  // THE PUBLISH is the half the payload-carried token added, and it is why the change
  // guard grew the epoch. Measured before that change: this swap published NOTHING,
  // because the guard compared the two stacks alone and both were empty either side. A
  // token riding a payload that is never pushed is a token that never moves — an agent
  // would have read one world, watched the human open another, and been told nothing had
  // happened.
  const host = createFieldHost();
  const w = watch(host);
  const empty = w.last().revision;
  expect(w.pushes.length).toBe(1);

  host.newWorld();

  expect(w.pushes.length).toBe(2);
  expect(w.last().revision).not.toBe(empty);
  // …and the labels did NOT change, which is the cost this publish buys the token: the
  // palette re-renders an identical empty list once, on a rare user-initiated act.
  expect(labelled(w.last())).toEqual(labelled(w.pushes[0] as FieldHistory));
});

test("THE ONE ALIAS IT CARRIES, pinned so the gap cannot be forgotten", () => {
  // Freeze, undo, then BAKE. Both are `entity-update` entries: they swap one entity op's
  // record in place, so neither creates an op — `log.ops.length` and `log.nextId` are
  // untouched — and the two stack lengths land back on (1, 0). Five identical terms over
  // a world where a different thing is now true.
  //
  // This is the gap `field-history-feed.ts`'s `revision` documents, reproduced rather than
  // described: an agent treating the token as a CORRECTNESS signal would carry "that
  // entity is frozen" past the point where it became "that entity is baked". It is why
  // the contract is "re-read the state, never diff the cursors" — and why a change to the
  // composition should come here first.
  const host = createFieldHost();
  const id = loadHallWorld(host);
  const w = watch(host);
  host.setEntityFrozen(id, true);
  const frozen = w.last().revision;
  expect(host.listEntities()[0]?.frozen).toBe(true);

  host.undo();
  host.bakeEntity(id);
  expect(w.last().revision).toBe(frozen);
  // …and the world is demonstrably NOT the one that token was taken over.
  expect(host.listEntities()[0]?.frozen).toBeUndefined();
  expect(host.listEntities()[0]?.baked).toBe(true);
});

test("`ops.length` is LOAD-BEARING — undo, then a mutation that mints no op", () => {
  // THE OTHER HALF of the pair that stands in for the change guard's top-entry identity,
  // and the case that reversed this term's own docblock: it claimed `ops.length` was
  // redundant and unpinnable, and this is the ordinary editing sequence that disproves it.
  //
  // `nextId` covers undo-then-a-new-OP. It does NOT cover undo-then-a-new-ENTITY-UPDATE,
  // because freeze and bake mint no op: the undo PEELS `log.ops` (an `ops` entry undoes by
  // `log.ops.length -= entry.ops.length`) and the entity-update refills the undo STACK
  // without putting anything back in the log. So the epoch, both stack lengths and
  // `nextId` all land identically across two worlds that differ by a whole entity, and
  // `log.ops.length` is the only term left holding them apart.
  const host = createFieldHost();
  const id = loadHallWorld(host);
  const w = watch(host);

  host.duplicateEntity(id);
  const duplicated = w.last().revision;
  expect(host.listEntities().length).toBe(2);

  host.undo();
  host.setEntityFrozen(id, true);
  const frozen = w.last().revision;

  // Two genuinely different worlds — one with a second hall in it, one with a single
  // frozen hall — and the token says so.
  expect(host.listEntities().length).toBe(1);
  expect(frozen).not.toBe(duplicated);

  // …and it says so ONLY through this term. Every other term is equal across the two,
  // which is what makes the claim "load-bearing" rather than "one of five that happened
  // to differ". Asserted by composing the token WITHOUT `ops.length` — the same drop the
  // sabotage cut makes — and finding the two indistinguishable.
  const withoutOpsLength = (rev: string): string => {
    const [epoch, , ...rest] = rev.split("/");
    return [epoch, ...rest].join("/");
  };
  expect(withoutOpsLength(frozen)).toBe(withoutOpsLength(duplicated));
});
