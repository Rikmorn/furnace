import { describe, expect, test } from "bun:test";
import type * as binding from "@furnace/core/binding";
import * as field from "@furnace/core/field";
import type * as geometry from "@furnace/core/geometry";
import type * as gpu from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import type * as mesh from "@furnace/core/mesh";
import { FieldWorkerClient } from "../../src/field-host/field-client";
import { createFlagStore } from "../../src/field-host/field-flags";
import type { FieldHistory } from "../../src/field-host/field-history";
import { createHistoryFeed } from "../../src/field-host/field-history-feed";
import {
  type ChunkRender,
  createHostSubstrate,
  type PropRender,
} from "../../src/field-host/substrate";

// TWO PROPERTIES, each here only because nothing else pins it.
//
// (1) That `subscribe` records the change signature BEFORE the channel's snapshot
// fires, not after.
//
// (2) The COMPOSITION of the T4b revision token — which term catches what, and that
// asking for it changes nothing. The numbers are moved by hand here rather than
// through core's verbs, deliberately: this module reads five numbers off an `OpLog`
// and composes them, so a hand-set log is the exact subject and a real one would
// prove core's verbs move the numbers, which is a different claim and is pinned
// against a real host in `tests/field-host-history.test.ts`.
//
// Everything else about this seam is pinned where it has always been, through
// `FieldHost.subscribeHistory` in `tests/field-host-history.test.ts` — the
// multicast delivery, the per-subscriber release, the late arrival, the
// suppression of a tick that moved nothing, and the record-rather-than-CLEAR
// choice — and that file ran across the extraction with its ASSERTIONS unmodified
// (three comment lines were re-pointed at the feed's new name afterwards), which is
// what makes it the pin. Reversing the two statements in `field-history-feed.ts`'s
// `subscribe`, however, reddened NOTHING in the pre-existing editor suite (1,363/0
// either way, checked by sabotage): the host's tests reach the seam through verbs,
// and no verb subscribes a callback that calls back into the host from inside its
// own first push. That is the one thing this file covers — with it in place the
// same reversal reddens exactly one test, the one below — and it is deliberately
// not a second home for history coverage.

/** The spawn the fake worker client never makes — this suite issues no request, so
 *  a thrower here is a tripwire rather than a stub (`field-stats.test.ts`'s). */
const noWorker = () => {
  throw new Error("field-history-feed.test: no worker should be spawned");
};

const noContext: typeof gpu.requestContext = () =>
  Promise.reject(
    new Error("field-history-feed.test: no GPU context should be requested"),
  );

/** The substrate members this module never touches. Only `log` is read; the rest
 *  are here because the record's whole point is that the shape is complete. */
const substrateOver = (log: field.OpLog) =>
  createHostSubstrate({
    store: field.createFieldStore(),
    log,
    dirty: new Set<string>(),
    worker: new FieldWorkerClient(noWorker),
    chunkMeshes: new Map<string, ChunkRender>(),
    flagStore: createFlagStore(),
    requestContext: noContext,
    litByClass: new Map<
      string,
      { mat: material.Material; bind: binding.Binding }
    >(),
    propMeshes: [] as PropRender[],
    ghostMeshes: new Map<string, { m: mesh.Mesh; g: geometry.Geometry }[]>(),
    voidCastMeshes: new Map<string, { m: mesh.Mesh; g: geometry.Geometry }[]>(),
    table: () => field.BUILTIN_TABLE,
    archetypeById: () => new Map(),
    ctx: () => null,
    disposed: () => false,
    canvasEl: () => null,
  });

/** A log entry with no content — the feed reads the two stacks' LENGTHS and their
 *  top identities, never what an entry holds, so an empty `ops` entry is a faithful
 *  stand-in for whatever a stroke would have pushed. */
const entry = (): field.LogEntry => ({
  kind: "ops",
  ops: [],
  inverse: new Map(),
});

describe("createHistoryFeed", () => {
  test("a subscriber that notifies from inside its own first push hears it ONCE", () => {
    const feed = createHistoryFeed({
      substrate: substrateOver(field.createOpLog()),
      worldEpoch: () => 0,
    });

    // The re-entrant subscriber the ordering comment describes: a surface whose
    // arrival push provokes a read of the host that reaches `notify` again. Guarded
    // to the FIRST delivery so the test terminates under either ordering rather
    // than proving its point by hanging.
    let pushes = 0;
    let reentered = false;
    feed.subscribe(() => {
      pushes++;
      if (reentered) return;
      reentered = true;
      feed.notify();
    });

    // With the signature recorded FIRST, the re-entrant notify compares the
    // arrival's own history against itself and publishes nothing. With the two
    // statements reversed, the signature is still null when the snapshot fires, so
    // the guard sees "never published" and hands this subscriber a second copy of
    // the history it was handed a microsecond earlier.
    //
    // The log is empty, which costs the test nothing: what is under test is the
    // order of two statements, and neither of them reads a log entry's content.
    expect(pushes).toBe(1);
  });
});

