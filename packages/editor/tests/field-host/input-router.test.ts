import { describe, expect, test } from "bun:test";
import {
  type CaptureHandle,
  createInputRouter,
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
