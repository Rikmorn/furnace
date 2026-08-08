// The live stats readout (`FieldHost.subscribeStats`): the eleven-field payload
// the status bar reads, the multicast channel it rides, and the log-signature
// cache that keeps the op-cost half of it off the frame budget. The FOURTH
// cluster lifted out of `createFieldHost`, after `field-segment.ts`,
// `field-voidcast.ts` and `field-props.ts`.
//
// WHAT MAKES IT DIFFERENT FROM THE FIRST THREE is that there was no body to
// lift. Those clusters kept their work inside their own functions — six for the
// segment brush, five for the void cast, three for the prop layer — so each move
// was a relocation plus a wiring line. This one owned exactly ONE function, and
// that function is the CACHE (`currentLogStats`). The thing the cluster is FOR —
// assembling the payload and pushing it — lived in twenty lines inside `tick`,
// which is the `lifecycle` cluster's function, under a guard whose comment
// explains a cost `stats` pays and `lifecycle` does not.
//
// A cluster whose work lives in another cluster's function cannot be lifted as a
// bare deps record, because there is nothing to hand the record TO. So this
// module gains a verb the closure never had ({@link StatsMeter.publishIfWatched})
// and `tick` trades its twenty lines for one call. That is the shape worth
// naming for the extractions still to come: a METER the frame ASKS, not a region
// the frame reaches into.
//
// AND THE MAP UNDERSTATES IT, by a mechanism neither earlier correction names.
// `docs/reference/field-host-clusters.md` §6 gives `stats` two inbound read edges,
// both `log`. This module takes SEVEN reads. Four of the missing five ARE in the
// map — filed under `lifecycle`, because the map attributes a read to the cluster
// owning the ENCLOSING FUNCTION, and the enclosing function is `tick`: `store`,
// `lastRemeshMs`, `remeshVersion` and `voidCastJobGen` all sit in `lifecycle`'s
// 31-edge read list with `tick` as their site. The fifth,
// `analyzerPendingCount()`, is a CALL and so was never counted anywhere (§2.1's
// second correction). So the rule the first three extractions found — a row
// understates a cluster by its calls — has a sibling: **a row MISFILES a
// cluster's reads whenever its work lives in someone else's function**, and no
// amount of grepping the `stats` row surfaces them. Corrected at the row.
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument):
//
//   - `store` and `log` are `const` in the host and were ALREADY declared in
//     `HostSubstrate`, so they ride BY VALUE inside the record. Both are read as
//     containers only (`store.chunks.size`, the log's three lengths); neither is
//     ever replaced, which is why a held reference cannot fork. This module is
//     the substrate's third consumer and, like the second, needed no new member.
//   - `lastRemeshMs` and `remeshVersion` were host `let`s when this module left
//     and are `field-world.ts`'s own state since foundations T3d Task 6 — `world`'s
//     throughout, both bumped by the remesh-completion path. This is still the
//     only extracted reader of either, so they ride as SINGLE-CONSUMER THUNKS on
//     the record below rather than widening the substrate; what changed is that
//     the thunks now reach a module SEAM rather than a closure binding, and reach
//     DOWN (`createWorld` is assembled below `createStatsMeter`), which is the
//     second of THE LAW's two teeth. Same CALL, different owner: the bar for
//     adding a `HostSubstrate` member is two extracted readers, and that bar
//     governs ADDING one, never declining one already declared.
//   - `analyzerPendingCount` and `voidCastJobGen` are verbs of OTHER EXTRACTED
//     MODULES — `field-analyzer.ts`'s `pendingCount` (since foundations T3d,
//     2026-08-07; it was a closure `const` when this module left) and
//     `field-voidcast.ts`'s `jobGen`, the first dep in this tranche that named
//     another module rather than a host binding. Both are members of `const`
//     module records the host never reassigns, so the bindings pass safely by
//     reference. What they read behind those bindings is evaluated per call,
//     which is exactly what keeps a `let` honest: `pendingCount` reaches FOUR
//     module-private `let`s (`agentProfile`, `analyzerResync`, `analyzerBusy`, and
//     `analyzerWholeWorld` via `analyzerHasWork`) plus the `analyzerDirty` Set and
//     `store.chunks`, both `const` containers; `jobGen` reaches one
//     module-private generation.
//   - `lastReconfigureMs` is no longer a host binding at all: it moved IN. The
//     map's one inbound MUTATION edge for this cluster (`stamp`'s
//     `applyReconfigureSession`) is now a named call,
//     {@link StatsMeter.noteReconfigureMs}, on `field-segment.ts`'s
//     `armMaskDropReport` precedent — a write that crossed the boundary as a bare
//     assignment would be a number this module could never see move.
//
// ONE BEHAVIOURAL CHANGE WAS TAKEN, deliberately, and it is the only one.
// `currentLogStats()` now runs INSIDE the subscriber guard; the closure ran it
// one line ABOVE the guard, unconditionally, every frame, and used its result
// only inside the payload. The guard's own comment already described the
// stricter shape ("the payload must not be built for nobody… a bare publish
// would allocate an eleven-field record and poll the analyzer once per rAF on
// every host nobody is watching"), so this makes the code do what the comment
// says rather than changing what it means to do.
//
// What it BUYS: on an unwatched host, `field.logStats(log)` — an O(ops) scan with
// two `flatMap` allocations, run per rAF — no longer runs at all. That is every
// headless test that drives the loop WITHOUT subscribing (four editor suites do
// subscribe and are therefore watched), and any host between the chrome's
// teardown and the next mount.
//
// What it COSTS, stated precisely because the obvious statement of it is wrong.
// The cache has ONE documented aliasing gap: the signature is the log's three
// lengths, so a sequence of mutations that nets all three back to their values
// at the last COMPUTE is invisible to it. Note *compute*, not *check* — the
// trackers advance only inside the recompute branch, which is exactly what makes
// skipping calls safe, and also means nothing re-signs on a match. So an alias,
// once entered, is carried by EVERY later payload until a length genuinely
// differs. That is not a new cost: it is equally true of the one-frame window
// this replaces, because a recompute on a matched signature is a no-op there
// too. **What (B) widens is the PROBABILITY of entering the stale state — the
// netting must land within one frame under the old shape, within the unwatched
// span under this one — not its duration.**
//
// And the blast radius is two fields. `totalOps`, `undoDepth` and `redoDepth`
// ARE the three signature lengths (core's `field/maintenance.ts` reads them
// straight off the log), so a matched signature makes them correct by
// construction; only `liveGenerators` and `compactableOps` are content-derived
// and can therefore be stale. The other six payload fields never touch the cache
// and are read fresh per publish.
//
// In production the exposure is close to nil — but the reason is EMERGENT, not
// designed, and the first version of this note named a mechanism that no longer
// exists. It said the chrome subscribes in a PROVIDER-level effect keyed
// `[engineReady, host]`; T3b1 Task 7 replaced that fan-out with per-consumer
// `useSyncExternalStore` latches three commits later, in this same slice. What
// is true at HEAD: THREE surfaces read stats — `shell/StatusBar.tsx`,
// `hooks/useActionContext.tsx` and `hooks/useWorld.tsx` — and the last two are
// session-lifetime providers mounted at the shell root (`shell/Shell.tsx`). So
// an unwatched production host still exists only before `engineReady` and after
// chrome teardown, and neither is a span in which the user mutates the log.
// BUT that now rests on two unrelated providers happening to destructure
// `stats`: if either stops, the unwatched span becomes a real editing window and
// nothing here would notice. The op-cost meter is advisory besides (a hint
// meter, in the cache's own words), and the fix for the whole family is already
// filed: `docs/backlog/editor-and-tooling/field-tool-follow-ons.md`
// §*Log-signature caches can miss a world swap*.
//
// No published payload changes outside that window. `field.logStats` is a pure
// query (core's `field/maintenance.ts` says so in its TSDoc), `currentLogStats`
// had exactly one call site, and the four cache bindings are read nowhere but
// inside it — so a skipped call has no effect a later call can observe.
import * as field from "@furnace/core/field";
// TYPE-ONLY, so it is erased and there is no import cycle at runtime. The payload
// type stays with the rest of the host's public surface because its own TSDoc
// links into `FieldHost`, and a type that named its consumer from across the
// directory would be a link this side could not resolve. `field-segment.ts`'s
// `SegmentHud` set the precedent.
import type { FieldStats } from "./field-host.ts";
import type { HostSubstrate } from "./substrate.ts";
import { createViewChannel, type ViewChannel } from "./view-channel.ts";

