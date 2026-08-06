// The multicast push seam behind the host's `subscribe*` members.
//
// FRAMEWORK-FREE on purpose, the rule `frontend/lib/notify-store.ts` states for the
// pull direction: subscribe returns an unsubscribe and nothing more, so every rule
// below — who hears a publish, what a late mount sees, what a throwing subscriber
// costs its siblings — is decided in one place a bare test drives without a DOM or a
// React tree. This is that store's push-seam sibling: no snapshot to pull, because
// the payload rides the notification.
//
// Delivery is ISOLATED per subscriber, a conscious change from the single-slot era
// where one throwing subscriber aborted the rest of the notify sequence mid-commit.
// Host state is already committed when notifications fire (notifications go last —
// the field-host ordering rule), so isolation cannot leave host state half-written;
// it only converts a sibling-severing throw into a console.error. Subscriber
// exceptions are programmer errors, not user-facing refusals — `subscribeToolError`
// is the seam for those, and a surface's bug must not silence the surface behind it.

/** A multicast push seam: N subscribers, optional push-on-subscribe, per-subscriber
 *  delivery isolation.
 *
 *  `Args` is the callback's whole parameter tuple, so a channel carrying nothing is
 *  `ViewChannel<[]>` (its `publish()` takes no arguments and its subscribers are
 *  plain `() => void`) and a channel carrying one value is `ViewChannel<[Foo]>`. */
export type ViewChannel<Args extends unknown[]> = {
  /** Adds `cb`; with a snapshot configured, pushes the current state to it
   *  synchronously before returning (the (re)mount rule: a surface that mounts
   *  mid-state must not render empty beside overlays already showing that state).
   *
   *  Returns an unsubscribe that removes ONLY this callback, which is what makes
   *  React's effect re-run safe by construction — the new effect body subscribes
   *  BEFORE the previous cleanup runs, and a single-slot seam loses the new
   *  subscriber when the stale cleanup fires. Calling it twice is a no-op.
   *
   *  Subscribers are held BY IDENTITY: subscribing the same function reference
   *  twice adds one entry, and the first unsubscribe removes it. Every caller we
   *  have passes a fresh closure per subscribe (React effect bodies do this
   *  inherently), so this is a note about the contract rather than a live hazard —
   *  a caller that wants two independent registrations must pass two functions. */
  subscribe(cb: (...args: Args) => void): () => void;
  /** Delivers to every subscriber in subscribe order, isolating throwers: one
   *  subscriber's exception is reported and the pass continues, and `publish`
   *  itself never throws. Delivery runs over the membership as it stood when the
   *  pass began — see the implementation for why that snapshot matters. */
  publish(...args: Args): void;
  /** Live subscriber count — the leak-detection seam. A count that only climbs
   *  across mount/unmount cycles is a missing cleanup, and with N subscribers
   *  that leak is otherwise invisible: the single-slot era failed loudly (the
   *  second subscriber displaced the first), whereas a Set just grows. */
  size(): number;
};

/**
 * Creates a {@link ViewChannel}.
 *
 * @param opts.snapshot - Reads the current state as the callback's argument tuple.
 *   Present = the state-mirror flavour (every subscriber is pushed the current
 *   value on subscribe); absent = the event flavour (a subscriber hears nothing
 *   until the next `publish`). Re-read PER subscribe rather than captured once, so
 *   a late mount is pushed the state as it is then, not as it was at construction.
 * @returns The channel. Never fails.
 */
export function createViewChannel<Args extends unknown[]>(opts?: {
  snapshot?: () => Args;
}): ViewChannel<Args> {
  const subs = new Set<(...args: Args) => void>();

  const deliver = (cb: (...args: Args) => void, args: Args): void => {
    try {
      cb(...args);
    } catch (err) {
      console.error("view-channel: subscriber threw", err);
    }
  };

  return {
    subscribe(cb) {
      subs.add(cb);
      const snap = opts?.snapshot;
      // `snap()` is deliberately OUTSIDE `deliver`: reading the host's own state
      // is not the subscriber's code, and a snapshot reader that throws is a host
      // bug that must surface at the mount that provoked it rather than be logged
      // and papered over with a subscriber that silently never got its first push.
      if (snap) deliver(cb, snap());
      return () => {
        subs.delete(cb);
      };
    },
    publish(...args) {
      // Iterate a COPY. A subscriber is free to (un)subscribe from inside its own
      // delivery — a React commit provoked by one push can tear down the surface
      // holding another — and a live Set mutated mid-iteration would let one
      // subscriber's bookkeeping decide whether its siblings hear this pass at
      // all. The pass therefore runs over the membership as it stood at publish:
      // someone removed mid-pass is still delivered to, someone added mid-pass
      // waits for the next one. Deliberate over the cheaper live iteration: the
      // alternative makes delivery depend on subscribe ORDER, which no caller
      // controls.
      for (const cb of [...subs]) deliver(cb, args);
    },
    size: () => subs.size,
  };
}
