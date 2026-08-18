---
summary: The browser-side engine facade — the multicast view channel, the substrate record every extracted cluster is handed, and the deps-record law that keeps the seam modules assemblable.
verified: 2026-08-18
---

# The field host

`packages/editor/src/field-host/` is the editor's whole engine-facing half: the WebGPU canvas,
the field store and op log, the tools, and the seams every chrome surface reads. The daemon owns
bytes and the filesystem; **this directory owns the world** ([overview](overview.md)).

`field-host.ts` is the facade. Everything else in the directory is either a seam module it
assembles, a framework primitive, a worker protocol pair, or a pure function library.

## The directory, counted from the artifact

The roster is **derived, never listed** — a hardcoded inventory is precisely what the
twenty-second module escapes.

```sh
ls packages/editor/src/field-host/ | wc -l                                       # every file
grep -lE "^export (type|interface) [A-Za-z]*Deps" packages/editor/src/field-host/*.ts   # the seam modules
wc -l packages/editor/src/field-host/field-host.ts                               # the facade
```

A module is a **seam** exactly when it declares its own `export type|interface *Deps`. Every
other file falls into one of four buckets, and the buckets partition the directory with nothing
left over:

| Bucket | Members |
| --- | --- |
| the facade | `field-host.ts` |
| framework primitives (not clusters) | `substrate.ts`, `input-router.ts`, `view-channel.ts` |
| the barrel | `index.ts` |
| worker protocol pairs | `field-protocol.ts` / `field-client.ts`, `analyzer-protocol.ts` / `analyzer-client.ts` |
| pure modules — no state, no deps record | `box-edges`, `camera-control`, `field-camera`, `field-flags`, `field-ghost`, `field-history`, `field-move`, `field-pick`, `field-placements`, `field-selection-cells`, `field-size`, `field-stamp`, `gizmo`, `input-map`, `reference-grid`, `viewport-cursor` |

**The partition is checked, not asserted.**
`packages/editor/tests/field-host-boundaries.test.ts` DERIVES the seam roster at runtime from
that same `*Deps` predicate and pins four properties: the roster is non-vacuous (a floor case,
because the other cases pass vacuously over an empty set — that is what catches a broken
classifier); the facade assembles every seam module and nothing else assembles any; no seam
module VALUE-imports a peer; and nothing value-imports the facade but the barrel. The one
standing value edge between seams is asserted as an exact set rather than hidden —
`field-capture.ts → field-camera-rig.ts { EDITOR_PROJECTION }`.

**Two shape rules the roster makes visible.** Deps width is fan-**IN** and seam width is
fan-**OUT**, and neither predicts the other: the widest deps record in the directory has the
narrowest seam. And a wide deps record is safe exactly when every entry is a READ — the
counterexample is the module whose record is wide *because* it mutates across a dozen edges,
where most entries are VERBS it calls on someone else.

## The view channel — one multicast seam, N subscribers each

`view-channel.ts` is the push seam behind every `FieldHost.subscribe*` member, and the
push-direction sibling of the chrome's notify store. It is framework-free for the same reason:
subscribe returns an unsubscribe and nothing more, so who hears a publish, what a late mount
sees, and what a throwing subscriber costs its siblings are all decided in one place a bare test
drives without a DOM or a React tree.

The facade carries **thirteen** `subscribe*` members, every one a bare delegate onto a seam
module's channel. Derive:

```sh
awk '/^export (type|interface) FieldHost/,/^};/' packages/editor/src/field-host/field-host.ts \
  | grep -cE '^\s{2}subscribe[A-Za-z]+\('
```

### Snapshot on subscribe

**Eleven of the thirteen push the current value on subscribe** — the (re)mount rule: a surface
that mounts mid-state must not render empty beside an overlay already showing that state. The
snapshot is a closure re-read **per subscribe**, not captured once, so a late mount is pushed the
state as it is then.

**Exactly two have none, because their payload is an EVENT rather than a state:**
`subscribeToolError` (re-pushing the last refusal to a remounting toast stack would resurrect one
the user dismissed) and `subscribeStats` (pushed every rAF, so the longest a subscriber waits is
a frame, and a snapshot would be the only place that payload was assembled off the tick).

### Three observable properties, and only three

1. **Slot-steal is dead.** A second subscriber no longer disconnects the first.
2. **A throwing subscriber no longer severs its siblings.** Delivery is isolated per-subscriber:
   an exception is `console.error`ed and the pass continues, and `publish` itself never throws.
   This is safe precisely because notifications go LAST — host state is already committed when
   they fire (the field-host ordering rule), so isolation cannot leave the host half-written.
   Subscriber exceptions are programmer errors, not user-facing refusals; `subscribeToolError` is
   the seam for those, and a surface's bug must not silence the surface behind it.