/** What the stats meter needs from the rest of the host.
 *
 *  The four entries beside the substrate are the payload's FOREIGN reads, and
 *  they are the reason this cluster could not travel as a record of values: every
 *  one of them is a number that moves between frames, so a copy taken at assembly
 *  would pin the readout to the moment the host was built. Two name host `let`s
 *  and two name `const` bindings; all four are CALLS, because what a payload
 *  field must show is what the fact IS at publish time. */
export type StatsMeterDeps = {
  /** The host's shared state. Two members are read, both on the value side:
   *  `store` (for `chunks`, the payload's allocated-chunk count) and `log` (the
   *  three lengths the cache signs on, and the log `field.logStats` scans). */
  substrate: HostSubstrate;
  /** Wall-clock of the last landed chunk remesh, ms. `field-world.ts`'s, written
   *  by the remesh-completion path once per chunk. */
  lastRemeshMs(): number;
  /** The monotonic remesh counter — see {@link FieldStats}'s TSDoc for why a
   *  counter rides beside the clock read it duplicates (Safari clamps
   *  `performance.now()` to ~1 ms, so two consecutive remeshes can quantize
   *  identically). `field-world.ts`'s, bumped beside `lastRemeshMs`. */
  remeshVersion(): number;
  /** The generation of the void-cast job the worker is still computing, or `null`
   *  when it is idle — `field-voidcast.ts`'s `jobGen`. The payload carries the
   *  BOOLEAN (`!== null`), and the derivation lives here beside the field it
   *  feeds rather than at the wiring, so there is one spelling of what "pending"
   *  means. */
  voidCastJobGen(): number | null;
  /** Walkability-advisor passes the host still owes an answer for (0–2) —
   *  `field-analyzer.ts`'s `pendingCount`. A verb over four of that module's own
   *  `let`s (`agentProfile`, `analyzerResync`, `analyzerBusy`, and
   *  `analyzerWholeWorld` through `analyzerHasWork`) plus two `const` containers
   *  (`analyzerDirty`, `store.chunks`), so the binding is safe to hold and all six
   *  are read per call. The one dep that is a pure QUERY rather than a state
   *  read — which is why the map, whose edges are over data bindings, never
   *  counted it. */
  analyzerPendingCount(): number;
};

