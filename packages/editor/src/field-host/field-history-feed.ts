// The named-history FEED (`FieldHost.subscribeHistory`): the multicast channel the
// History palette and the Undo menu ride, the change signature that decides whether
// a republish would say anything new, and the two verbs on either side of it. The
// FIFTH cluster lifted out of `createFieldHost`, after `field-segment.ts`,
// `field-voidcast.ts`, `field-props.ts` and `field-stats.ts`.
//
// THE PAYLOAD GAINED A THIRD KIND OF READER AT FOUNDATIONS T4b, and it did not gain
// a verb. `FieldHistory.revision` is an opaque change token for the agent
// backchannel — a caller with no render at all, asking whether anything has happened
// since it last looked. It is composed HERE because the numbers it is made of are the
// numbers the change guard already signs on, and a second module composing them would
// be a second answer to one question. It travels IN the published payload rather than
// on a seam of its own, which is the whole of what makes it honest: see
// {@link FieldHistory.revision} and `revisionOf` below.
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
// AND `stepHistory` DID NOT COME, though it wears the name — and at T3d Task 5 it
// was DECLARED facade-resident rather than left unclaimed. It calls into FIVE
// clusters — `markDirtyWithNeighbors` (`world`), `cancelSession` (`stamp`, now
// `field-machine.ts`'s), `revalidate` AND `notify` (`entities`, now
// `field-entities.ts`'s), `props.rebuild()` (the extracted prop layer) and
// `drift.set`/`drift.notify` (`field-drift.ts`') — and reads `store`, `log` and
// `table` besides, plus `drift.standing()`. It is a lifecycle verb wearing a
// history name: what it owns is "everything a step can move", of which the history
// push is the smallest part. It does not even NAME this module — the push reaches
// here through the entity tick, which carries it by that seam's own contract — so
// `stepHistory` needed no edit in the 2026-08-06 move and none at Task 5 beyond
// two re-pointed calls.
//
// THE TASK-5 VERDICT, because the alternative was live by then: with all five of
// those clusters extracted, "it belongs to none of it" could have been read as
// "so move it anywhere". Taking it HERE would give this record — `{ substrate }`,
// the shortest in the tranche — six verbs of other modules' business, and make the
// thing that publishes a history signature also the thing that cancels sessions
// and rebuilds the prop layer. Its three callers are all facade-resident and
// cannot move (`onKeyDown`'s ⌘Z branch owns the canvas element; the two public
// methods are the facade). The argument in full is at its declaration in
// `field-host.ts`.
//
// Only `commitToolOp`, the one log-mutating path that rewrites no entity record,
// calls the feed directly — from `field-tool.ts` since 2026-08-08, through a
// `notifyHistory` arrow in that module's deps record, because `createTool` is
// assembled ~460 lines above `createHistoryFeed`.
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument): there is
// exactly ONE foreign read, `log`, and it was ALREADY declared in `HostSubstrate`,
// so it rides BY VALUE inside the record. It is a `const` in the host that every
// push, pop and clear mutates THROUGH — core's verbs write into the two stacks
// rather than replacing the log — which is why a held reference cannot fork.
//
// IT WAS THE ONLY MEMBER UNTIL FOUNDATIONS T4b, and the record's own docblock
// had already said what a second one would look like when it came — an added
// FIELD rather than a changed signature, which is why the record was kept as a
// record at all. That day is the revision token, which needs the world generation
// beside the two stacks, and `worldEpoch` is the added field. It is a THUNK for
// the reason `field-entities.ts` and `field-analyzer.ts` both give for the same
// counter: `createWorld` is assembled below `createHistoryFeed`, so a value would
// not merely fork — it would be a TDZ read.
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
 *  It was the shortest record in the tranche at ONE member — everything the cluster
 *  read was the op log, and the op log is a `HostSubstrate` value member already —
 *  and it was kept as a RECORD rather than collapsed to a bare `HostSubstrate`
 *  parameter so the five factories in this directory read the same way, and so a
 *  second dependency would be an added field rather than a changed signature. T4b
 *  is the day, and {@link HistoryFeedDeps.worldEpoch} is the added field: the
 *  prediction held, and the signature did not move. */