3. **A callback that throws on its INITIAL push still gets a working unsubscribe** — the
   corollary of (2), and the easiest to miss. Under a single slot that throw propagated out of
   `subscribe`, which therefore never returned, leaving the caller a live registration it could
   not remove.

### Two implementation rules that are load-bearing

**`publish` iterates a COPY of the membership.** A subscriber is free to (un)subscribe from
inside its own delivery — a React commit provoked by one push can tear down the surface holding
another — and a live `Set` mutated mid-iteration would let one subscriber's bookkeeping decide
whether its siblings hear this pass. Someone removed mid-pass is still delivered to; someone
added mid-pass waits for the next one.

**`snapshot()` runs OUTSIDE the per-subscriber try/catch.** Reading the host's own state is not
the subscriber's code, so a snapshot provider that throws is a host bug that must surface at the
mount that provoked it rather than be papered over with a subscriber that silently never got its
first push.

**A pushed value is cloned once per publish and SHARED by every subscriber.** It is immutable by
contract — with N readers a mutation by one would be visible to the others.

`size()` is the leak-detection seam, and it exists because the failure mode inverted: the
single-slot era failed LOUDLY when a subscription leaked (the second subscriber displaced the
first and something visibly stopped updating), whereas a `Set` just grows. A count that only
climbs across mount/unmount cycles is a missing cleanup.

### The stats meter asks rather than assembles

The frame ASKS the meter (`publishIfWatched()`) rather than assembling the readout inside
`tick`, and the payload's op-cost scan sits INSIDE the "is anyone subscribed" guard. An unwatched
host therefore runs no O(ops) log scan per rAF.

**What that costs is narrower than it sounds.** The log-signature cache signs on the log's three
lengths and nothing re-signs on a MATCH, so an alias, once entered, is carried by every later
payload until a length genuinely differs — a duration identical to the shape it replaces. What
moved is the PROBABILITY of entering the stale state, not how long it lasts. The blast radius is
**two fields**: `totalOps`, `undoDepth` and `redoDepth` ARE the three signature lengths, so a
matched signature makes them correct by construction, leaving only `liveGenerators` and
`compactableOps` exposed; the other payload fields never touch the cache.

In production the unwatched span is still effectively empty of editing, but that is now an
EMERGENT property rather than a designed one. Three chrome surfaces read stats — the status bar,
the action-context provider and the world hook — and the last two are session-lifetime providers
mounted at the shell root, so an unwatched production host exists only before `engineReady` and
after chrome teardown. **If either provider stops reading stats, the unwatched span becomes a
real editing window.**

## The substrate record

`substrate.ts` declares `HostSubstrate` — the record an extracted cluster is handed — plus
`createHostSubstrate`, an identity function whose entire value is being a single named place
where the host states the split and the compiler checks it.