/** The meter's two verbs and the seam the facade delegates to.
 *
 *  No state is exposed and none is shared: unlike the first three extractions,
 *  this cluster left nothing behind in the substrate, because nothing outside it
 *  ever read its state directly — `tick` read the channel and the reconfigure
 *  timing, and both of those are now calls.
 *
 *  It also carried a QUERY, `currentLogStats`, until foundations T3b2. T3b1 put
 *  it here as "a deletion candidate if no second reader appears" — none did, so
 *  it is module-private again. The cache and its signature are unchanged;
 *  {@link StatsMeter.publishIfWatched} was already its only caller repo-wide,
 *  and is now its only possible one. */
export type StatsMeter = {
  /** Record how long a LANDED `applyReconfigure` took (ms).
   *
   *  THE cluster's one boundary mutation, and a call rather than a shared `let`
   *  for `field-segment.ts`'s `armMaskDropReport` reason: `stamp` owns when a
   *  reconfigure lands, this module owns what the readout says, and a number
   *  handed across as a value would leave the two halves describing different
   *  reconfigures. A rejected reconfigure does not reach here — see the caller. */
  noteReconfigureMs(ms: number): void;
  /** Assemble and push the readout, IFF someone is watching.
   *
   *  The frame's whole involvement with this cluster. The guard is not an
   *  optimisation bolted on: it is the reason the payload is built here at all
   *  rather than by a channel snapshot, and the module header states what moving
   *  the log scan inside it costs and buys. */
  publishIfWatched(): void;
  /** The readout seam behind `FieldHost.subscribeStats`. No snapshot — see the
   *  channel's construction for why a subscriber's first push is the next
   *  frame's. */
  subscribe: ViewChannel<[FieldStats]>["subscribe"];
};

