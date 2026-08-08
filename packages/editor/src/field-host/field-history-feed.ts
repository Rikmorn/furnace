// The named-history FEED (`FieldHost.subscribeHistory`): the multicast channel the
// History palette and the Undo menu ride, the change signature that decides whether
// a republish would say anything new, and the two verbs on either side of it. The
// FIFTH cluster lifted out of `createFieldHost`, after `field-segment.ts`,
// `field-voidcast.ts`, `field-props.ts` and `field-stats.ts`.
//
// NOT IN `field-history.ts`, which sits next door and already owns the word. That
// module DERIVES the labels — it is PURE and GPU-free, and its header says so as a
// contract rather than as an observation — while this one holds a channel and a
// mutable signature, which is state by definition. Merging them would take away the
// one property the pure module is documented to have. The import arrow says which
// is which: this file calls `fieldHistory()`, and nothing over there knows this
// file exists.
//
// WHAT MAKES IT DIFFERENT from the four before it is what it does to the FACADE.
// `createFieldHost` returns thirteen `subscribe*` members; twelve are one-line
// delegates (`return someChannel.subscribe(cb)`), and `subscribeHistory` was the
// thirteenth — the LAST seam in the host that did work before delegating. It wrote
// the change signature first, for a reason that is preserved verbatim on
// {@link HistoryFeed.subscribe} below and is worth keeping: under N subscribers,
// CLEARING the signature would re-broadcast the current history to everybody on the
// next notify that moved nothing. Moving that line inside this module's own
// `subscribe` is the whole point of the extraction — the facade seam becomes a
// delegate like the other twelve, and the ordering it turns on (record BEFORE the
// channel's snapshot fires) stops being an agreement between two files and becomes
// a property of one function.
//
// AND `stepHistory` DID NOT COME, though it wears the name. It calls into FIVE
// clusters — `markDirtyWithNeighbors` (`world`), `cancelStampSession` (`stamp`),
// `revalidateEntitySelection` AND `notifyEntities` (`entities`), `props.rebuild()`
// (the extracted prop layer) and `drift.set`/`drift.notify` (the drift report,
// extracted to `field-drift.ts` at T3d) — and reads `store`, `log`, `table` and
// `stamp` besides, plus `drift.standing()`. It is a lifecycle verb wearing a history
// name: what it owns is "everything a step can move", of which the history push is
// the smallest part. It does not even NAME this module — the push reaches here
// through `notifyEntities`, which carries it by that seam's own contract — so
// `stepHistory` needed no edit at all in this move. Only `commitToolOp`, the one
// log-mutating path that rewrites no entity record, calls the feed directly —
// from `field-tool.ts` since 2026-08-08, through a `notifyHistory` arrow in that
// module's deps record, because `createTool` is assembled ~460 lines above
// `createHistoryFeed`.
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument): there is
// exactly ONE foreign read, `log`, and it was ALREADY declared in `HostSubstrate`,
// so it rides BY VALUE inside the record. It is a `const` in the host that every
// push, pop and clear mutates THROUGH — core's verbs write into the two stacks
// rather than replacing the log — which is why a held reference cannot fork. So
// this module adds nothing to the substrate and carries no private thunk beside it,
// which makes it the first deps record in the tranche with nothing but the
// substrate in it.
//
// ONE TYPE WAS RENAMED and nothing else was. In the closure the signature function
// was typed `NonNullable<typeof historySig>` — a back-reference that works only
// while the `let` it points at is in the same scope, and therefore not a spelling
// that survives a file boundary. The shape is declared once below as
// `HistorySignature` and the `let` is `HistorySignature | null`, which is the same
// type in both places with the dependency running the other way.
import type { LogEntry } from "@furnace/core/field";
import { type FieldHistory, fieldHistory } from "./field-history.ts";
import type { HostSubstrate } from "./substrate.ts";
import { createViewChannel, type ViewChannel } from "./view-channel.ts";

/** What the history feed needs from the rest of the host.
 *
 *  One member, which makes this the shortest deps record in the tranche: everything
 *  the cluster reads is the op log, and the op log is a `HostSubstrate` value member
 *  already. Kept as a RECORD rather than collapsed to a bare `HostSubstrate`
 *  parameter so the five factories in this directory read the same way, and so a
 *  second dependency — the day one is needed — is an added field rather than a
 *  changed signature. */
export type HistoryFeedDeps = {
  /** The host's shared state. ONE member is read, on the value side: `log`, for the
   *  two entry stacks that the payload and the change signature are both derived
   *  from. Nothing here reads a `let`, so nothing here is a call. */
  substrate: HostSubstrate;
};

/** The feed's one verb and the seam the facade delegates to.
 *
 *  No state is exposed. Like `field-stats.ts` — and unlike the first three
 *  extractions — this cluster left nothing behind in the substrate, because nothing
 *  outside it ever read its state directly: the channel had two readers and both of
 *  them are now these two members. */