**Eighteen of the twenty-one seam modules take it.** The three that do not are
`field-camera-rig.ts` (which deliberately asks for a box and a ceiling, not a store),
`field-segment.ts` (extracted before the record existed) and `field-capture.ts` (which borrows
another module's compose call rather than reading the store at all). Derive the split:

```sh
comm -23 \
  <(grep -lE "^export (type|interface) [A-Za-z]*Deps" packages/editor/src/field-host/*.ts | xargs -n1 basename | sort) \
  <(grep -ln "substrate: HostSubstrate" packages/editor/src/field-host/*.ts | xargs -n1 basename | sort)
```

### Value or thunk is about REPLACEMENT, not mutability

The split is not a style preference. **Eleven members are held BY VALUE** because they are
`const` in the host — the binding never moves, so every write lands through the identity already
handed out and a holder sees all of them.

**Five are THUNKS** — `table()`, `archetypeById()`, `ctx()`, `disposed()`, `canvasEl()` — because
the host REPLACES those values rather than writing into them, and a snapshot is a permanent fork
that throws nothing: `setMaterialTable` assigns a whole new `table`, and a module holding the old
one goes on meshing, validating and baking against a perfectly well-formed table describing a
project the user has already changed. `disposed` is the same bug with the volume up — snapshot it
and every `if (disposed) return` guard in an extracted module waves the teardown through.

`ChunkRender` and `PropRender` are declared HERE, and `field-host.ts` type-imports them, so the
host and the extracted clusters read one declaration rather than two structurally identical ones
the compiler could never tell apart. The record itself is not frozen or copied by the factory,
deliberately: the shared identity IS the contract on the value side.

## The deps-record law, in three clauses

The five T3b1 extractions settled this law, and it is usually collapsed into one clause by
mistake.

1. **Everything reassignable rides behind a CALL** — not because it is mutable, but because the
   host REPLACES the value (above).
2. **Substrate thunk or private dep turns on whether the member is ALREADY DECLARED**, not on how
   many readers it has. A module reads `archetypeById()` off the substrate though it is that
   member's only extracted reader, because it was declared ahead of any consumer and reading a
   declared member costs nothing new. In the same record that module takes its material getter
   *privately*, because that one was not declared and adding it would charge every future
   cluster's assembly for one consumer's convenience.
3. **The two-extracted-readers bar governs ADDING a member, never declining one that exists.**
   Read it the other way — "one reader ⇒ private dep" — and the next extraction pulls
   `archetypeById` back out of the substrate for no gain and one more bespoke dep.

### And there is a third answer: the state MOVES IN

`field-view.ts` is the first instance. Its two `let`s (`layers`, `sliceY`) had five reader
clusters between them — on a reader-count reading of the bar, the two most obvious substrate
members in the closure — and neither was added. They left the closure entirely, and the sites
that used to read the shared bindings now call the owning module's getters.

So the record is not "where reassignable state goes"; **it is where state the HOST still owns and
shares goes.** State that acquires an OWNER rides on that owner's seam instead, which is why
those call sites spell `viewState.layers()` and not `substrate.layers()`. Same CALL either way —
the law is unchanged — but the question "who owns this" has three answers, not two, and the
substrate is only the middle one.

**A single-consumer dependency does NOT earn a member.** Several modules carry one privately: a
host `let` reached through a function on the module's own deps record rather than through the
substrate. The thing that keeps a `let` honest is the CALL, not whose record it sits on.

## The four declared facade-residents

"Not extracted" and "examined and staying" needed to stop looking the same, so four clusters
carry a **DECLARED FACADE-RESIDENT** verdict recorded at source. Each is a decision:

- **`catalogs`** — three state bindings, zero functions. What a module would have contained is
  its three SETTERS' bodies, and all three are facade members; two of the three bindings already
  ride the substrate as thunks.
- **`history.stepHistory`** — six of its seven statements are calls into five different modules
  and it owns no state. All three callers are facade-resident, one of them the ⌘Z branch of the
  keydown handler. Its last non-module statement closed when `markDirtyWithNeighbors` moved with
  the world cluster, so the body is now a pure composition. It stayed behind when the history
  FEED left, which is a finding rather than an omission — the two wear the same name and are not
  the same thing.
- **`input`** — the adapter that turns DOM events into calls. It reads ZERO other clusters'
  state, and its standing mutation edges cross a module line **while every writer stayed where it
  was born**. The listeners own the canvas element and are never going to follow their targets.
- **`lifecycle`** — three reasons, of which the ordering is only the middle one. (1) Its state
  cannot leave: `requestContext` is a substrate VALUE member, and `ctx` / `disposed` BACK two
  substrate thunks that seven modules read through, so a module owning them would hand the
  substrate its own contents from below. (2) The teardown ORDER is load-bearing across eight
  modules and a context guard — each module owns its own half, and what remains is the SEQUENCE.
  (3) `init`, `dispose` and `tick` are what a facade over framework + tools owns. A
  `field-lifecycle.ts` would take deps across every module in the file plus three facade-resident
  functions.

## What stayed on the host at the gesture-machine extraction

The pointer chains moved into the machine ([interaction](interaction.md)); these did not, and
none is an omission:

- **The DOM listeners themselves.** `attachListeners` owns the canvas element and attaches
  **nine** — `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `wheel`, `contextmenu`,
  `keydown`, `keyup`, `blur` — with a symmetric nine `removeEventListener`. A module with no
  canvas should not acquire one.
- **keydown, keyup and blur.** The momentary ⇧/⌃ pins are closure-private keydown state with no
  facade route — `packages/editor/tests/field-host-momentary.gpu.test.ts` reaches them ONLY
  through the real listeners.
- **The wheel**, which is half camera.
- **DOM pointer capture**, as a `capturePointer` / `releasePointer` pair handed into the picking
  assembly and the machine as function-typed deps.

## Two rulings of record

- **The ViewStore state-placement rule is RETIRED by ratification.** An earlier design wrote *"a
  `let` crossing a module boundary belongs in the ViewStore, never a parameter"*; the as-built
  answers every crossing with a deps-record member — a named setter, a thunk, or a substrate slot.
  The deps-record architecture is ratified, on the evidence that every boundary-crossing edge is
  typed, named and auditable at its record.
- **The provider-collapse promise is recorded as a MISS.** The design promised the chrome
  provider would collapse; the latch conversion (the real goal, achieved) grew the file it was
  supposed to shrink. Not scheduled as work; recorded at
  `docs/backlog/editor-and-tooling/chrome-provider-grew-instead-of-collapsing.md`.

## The dated cluster record

`docs/reference/field-host-clusters.md` is the pre-work measurement that drove the un-growing of
this directory. It is a **dated snapshot annotated with corrections**, not a statement of how the
directory is today — read it as the record of what those tranches decided, and read this file for
current shape. Where the two disagree, this file and the artifact win.
