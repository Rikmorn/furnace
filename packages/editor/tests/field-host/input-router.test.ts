import { describe, expect, test } from "bun:test";
import {
  type CaptureHandle,
  createInputRouter,
  createRung,
} from "../../src/field-host/input-router";

describe("createInputRouter", () => {
  test("escape() on an empty stack returns false and does nothing", () => {
    const router = createInputRouter();

    // The claimed-event contract: a press with nothing captured must answer
    // false, or the canvas branch would stopPropagation an Esc the app-level
    // registry still wants.
    expect(router.escape()).toBe(false);
    expect(router.size()).toBe(0);
  });

  test("escape() cancels the TOP capture, one press at a time", () => {
    const router = createInputRouter();
    const cancelled: string[] = [];
    router.capture("a", () => cancelled.push("a"));
    router.capture("b", () => cancelled.push("b"));

    // Recency: `b` acquired last, so `b` goes first — and `a` is untouched,
    // which is what makes this "one thing per press" rather than a teardown.
    expect(router.escape()).toBe(true);
    expect(cancelled).toEqual(["b"]);
    expect(router.size()).toBe(1);

    expect(router.escape()).toBe(true);
    expect(cancelled).toEqual(["b", "a"]);
    expect(router.size()).toBe(0);
    expect(router.escape()).toBe(false);
  });

  test("release() removes exactly that entry wherever it sits", () => {
    const router = createInputRouter();
    const cancelled: string[] = [];
    // A selection captured first, then a session opened beside it — the session
    // ends on its own (⏎ commits it) while the older selection still stands, so
    // release must be identity-keyed rather than top-only.
    router.capture("selection", () => cancelled.push("selection"));
    const session = router.capture("session", () => cancelled.push("session"));
    const arm = router.capture("arm", () => cancelled.push("arm"));

    router.release(session);

    expect(router.size()).toBe(2);
    // Released, never cancelled: ending a state is not the same event as Esc
    // cancelling it.
    expect(cancelled).toEqual([]);
    expect(router.escape()).toBe(true);
    expect(cancelled).toEqual(["arm"]);
    expect(router.escape()).toBe(true);
    expect(cancelled).toEqual(["arm", "selection"]);

    // Releasing an entry that is already gone is a no-op, which is what lets a
    // canonical setter reconcile unconditionally.
    router.release(session);
    router.release(arm);
    expect(router.size()).toBe(0);
  });

  test("the call-site discipline keeps a re-acquired state's stack position", () => {
    const router = createInputRouter();
    const cancelled: string[] = [];
    // The pattern every canonical setter follows: the SITE owns a handle slot
    // and only calls capture() when the slot is empty. A REPLACE (one selection
    // displacing another) therefore keeps the position the first acquisition
    // took — acquisition order, not last-touch order, is what reproduces the
    // old ladder.
    let selectionSlot: CaptureHandle | null = null;
    const reconcileSelection = (live: boolean): void => {
      if (live) {
        if (selectionSlot === null)
          selectionSlot = router.capture("selection", () =>
            cancelled.push("selection"),
          );
        return;
      }
      if (selectionSlot !== null) {
        router.release(selectionSlot);
        selectionSlot = null;
      }
    };

    reconcileSelection(true);
    const first = selectionSlot;
    router.capture("entity", () => cancelled.push("entity"));
    // A second selection replacing the first: still live, so the slot stands.
    reconcileSelection(true);

    expect(selectionSlot).toBe(first);
    expect(router.size()).toBe(2);
    // The entity is still on top even though the selection was touched last.
    expect(router.escape()).toBe(true);
    expect(cancelled).toEqual(["entity"]);
    expect(router.escape()).toBe(true);
    expect(cancelled).toEqual(["entity", "selection"]);

    // A cancel-driven clear empties the slot too, so the next acquisition is a
    // FRESH push at the top rather than a resurrection in place.
    reconcileSelection(false);
    expect(selectionSlot).toBeNull();
  });

  test("cancel() runs after its entry has already left the stack", () => {
    const router = createInputRouter();
    const order: string[] = [];
    let reAcquired: CaptureHandle | null = null;
    // A cancel that re-acquires: cancelling an arm's drawn corner leaves the arm
    // asking for a region again. Because the entry is removed BEFORE the cancel
    // runs, the re-acquisition is a fresh push — the alternative (pop after)
    // would resurrect the entry the press just spent.
    router.capture("outer", () => order.push("outer"));
    router.capture("re-acquiring", () => {
      order.push(`during:size=${router.size()}`);
      reAcquired = router.capture("re-acquired", () =>
        order.push("re-acquired"),
      );
    });

    expect(router.escape()).toBe(true);
    // size 1 during the cancel = the outer entry only; the cancelling entry was
    // already gone.
    expect(order).toEqual(["during:size=1"]);
    expect(reAcquired).not.toBeNull();
    expect(router.size()).toBe(2);

    // The fresh entry is on TOP, so the next press spends it before the outer.
    expect(router.escape()).toBe(true);
    expect(order).toEqual(["during:size=1", "re-acquired"]);
    expect(router.escape()).toBe(true);
    expect(order).toEqual(["during:size=1", "re-acquired", "outer"]);
  });
});