export type HistoryFeedDeps = {
  /** The host's shared state. ONE member is read, on the value side: `log`, for the
   *  two entry stacks that the payload and the change signature are both derived
   *  from — and, since T4b, for the two log-wide numbers `revisionOf` composes beside
   *  them. Nothing here reads a `let`, so nothing here is a call. */
  substrate: HostSubstrate;
  /** The world generation counter, bumped by `world.reset()` — `field-world.ts`'s
   *  `epoch`, the same one `field-entities.ts` and `field-analyzer.ts` take.
   *
   *  READ BY THE REVISION TOKEN, which is the whole of why this record grew: a token
   *  an outside caller compares across time must survive a world swap that leaves
   *  every log number where it found them, and the change guard had no epoch term
   *  until the token joined the payload it guards.
   *
   *  A CALL, for `field-entities.ts`' reason exactly: `createWorld` is assembled
   *  below `createHistoryFeed` in `field-host.ts`, so a value here would be a TDZ
   *  read at assembly and a frozen number afterwards. */
  worldEpoch(): number;
};

/** The feed's one verb and the seam the facade delegates to.
 *
 *  No state is exposed. Like `field-stats.ts` — and unlike the first three
 *  extractions — this cluster left nothing behind in the substrate, because nothing
 *  outside it ever read its state directly: the channel had two readers and both of
 *  them are now these two members. T4b's change token did NOT add a third: it rides
 *  the payload the channel already publishes, so the signature the guard compares
 *  still never leaves this file. */
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

/** Everything the change guard compares: the world generation, two log-wide numbers,
 *  and a length plus a top-entry identity per stack.
 *
 *  Module-private, because nothing outside asks what a signature IS — only whether the
 *  history moved. **T4b did not reopen that**, and it is worth saying because the
 *  serialized half of this record now leaves the module: `revisionOf` projects five of
 *  the seven terms into an opaque STRING that rides the payload, so a reader still
 *  cannot ask what a signature is, and the only question it can answer is the one this
 *  privacy was reserving. Exposing the RECORD would have violated it — and could not
 *  have travelled anyway, two of its terms being `LogEntry` object references.
 *
 *  It is a NAMED type rather than the closure's `NonNullable<typeof historySig>` for the
 *  reason the module header gives: that spelling is a back-reference to a `let` in the
 *  same scope, and there is no scope shared across a file boundary to hold it. */
type HistorySignature = {
  epoch: number;
  opsLen: number;
  nextId: number;
  undoLen: number;
  redoLen: number;
  undoTop: LogEntry | undefined;
  redoTop: LogEntry | undefined;
};

/** Build the history feed over one host's dependencies. One per host; it holds that
 *  host's history channel and its change signature for the host's lifetime. */