/** Build the stats meter over one host's dependencies. One per host; it holds
 *  that host's readout channel, its reconfigure timing and its log cache for the
 *  host's lifetime. */
export function createStatsMeter(deps: StatsMeterDeps): StatsMeter {
  // No snapshot: the readout is pushed every rAF, so the longest a subscriber
  // waits for its first one is a frame — and building an idle one at subscribe
  // would be the only place this payload is assembled off the tick.
  const statsChannel = createViewChannel<[FieldStats]>();

  // Last LANDED applyReconfigure wall-clock (ms); 0 until the first one lands.
  let lastReconfigureMs = 0;

  // logStats cache: recomputing it every rAF is an O(ops) scan that allocates
  // per frame, but the readout only moves when the LOG does. The signature is
  // the three lengths logStats reads structurally (ops + both undo stacks) —
  // every log mutation (a stroke, a commit/reconfigure, freeze/bake, ⌘Z/⇧⌘Z, a
  // load-time compaction) moves at least one of them, so a matched signature
  // proves the numbers are unchanged. The one gap it tolerates — several
  // mutations that net all three lengths back (undo, then a fresh op) — is
  // unreachable from single-event-per-frame input and self-heals on the next
  // mutation; a hint meter can carry that. Trackers start at -1 to force the
  // first read to compute.
  //
  // The gap's WINDOW is now the span since the last watched tick rather than one
  // frame, because the publish guard skips the recompute too — the module header
  // states why that trade was taken and what it is bounded by.
  let cachedLogStats: field.LogStats = field.logStats(deps.substrate.log);
  let statsOpsLen = -1;
  let statsUndoLen = -1;
  let statsRedoLen = -1;

  // logStats, recomputed only when the log signature moved (see the cache
  // decls) — called once per WATCHED tick to feed the op-cost meter without a
  // per-frame full-log scan.
  const currentLogStats = (): field.LogStats => {
    const log = deps.substrate.log;
    if (
      log.ops.length !== statsOpsLen ||
      log.undoStack.length !== statsUndoLen ||
      log.redoStack.length !== statsRedoLen
    ) {
      cachedLogStats = field.logStats(log);
      statsOpsLen = log.ops.length;
      statsUndoLen = log.undoStack.length;
      statsRedoLen = log.redoStack.length;
    }
    return cachedLogStats;
  };

  const publishIfWatched = (): void => {
    // Guarded on the count rather than published unconditionally: this is the
    // ONE per-frame publish, and `statsCb?.({…})` never built the payload
    // with the slot empty (an optional call does not evaluate its arguments).
    // A bare `publish` would allocate an eleven-field record and poll the
    // analyzer once per rAF on every host nobody is watching — which is every
    // headless test that runs the loop WITHOUT subscribing. (The original
    // comment said "every headless test"; four editor suites do subscribe and
    // are watched, so the qualifier is load-bearing.)
    if (statsChannel.size() === 0) return;
    const ls = currentLogStats();
    statsChannel.publish({
      chunks: deps.substrate.store.chunks.size,
      lastRemeshMs: deps.lastRemeshMs(),
      remeshVersion: deps.remeshVersion(),
      totalOps: ls.totalOps,
      liveGenerators: ls.liveGenerators,
      compactableOps: ls.compactableOps,
      undoDepth: ls.undoDepth,
      redoDepth: ls.redoDepth,
      lastReconfigureMs,
      analyzerPending: deps.analyzerPendingCount(),
      voidCastPending: deps.voidCastJobGen() !== null,
    });
  };

  return {
    noteReconfigureMs: (ms) => {
      lastReconfigureMs = ms;
    },
    publishIfWatched,
    subscribe: (cb) => statsChannel.subscribe(cb),
  };
}