describe("createHistoryFeed / revision", () => {
  /** A feed over a log and a world counter the case drives directly, with the token read
   *  the way production reads it: off the PUBLISHED payload.
   *
   *  `revision()` reads the LAST push, which is what a chrome mirror holds — so a case
   *  that mutates the log and reads without notifying is asserting exactly the staleness
   *  the payload-carried token exists to make honest. Every case below therefore notifies
   *  first, and one asserts what happens when it does not. */
  const over = (log: field.OpLog) => {
    let epoch = 0;
    const feed = createHistoryFeed({
      substrate: substrateOver(log),
      worldEpoch: () => epoch,
    });
    const pushes: FieldHistory[] = [];
    feed.subscribe((h) => pushes.push(h));
    return {
      feed,
      pushes,
      revision: (): string => {
        feed.notify();
        const last = pushes.at(-1);
        if (last === undefined) throw new Error("the feed published nothing");
        return last.revision;
      },
      swapWorld: () => {
        epoch += 1;
      },
    };
  };

  test("the WORLD term is load-bearing: a swap between two empty logs still moves it", () => {
    // THE CASE THAT DECIDED THE COMPOSITION. `resetWorld` clears both stacks, `log.ops`
    // and `nextId`, so a new world over an empty one leaves all four log terms exactly
    // where they were — and without the epoch the token would tell a caller that read
    // before the swap that nothing had happened. The change guard behind `notify`
    // deliberately has no epoch term (its own comment argues why over the same numbers);
    // this is the half of the module where the two questions come apart.
    const { revision, swapWorld } = over(field.createOpLog());
    const before = revision();
    swapWorld();
    expect(revision()).not.toBe(before);
  });

  test("`nextId` catches the undo-then-do-something-new netting the OTHER four hide", () => {
    // The sequence the change guard's own comment names as the commonest in an editor.
    // Its guard catches it by TOP-ENTRY IDENTITY, which cannot cross a wire; the token
    // catches it because the new op took an id — and NOTHING ELSE in the composition
    // does, which is what makes this the pin for that term alone.
    //
    // The undo below PEELS `log.ops` as well as moving the entry, because that is what
    // core does (`ops.ts`: an `ops` entry undoes by `log.ops.length -= entry.ops.length`).
    // An earlier cut of this case moved the entry only, which left `ops.length` doing the
    // discriminating and let a `nextId`-less composition pass — measured by sabotage, and
    // the reason the peel is spelled out here rather than assumed.
    const log = field.createOpLog();
    const push = (): void => {
      log.ops.push({ id: log.nextId++, kind: "patch", chunks: [] });
      log.undoStack.push(entry());
    };
    push();
    const { revision } = over(log);
    const beforeUndo = revision();

    // Undo: the entry moves to the redo side and its op leaves the tail.
    log.redoStack.push(log.undoStack.pop() as field.LogEntry);
    log.ops.length -= 1;
    expect(revision()).not.toBe(beforeUndo);

    // Something new: the redo side is cleared and a fresh op takes the NEXT id. Both stack
    // lengths and `log.ops.length` are back on the values `beforeUndo` was composed from —
    // only `nextId` moved.
    log.redoStack.length = 0;
    push();
    expect([
      log.ops.length,
      log.undoStack.length,
      log.redoStack.length,
    ]).toEqual([1, 1, 0]);
    expect(revision()).not.toBe(beforeUndo);
  });

  test("an undo followed by its redo lands back on the SAME token", () => {
    // Not a gap — a property. The history really is the one that was published, and a
    // token that changed here would make every round trip through ⌘Z look like an edit.
    const log = field.createOpLog();
    log.ops.push({ id: log.nextId++, kind: "patch", chunks: [] });
    log.undoStack.push(entry());
    const { revision } = over(log);
    const settled = revision();
    log.redoStack.push(log.undoStack.pop() as field.LogEntry);
    log.undoStack.push(log.redoStack.pop() as field.LogEntry);
    expect(revision()).toBe(settled);
  });

  test("THE TOKEN CANNOT RUN AHEAD OF THE LABELS BESIDE IT", () => {
    // THE PROPERTY THE PAYLOAD-CARRIED TOKEN EXISTS FOR, and the one a poll could not
    // have. A mutation lands in the log SYNCHRONOUSLY, and the payload a reader holds is
    // whatever was last published — so the only two honest states are "both old" and
    // "both new". A token minted from the live log would have produced the third: a new
    // token over old labels, which a reader caches and never learns to distrust, because
    // every later read returns that same token.
    const log = field.createOpLog();
    const { feed, pushes } = over(log);
    expect(pushes.length).toBe(1);
    const held = pushes[0] as FieldHistory;

    // The log moves. Nothing has published, so the held payload is stale — WHOLLY stale,
    // token included, which is the safe direction: the reader's next comparison still
    // says "changed" and it re-reads.
    log.ops.push({ id: log.nextId++, kind: "patch", chunks: [] });
    log.undoStack.push(entry());
    expect(pushes.length).toBe(1);
    expect(pushes.at(-1)).toBe(held);

    // …and when the publish lands, the token and the labels move in the SAME payload.
    feed.notify();
    expect(pushes.length).toBe(2);
    const fresh = pushes[1] as FieldHistory;
    expect(fresh.revision).not.toBe(held.revision);
    expect(fresh.undoDepth).not.toBe(held.undoDepth);
  });
});