// The rung factory, which is the shape every captured state in the editor now uses.
//
// It had NO direct coverage until this file: `createRung` was a private arrow inside
// `createFieldHost` until foundations T3c, where extracting the session machine forced
// the choice between exporting it and watching a second spelling appear. It was promoted
// to this module and every rung — three in `field-host.ts`, three in `field-machine.ts`,
// one in `field-segment.ts` — routes through it. Seven captured states resting on six
// lines that nothing asserted directly is the gap these cases close; the host suites
// exercise it end-to-end, but only through gestures, and only for the paths those
// gestures happen to take.
describe("createRung", () => {
  test("acquires on the first live reconcile and never a second time", () => {
    const router = createInputRouter();
    let live = false;
    const sync = createRung(
      router,
      "thing",
      () => live,
      () => undefined,
    );

    // Dead, and reconciled: no entry. The reconcile must be safe from a path that
    // changed nothing — every canonical setter calls it unconditionally.
    sync();
    expect(router.size()).toBe(0);

    live = true;
    sync();
    expect(router.size()).toBe(1);

    // MEMBERSHIP IS LIVENESS, not a push count: a live→live transform reconciles
    // too (`setStamp` calls this on all thirteen writes), and a second entry there
    // would move the state's position in the stack every time a param changed.
    sync();
    sync();
    expect(router.size()).toBe(1);
  });

  test("releases on the first dead reconcile, and a double clear is a no-op", () => {
    const router = createInputRouter();
    let live = true;
    const sync = createRung(
      router,
      "thing",
      () => live,
      () => undefined,
    );
    sync();
    expect(router.size()).toBe(1);

    live = false;
    sync();
    expect(router.size()).toBe(0);
    // The slot is what makes this idempotent — without it the second call would
    // release a handle the router no longer has.
    sync();
    expect(router.size()).toBe(0);
  });

  test("re-arming after a clear takes a FRESH entry, on top", () => {
    const router = createInputRouter();
    let mine = false;
    const sync = createRung(
      router,
      "mine",
      () => mine,
      () => {
        mine = false;
      },
    );

    mine = true;
    sync();
    const other = router.capture("other", () => undefined);
    expect(other).not.toBeNull();

    // `other` is on top, so it goes first — this rung is untouched underneath.
    expect(router.escape()).toBe(true);
    expect(mine).toBe(true);

    // Clear and re-arm: the new entry must be at the TOP, not back in its old
    // position. Recency is what the stack replaced the fixed ladder with.
    mine = false;
    sync();
    const under = router.capture("under", () => undefined);
    expect(under).not.toBeNull();
    mine = true;
    sync();
    expect(router.size()).toBe(2);
    expect(router.escape()).toBe(true);
    expect(mine).toBe(false); // the re-armed rung went first
  });

  test("Esc runs the rung's cancel, and the cancel's own clear releases the entry", () => {
    const router = createInputRouter();
    let live = true;
    // The canonical shape: cancel is the SETTER's null, and the setter reconciles.
    // That is what makes the entry disappear without the rung being told twice.
    const sync = createRung(
      router,
      "session",
      () => live,
      () => {
        live = false;
        sync();
      },
    );
    sync();
    expect(router.size()).toBe(1);

    expect(router.escape()).toBe(true);
    expect(live).toBe(false);
    // Already removed by `escape` before the cancel ran; the cancel's own
    // reconcile then finds no handle and no-ops. Neither path leaves a dead entry.
    expect(router.size()).toBe(0);
  });

  test("two rungs are two entries, and each answers only for its own state", () => {
    const router = createInputRouter();
    let a = false;
    let b = false;
    const syncA = createRung(
      router,
      "a",
      () => a,
      () => {
        a = false;
      },
    );
    const syncB = createRung(
      router,
      "b",
      () => b,
      () => {
        b = false;
      },
    );

    a = true;
    syncA();
    b = true;
    syncB();
    expect(router.size()).toBe(2);

    // `b` acquired last, so one press takes `b` and leaves `a` standing — the
    // property the seven live rungs across three modules depend on.
    expect(router.escape()).toBe(true);
    expect([a, b]).toEqual([true, false]);
    expect(router.escape()).toBe(true);
    expect([a, b]).toEqual([false, false]);
    expect(router.size()).toBe(0);
  });
});
