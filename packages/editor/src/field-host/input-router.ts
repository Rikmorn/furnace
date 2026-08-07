// The escape-capture stack — what the host's fixed-priority Esc ladder (D-12)
// became once its ordering rule was written down honestly.
//
// A gesture or a selection ACQUIRES a capture when its state becomes live and
// RELEASES it in the same canonical setter that clears the state, so MEMBERSHIP
// IS LIVENESS: the stack cannot hold an entry for a state that is gone, and Esc
// cannot miss one that is standing. That is the whole reason every mutation of a
// captured state must go through its setter (or, where a path deliberately
// writes the slot itself, must reconcile in the same breath) — a bare assignment
// that skips the reconcile leaves a capture behind, and the next Esc spends
// itself cancelling something that already ended. That bug class is what this
// module exists to end; T3c finishes the job for pointer capture.
//
// Esc cancels the TOP, which is RECENCY — and recency is what the old ladder's
// fixed rung order was approximating. Every rung's own comment argued from it
// ("an arm is by definition more recent than any session still standing beside
// it"; "the ladder takes the most recent step first"), and the order held only
// because the common flows happen to acquire in that order. Making it structural
// costs the cases where the fixed order and the acquisition order disagree — a
// cell selection drawn AFTER an entity was picked now goes first — and in each
// of those the stack is the one obeying the ladder's stated principle.
//
// PACKAGE-INTERNAL, deliberately not re-exported from `index.ts`: like
// `view-channel.ts` this is a seam between the host and the clusters lifted out
// of it, not surface the chrome may reach for.

/** The token a capture is released by. Opaque and identity-keyed — two captures
 *  with the same label are two entries, and only the handle its acquisition
 *  returned can remove it. The `label` is for debugging and test readability;
 *  nothing routes on it. */
export type CaptureHandle = { readonly label: string };

/** The Esc capture stack: acquire while live, release when cleared, cancel the
 *  most recent on Esc. */
export type InputRouter = {
  /** Pushes a capture and returns its handle.
   *
   *  `cancel` is invoked by {@link escape} AFTER the entry has been removed, so a
   *  cancel that re-acquires (an arm whose drawn corner is cancelled goes back to
   *  asking for a region) pushes a FRESH entry at the top rather than resurrecting
   *  the one the press just spent.
   *
   *  Re-acquiring a state that is ALREADY captured must keep its stack position,
   *  and that discipline lives at the call site rather than here: a setter owns a
   *  handle slot and only calls this when the slot is empty. Calling `capture`
   *  twice for one state pushes two entries, which is the caller's bug. */
  capture(label: string, cancel: () => void): CaptureHandle;
  /** Removes the entry for `handle` wherever it sits, WITHOUT cancelling it —
   *  ending a state is not the same event as Esc cancelling it. Identity, not
   *  top-only: a session can end (⏎) while an older selection capture still
   *  stands beneath it. A handle that is not on the stack is a no-op, which is
   *  what lets a canonical setter reconcile unconditionally. */
  release(handle: CaptureHandle): void;
  /** Cancels the top capture. Returns whether anything was cancelled — the
   *  keydown branch's "did I claim this event" answer, and the reason a press
   *  with nothing captured still reaches the app-level registry. */
  escape(): boolean;
  /** Stack depth, for tests and the T3c gesture machine's assertions. */
  size(): number;
};

/**
 * Creates an {@link InputRouter}. One per host; it holds that host's live
 * captures for its lifetime.
 *
 * @returns The router. Never fails.
 */
export function createInputRouter(): InputRouter {
  type Entry = { handle: CaptureHandle; cancel: () => void };
  const stack: Entry[] = [];
  const indexOf = (h: CaptureHandle): number =>
    stack.findIndex((e) => e.handle === h);
  return {
    capture(label, cancel) {
      const handle: CaptureHandle = { label };
      stack.push({ handle, cancel });
      return handle;
    },
    release(handle) {
      const i = indexOf(handle);
      if (i !== -1) stack.splice(i, 1);
    },
    escape() {
      // Popped BEFORE the cancel runs — see `capture`'s contract. The cancel is
      // free to mutate the stack (it usually does: it calls the setter whose
      // reconcile releases this very handle, harmlessly, since the entry is
      // already gone).
      const top = stack.pop();
      if (top === undefined) return false;
      top.cancel();
      return true;
    },
    size: () => stack.length,
  };
}

/**
 * Wires ONE rung to the state it speaks for, and returns the RECONCILE — the
 * call every canonical setter makes after writing its slot, and the only thing
 * any path that writes the slot itself has to remember.
 *
 * The whole discipline is the handle slot it closes over: acquire on the first
 * live read, release on the first dead one, and do NOTHING while it stays live.
 * That last clause is what makes a REPLACE (a selection displacing another, an
 * entity pick displacing another) keep the position its first acquisition took —
 * acquisition order, not last-touch order, is what reproduces the old ladder's
 * behaviour on the flows that had one.
 *
 * HERE rather than in each cluster, and the reason is the bug this file exists
 * to end. Rungs stand in three modules — `field-host.ts` (the box anchor, the
 * cell selection, the selected entity), `field-machine.ts` (the live session, the
 * pending stamp arm, the sub-threshold move press) and `field-segment.ts` (the
 * segment anchor) — and a copy of these six lines per module is precisely how two
 * of them come to disagree about WHEN they acquire, which is the ordering Esc is
 * defined by. It lived as a private factory inside `createFieldHost` until
 * foundations T3c, where extracting the session machine made the host either
 * export it across a module boundary or watch a second spelling appear;
 * `field-segment.ts` had already hand-rolled a third.
 *
 * @param router - The stack this rung captures on.
 * @param label - Debug/test name for the entry; nothing routes on it.
 * @param isLive - Whether the state this rung speaks for is currently standing.
 *   Read on every reconcile, so it must see the slot AFTER the write.
 * @param cancel - What Esc does to that state. Invariably the canonical setter's
 *   null — an Esc that went one rung too far then has the same way back any
 *   other clear has.
 * @returns The reconcile. Idempotent, and safe to call from a path that changed
 *   nothing. Never fails.
 */
export function createRung(
  router: InputRouter,
  label: string,
  isLive: () => boolean,
  cancel: () => void,
): () => void {
  let handle: CaptureHandle | null = null;
  return () => {
    if (isLive()) {
      if (handle === null) handle = router.capture(label, cancel);
      return;
    }
    if (handle === null) return;
    router.release(handle);
    handle = null;
  };
}