export function createHistoryFeed(deps: HistoryFeedDeps): HistoryFeed {
  // DECLARED BEFORE THE CHANNEL, unlike every other extraction in this directory,
  // because the channel's own `snapshot` thunk now calls both of these: an
  // arrival's payload carries a token, and the token is composed from a signature.
  // Function order would make that a TDZ question to re-derive at every read;
  // declaration order makes it not a question.
  //
  // WHAT THE CHANGE GUARD COMPARES, and every term's reason.
  //
  // The original four are (length, TOP ENTRY IDENTITY) per side, and the identity
  // term is load-bearing rather than defensive. Lengths alone are blind to the
  // commonest sequence in an editor: undo once, then do something new. The new
  // mutation clears the redo stack and pushes one entry, landing on exactly the
  // (undo, redo) lengths the history had before the undo — with a different
  // entry on top. A length-only guard would swallow that push and leave the menu
  // offering "Undo dig" over a log whose last act was a fill. Under LIFO those
  // two terms are also SUFFICIENT for the STACKS: entries only ever enter and
  // leave at the top, so a change below it implies one of them moved. (`redo`
  // re-pushes the very object it popped for splice/entity-update entries — which
  // is correct, since the resulting history really is the one already published.)
  //
  // AND THREE MORE SINCE T4b — `worldEpoch`, `log.ops.length` and
  // `log.nextId` — which arrived for one reason: the PAYLOAD grew the revision
  // token, so "would a republish say anything new" grew with it.
  //
  // Until then this guard read ONLY the two stacks, and declining the epoch was
  // right: `resetWorld` empties both, so a load that left them empty when they
  // were already empty published nothing because there was genuinely nothing new
  // to SAY. That stopped being true the moment the payload carried a token
  // composed from the epoch. Measured before the change: over a fresh host,
  // `newWorld()` and then a whole `loadWorld` left the subscriber on its single
  // arrival push while the token moved twice (`0/0/0/0/1` → `1/0/0/0/1` →
  // `2/56/0/0/57`) — so a payload-carried token under the old guard would have let
  // an agent read a world, watch the human open a DIFFERENT one, and be told
  // nothing had happened. The two questions this comment used to hold apart
  // merged when one payload started answering both.
  //
  // What it costs is one extra publish per world swap that leaves the history
  // empty — the palette re-renders its (identical, empty) list once, on a rare
  // user-initiated act. What the guard was built to suppress is untouched: an
  // entity tick that moves no history moves none of the seven terms.
  const historySignature = (): HistorySignature => {
    const log = deps.substrate.log;
    return {
      epoch: deps.worldEpoch(),
      opsLen: log.ops.length,
      nextId: log.nextId,
      undoLen: log.undoStack.length,
      redoLen: log.redoStack.length,
      undoTop: log.undoStack.at(-1),
      redoTop: log.redoStack.at(-1),
    };
  };

  /**
   * The signature's SERIALIZABLE projection — the opaque change token that rides the
   * payload as {@link FieldHistory.revision}. **Compare it, never read it.**
   *
   * WHAT IT IS FOR: an agent reading this session over the backchannel carries the last
   * token it saw and asks "is my picture stale?" (`shared/wire.ts`'s
   * `SessionState.cursor`). It is a change HINT and nothing else — the agent RE-READS the
   * state; it must never diff two tokens and conclude something about WHAT changed,
   * because the token carries no such thing.
   *
   * **IT RIDES THE PAYLOAD RATHER THAN A SEAM OF ITS OWN, and that is the whole of what
   * makes it honest.** The first cut of this exposed `HistoryFeed.revision()` and the
   * chrome polled it at answer time. Everything else in that answer is LATCHED at the last
   * React commit, so the poll ran one-directionally AHEAD of it: an ask landing between a
   * log mutation (synchronous, inside a pointer handler) and the commit that re-latches the
   * mirrors would answer with a post-edit token over a pre-edit picture. A reader caches
   * both; every later ask returns that same token; "nothing has changed" then stays true
   * for ever over a world one edit old. Composed into the published payload — from the SAME
   * signature object the publish was decided by — the token and the labels beside it cannot
   * describe different moments. What that does and does not certify is stated at
   * `SessionState.cursor`, because the payload's other members ride other latches.
   *
   * FIVE OF THE SEVEN TERMS, in `field-entities.ts`' footprint-memo spelling — the SECOND
   * occurrence of one composition rather than a second composition (the third is the one
   * that should extract a shared helper). The two it drops are the top-entry IDENTITIES,
   * which are `LogEntry` object references: the right terms for a guard comparing
   * in-process, and nothing identifying to serialize for a reader across a wire. Each
   * surviving term earns itself:
   *
   *   - `epoch` because a world swap clears the log, so two worlds agreeing on all four
   *     log numbers would otherwise share a token. `newWorld` over an already-empty world
   *     is the sharpest case: every other term is identical before and after.
   *   - the two stack LENGTHS, because an undo or a redo moves them and nothing about the
   *     world. BOTH of them, in fact — an undo pops one stack and pushes the other — and an
   *     earlier version of this line said "one of them and nothing else", which was wrong
   *     twice: for an `ops` entry an undo also PEELS `log.ops`, which is the very mechanism
   *     the next bullet turns on.
   *   - **`nextId` AND `opsLen` TOGETHER, as the serializable stand-in for the dropped
   *     identity terms.** Neither alone is that stand-in, and saying so of `nextId` was this
   *     docblock's own error for one commit. What replaces an identity has to cover both
   *     shapes of "undo once, then do something new", and each of these covers one:
   *
   *     `nextId` covers a new OP — the lengths land back where they were and the fresh op
   *     took an id. The commonest sequence in an editor, and the one the guard's identity
   *     terms were added for.
   *
   *     `opsLen` covers a new ENTITY-UPDATE (freeze or bake), which mints no op at all.
   *     Measured against a real host: commit a hall, duplicate it (`1/112/1/0/113`), ⌘Z,
   *     then freeze the original (`1/56/1/0/113`). The undo PEELED `log.ops` (`ops.ts`: an
   *     `ops` entry undoes by `log.ops.length -= entry.ops.length`) and the entity-update
   *     refilled the undo stack without putting anything back, so the epoch, both stack
   *     lengths and `nextId` are identical across two worlds that differ by a whole entity
   *     — and `opsLen` is the only term separating them. Ordinary editing, not a corner,
   *     and precisely the false-*unchanged* this token's error asymmetry is about. Pinned in
   *     `tests/field-host-history.test.ts`. (`compactRuns` can also move `opsLen` alone,
   *     when every fold it plans netted nothing; the editor compacts only inside a load,
   *     whose `resetWorld` has already bumped the epoch, so that is a second reason for the
   *     term rather than the reason.)
   *
   * **WHAT IT CAN MISS, in the terms `field-stats.ts` states for its own cache.** That
   * module's log-signature cache has the same family of gap, and its conclusion is worth
   * quoting rather than paraphrasing: *"an alias, once entered, is carried by EVERY later
   * payload until a length genuinely differs"*, because *"the trackers advance only inside
   * the recompute branch … nothing re-signs on a match"*. **That half does not transfer.**
   * There is no tracker here: the token is composed from a signature read fresh at every
   * publish, so it can ALIAS — two different states composing the same five numbers — but
   * it cannot LATCH, and the next mutation that moves any term ends the alias.
   *
   * The alias that is actually reachable is the one no term covers: an `entity-update`
   * entry creates no op and touches no length that another entry did not. Freeze an entity,
   * ⌘Z, then BAKE it: undo depth 1, redo depth 0, same op count, same `nextId` — the same
   * token, over a world where a different thing is now true. An agent that treated this as
   * a CORRECTNESS signal would carry "that entity is frozen" past the point where it became
   * "that entity is baked". Closing it would mean composing a per-entry discriminator out
   * of `LogEntry`'s three arms, which is `field-history.ts`'s business (it is the module
   * that reads entry internals, to label them) and would make this the third reader of that
   * union, for a gap that self-heals on the next stroke. Not taken; pinned instead, so it
   * cannot be forgotten.
   *
   * **AND IT ANSWERS ABOUT THE FIELD ONLY.** Selection, camera pose, the armed tool, the
   * gesture and a live stamp session are all things a reader can see move, and none is in
   * here. Deliberate rather than an omission: the camera alone publishes at pointer rate,
   * so a token that tracked it would say "stale" on every read and be worth nothing as a
   * hint. An unchanged token means *"no edit landed and no world was swapped"*, which is a
   * smaller sentence than "your copy is current" and is the only one this can honestly say.
   */
  const revisionOf = (sig: HistorySignature): string =>
    `${sig.epoch}/${sig.opsLen}/${sig.undoLen}/${sig.redoLen}/${sig.nextId}`;

  // The named-history seam. Snapshot for the remount rule every other value-carrying
  // seam here obeys: a palette mounting after the world loaded must not render an
  // empty list beside a live undo stack. Re-read per subscribe (see
  // `view-channel.ts`), so a late arrival is pushed the history as it is then.
  const historyChannel = createViewChannel<[FieldHistory]>({
    snapshot: () => [
      fieldHistory(
        deps.substrate.log.undoStack,
        deps.substrate.log.redoStack,
        // Composed from a signature taken HERE, so an arrival's token and its labels
        // describe the arrival's own moment — the same coherence `notify` gets by
        // publishing `revisionOf(sig)`. `subscribe` records that signature one line
        // later, which is what keeps the arrival from provoking a duplicate push.
        revisionOf(historySignature()),
      ),
    ],
  });
  // Null until the first push is recorded — by a notify that published, or by an
  // arrival that was handed the snapshot.
  let historySig: HistorySignature | null = null;

  // The NAMED history push (D-F4.5-11), and the guard that decides whether
  // there is anything to say.
  //
  // IDEMPOTENT BY DESIGN, and that is what makes its call sites cheap: it
  // compares the change signature first (declared above, with every term's
  // reason) and returns without publishing when nothing moved. So calling it from a path that sometimes
  // mutates the log and sometimes does not costs a handful of reads, and a
  // future path can call it defensively without thinking about whether it needs
  // to. **Any new path that pushes to, pops from or clears either stack must
  // call this** — nothing in the type system enforces that, so it is written
  // here rather than assumed.
  //

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
      prev.epoch === sig.epoch &&
      prev.opsLen === sig.opsLen &&
      prev.nextId === sig.nextId &&
      prev.undoLen === sig.undoLen &&
      prev.redoLen === sig.redoLen &&
      prev.undoTop === sig.undoTop &&
      prev.redoTop === sig.redoTop
    )
      return;
    historySig = sig;
    // The token is derived from the SAME signature object this publish was decided
    // by, not re-read from the log. That is what makes "this token and these labels
    // describe one moment" structural rather than a race — a second read could not
    // interleave with anything today, and being unable to is worth more than being
    // unlikely to.
    historyChannel.publish(
      fieldHistory(
        deps.substrate.log.undoStack,
        deps.substrate.log.redoStack,
        revisionOf(sig),
      ),
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