export type HistoryFeed = {
  /** Publish the named history, IFF it would say something new.
   *
   *  IDEMPOTENT, which is what makes its call sites cheap — see the implementation
   *  for the signature it compares and for the standing obligation on any new path
   *  that touches either entry stack. */
  notify(): void;
  /** The seam behind `FieldHost.subscribeHistory`: adds `cb`, pushes it the current
   *  history synchronously, and records that push against the shared change guard
   *  before the channel fires. The facade delegates to this and does nothing
   *  else. */
  subscribe: ViewChannel<[FieldHistory]>["subscribe"];
};

/** The two entry stacks as the change guard sees them: a length and a top-entry
 *  identity per side.
 *
 *  Module-private, because nothing outside asks what a signature IS — only whether
 *  the history moved. It is a NAMED type rather than the closure's
 *  `NonNullable<typeof historySig>` for the reason the module header gives: that
 *  spelling is a back-reference to a `let` in the same scope, and there is no scope
 *  shared across a file boundary to hold it. */
type HistorySignature = {
  undoLen: number;
  redoLen: number;
  undoTop: LogEntry | undefined;
  redoTop: LogEntry | undefined;
};

/** Build the history feed over one host's dependencies. One per host; it holds that
 *  host's history channel and its change signature for the host's lifetime. */
export function createHistoryFeed(deps: HistoryFeedDeps): HistoryFeed {
  // The named-history seam. Snapshot for the remount rule every other value-carrying
  // seam here obeys: a palette mounting after the world loaded must not render an
  // empty list beside a live undo stack. Re-read per subscribe (see
  // `view-channel.ts`), so a late arrival is pushed the history as it is then.
  const historyChannel = createViewChannel<[FieldHistory]>({
    snapshot: () => [
      fieldHistory(deps.substrate.log.undoStack, deps.substrate.log.redoStack),
    ],
  });
  // Null until the first push is recorded — by a notify that published, or by an
  // arrival that was handed the snapshot.
  let historySig: HistorySignature | null = null;

  // The NAMED history push (D-F4.5-11), and the guard that decides whether
  // there is anything to say.
  //
  // IDEMPOTENT BY DESIGN, and that is what makes its call sites cheap: it
  // compares a signature of the two entry stacks first and returns without
  // publishing when nothing moved. So calling it from a path that sometimes
  // mutates the log and sometimes does not costs a handful of reads, and a
  // future path can call it defensively without thinking about whether it needs
  // to. **Any new path that pushes to, pops from or clears either stack must
  // call this** — nothing in the type system enforces that, so it is written
  // here rather than assumed.
  //
  // The signature is (length, TOP ENTRY IDENTITY) per side, and the identity
  // term is load-bearing rather than defensive. Lengths alone are blind to the
  // commonest sequence in an editor: undo once, then do something new. The new
  // mutation clears the redo stack and pushes one entry, landing on exactly the
  // (undo, redo) lengths the history had before the undo — with a different
  // entry on top. A length-only guard would swallow that push and leave the menu
  // offering "Undo dig" over a log whose last act was a fill. Under LIFO those
  // two terms are also SUFFICIENT: entries only ever enter and leave at the top,
  // so a change below it implies one of them moved. (`redo` re-pushes the very
  // object it popped for splice/entity-update entries — which is correct, since
  // the resulting history really is the one already published.)
  //
  // No `worldEpoch` term, unlike `field-host.ts`'s `entityFootprints` memo. That
  // memo reads `log.ops`, which a world swap replaces wholesale while the numbers
  // agree; this reads ONLY the two stacks, and `resetWorld` empties both — so a
  // load that leaves them empty when they were already empty publishes nothing
  // because there is genuinely nothing new to publish.
  const historySignature = (): HistorySignature => {
    const log = deps.substrate.log;
    return {
      undoLen: log.undoStack.length,
      redoLen: log.redoStack.length,
      undoTop: log.undoStack.at(-1),
      redoTop: log.redoStack.at(-1),
    };
  };

  const notify = (): void => {
    // "Nobody is listening" is still the first question, and the answer still
    // leaves the signature alone: a mutation made with the palette unmounted
    // must not be recorded as published, or the next mount's own arrival would
    // be the only thing that ever said so.
    if (historyChannel.size() === 0) return;
    const prev = historySig;
    const sig = historySignature();
    if (
      prev !== null &&
      prev.undoLen === sig.undoLen &&
      prev.redoLen === sig.redoLen &&
      prev.undoTop === sig.undoTop &&
      prev.redoTop === sig.redoTop
    )
      return;
    historySig = sig;
    historyChannel.publish(
      fieldHistory(deps.substrate.log.undoStack, deps.substrate.log.redoStack),
    );
  };

  return {
    notify,
    subscribe: (cb) => {
      // The channel's own snapshot is the initial push, and it goes to the
      // ARRIVING subscriber alone — which is what this body has to record here
      // rather than CLEAR. Clearing the signature was how a single slot forced
      // an unconditional push for its one subscriber; with N of them it would
      // re-broadcast the current history to everybody on the next notify that
      // moved nothing. Recording it says something true of every live
      // subscriber instead: the arrival was just handed this history, and the
      // ones already here were pushed it (or an equal-signature one) when it
      // landed. Written BEFORE the subscribe so a callback that reads the host
      // back synchronously cannot provoke a duplicate of its own first push.
      historySig = historySignature();
      return historyChannel.subscribe(cb);
    },
  };
}
