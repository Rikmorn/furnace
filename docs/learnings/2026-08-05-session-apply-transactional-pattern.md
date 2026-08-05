# The session's transactional pattern outlives the session

Foundations T2 deletes `packages/editor/src/daemon/session.ts`, along with `mutations.ts`,
`scenes.ts` and `registry-bundle.ts`, when the editor's scene-document half retires. The
code goes; the pattern should not. It is the donor design for the T3 TransactionManager,
which has to give the field store the same guarantee on a completely different substrate.
This file is that handoff — written from the source in the same tranche, immediately
**before** the deletion commit, so that someone who cannot open the file can still rebuild
the mechanism and knows which parts of it were substrate-specific.

**Provenance.** Every line reference below points into code as it stood at master
`4197f807` (verified byte-identical on `foundations-t2` at `6b454237`, the commit
immediately before the deletion). Once the deletion lands these paths no longer exist —
reach them with `git show 4197f807:packages/editor/src/daemon/session.ts`, or
`git log --follow` from that commit. The behavioural contract was pinned by
`packages/editor/tests/session.test.ts` and `packages/editor/tests/session-race.test.ts`,
deleted in the same change and reachable the same way.

## 1. What the session owned

One mutable open document, one file watcher, one pair of history stacks, held in a single
`OpenState` object behind a closure (`session.ts:68-87`). `state` is either an `OpenState`
or `undefined`; there is no partial state. Every public method starts by narrowing that:

```ts
const requireState = (): OpenState => {
  if (!state) throw new EditorError("no-session", "no scene is open");
  return state;
};
```

That the whole session is *one reference* is what makes the staleness guard in §4 a single
`!==` comparison. A design that spread the open state across several fields would have had
to compare several, or invent a generation counter.

## 2. `apply` — the transactional core

`session.ts:216-241`. Faithful shape, comments trimmed:

```ts
async apply(command, edit) {
  const s = requireState();                    // 1. precondition: something is open
  const next = structuredClone(s.document);    // 2. clone
  edit(next);                                  // 3. edit the CLONE (may throw)
  const registry = await deps.registry.current();  // 4. the one and only await
  if (s !== state)                             // 5. staleness guard
    throw new EditorError("no-session", "session was replaced while the edit was validating");
  try {
    registry.validateDocument(next);           // 6. whole-document validation
  } catch (err) {
    throw new EditorError("validation-failed", message(err));
  }
  pushUndo(s);                                 // 7. commit — synchronous, all-or-nothing
  s.redoStack = [];
  s.document = next;
  s.revision++;
  deps.emit({ type: "document-changed", revision: s.revision, command });  // 8. emit
  return view(s);                              // 9. answer the caller
}
```

Nine steps, not eight: the `requireState()` precondition is a step, and it matters that
`no-session` is thrown from **two** places in this one function for two unrelated reasons —
"nothing was open when you called" and "something else took the session while you were
awaiting". A client cannot distinguish them by code, only by message. If the successor
wants them distinguishable, that is a deliberate change, not an oversight to inherit.

**Why clone-then-swap rather than edit-then-rollback.** Rollback needs an inverse for every
edit, and an inverse that is wrong is worse than no transaction at all. Cloning buys
all-or-nothing with *no* inverse: on any failure path — a throwing edit, a stale session, a
rejected document — the function simply returns without assigning `s.document`, and the
clone is garbage. There is no cleanup code, so there is no cleanup code to get wrong. The
price is `structuredClone` of the whole document per mutation, which was affordable for a
scene JSON of tens of KB and is the first thing that stops being affordable on a different
substrate (§8).

**Why the edit is a callback, not a data description.** `apply` knows nothing about what an
edit *is*. The structural edits lived in `mutations.ts` as plain functions that mutate the
document handed to them and enforce only target-existence preconditions (`addEntity`,
`setComponent`, `removeResource`, …), each throwing `EditorError("validation-failed")` on a
missing target — the same code the post-edit validation uses, because both mean "this edit
does not apply to this document". Schema correctness was never their job; step 6 owned it.
That split is why the mutation set could grow without `apply` changing once.

**Batching came free.** `scene.batch` (`handlers.ts:234-261`) was one `apply` call whose
edit closure looped over N component edits. One clone, one validation, one undo entry, one
`document-changed` — and the whole batch rejected if any single edit failed, because the
clone carrying the partial work was simply dropped. No batch-specific machinery exists
anywhere in `session.ts`. **A transactional envelope that takes a closure gets grouping for
free; one that takes a single typed operation has to grow a batch variant.**

**The edit is required to be synchronous — and the type does not enforce it.** `edit` is
typed `(doc: SceneDocument) => void`, and TypeScript's void-return assignability rule lets
an `async` function be assigned to it (verified with `tsc --strict` while writing this: an
`async (doc) => {…}` assigned to a `(doc: {n:number}) => void` type compiles clean). Such an
edit would be un-awaited: `apply` would clone, fire the edit, and validate a document the
edit had not finished writing. Nothing in the deleted code hit this, because every call site
was a synchronous `mutations.*` call. A successor that accepts edits from a wider set of
callers should make this a runtime check (`if (edit(next) instanceof Promise) throw`), not a
comment.

## 3. Exactly one await, and where it sits

`apply` awaits once. That is a property worth preserving deliberately rather than by
accident, for two reasons.

First, **one await is one interleaving point.** Everything after it — validate, push undo,
clear redo, swap, bump, emit — is a straight-line synchronous block, so no other task can
observe the state half-committed. "All-or-nothing" is enforced by the event loop, not by
discipline.

Second, **the await is on an injected dependency**, `RegistryLoader.current()`, which is
what made the race testable without adding a seam (§5).

The await exists at all because validation lives in a bundle built from the *consumer's*
`@furnace/core/scene` plus their extensions, built lazily and cached
(`registry-bundle.ts`). If a successor's validation is synchronous, `apply` has no await,
the staleness guard becomes unreachable, and it should be deleted rather than kept as
decoration.

## 4. Staleness: one guard, two different answers

There are four `s !== state` checks across two functions, and they are not copy-paste of
each other — they differ in what they do when they fire.

| Site | Fires after | Response |
| --- | --- | --- |
| `apply` (`:225`) | `registry.current()` | **throws** `no-session` |
| `onFileChanged` (`:119`) | a *failed* `readFile` | returns |
| `onFileChanged` (`:128`) | a *successful* `readFile` | returns |
| `onFileChanged` (`:146`) | `registry.current()` | returns |

The rule that produced this split, and the transferable part:

> **A stale continuation returns silently when it owed the world only a notification, and
> throws when it owes a caller an answer.**

`onFileChanged` is a watcher callback. Nobody is waiting on its promise; its whole output is
side-effecting events. If the document it was reloading is no longer the open document, the
reload is not merely unnecessary — emitting it would be *wrong*, because it would announce a
change to a document nobody has open. Silence is the correct output. `apply` is an RPC in
progress: some client is blocked on its promise. Returning a `SessionView` of the *new*
session would be a lie about which document the edit landed in; committing to the orphaned
`s` would mutate a document nothing observes. Throwing `no-session` hands the client the one
true fact — the session it addressed is gone — and lets it refetch and retry if the edit is
still meaningful.

Note the *pair* of guards around `readFile` (`:119` and `:128`). The failure path needs its
own check because a failed read on a swapped-out document must not raise a conflict flag on
the document that replaced it. Guarding only the success path is the easy version of this
bug.

Two details that fall out of the same discipline and are easy to lose:

- **The guard is re-checked after every await, not once at the top.** `onFileChanged` awaits
  twice and checks three times. A single check after the first await would let a swap during
  the second await through.
- **`dispose()` counts as a swap.** It sets `state = undefined`, so `s !== state` fires for
  a torn-down session exactly as it does for a replaced one, with no extra code.

## 5. How the interleavings were made testable

This is the part most worth copying, because a race you cannot write a deterministic test
for is a race you will re-introduce.

The lever is a hand-resolved promise (`session-race.test.ts:26-32`):

```ts
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
```

A test then parks the function under test inside a chosen await, performs the interfering
operation *synchronously in test order*, and only then resolves the gate. The interleaving
is not raced — it is scripted. Both tests read:

```
open(A) → start the operation (suspends at the gated await) → open(B) → resolve the gate
       → assert the stale continuation did the right thing
```

For that to work the gate has to sit on a seam, and the two functions got their seams
differently:

- **`apply` needed no new seam.** Its await is `registry.current()`, and `RegistryLoader` was
  already injected. The test supplies a loader whose `current()` returns the deferred promise
  and whose `reload()` resolves immediately — and that asymmetry is load-bearing: `apply`
  awaits `current()` while `open` awaits `reload()`, so gating `current()` parks `apply`
  without also parking the `open` that is supposed to overtake it. **Two operations that must
  be interleaved in a test should not await the same method.** That was not designed in, but
  it is why the interleaving is four statements long.
- **`onFileChanged` needed one.** Its await is `readFile` from `node:fs/promises`, imported
  directly. A test-only optional dependency was added for exactly this
  (`session.ts:28-39`):

  ```ts
  readTextFile?: (path: string, encoding: "utf8") => Promise<string>;
  ```

  with TSDoc saying so in as many words — "injected only so tests can control the mid-`await`
  interleaving that the `onFileChanged` staleness guards protect against". Defaulted to the
  real `readFile` at the call site (`:112`), so production wiring never mentions it.

The honest reading: **every await in a function with a staleness guard needs to be gateable,
and if the await is on a module import rather than an injected dependency, that is a seam you
have to add.** Adding it is cheap and naming it as test-only in its TSDoc is what stops it
from being mistaken for a feature later.

Both tests assert on the *absence* of an emission (`documentChanged(events)` is empty),
which is the only observable difference between "the guard fired" and "the guard fired and
also did the work". Asserting the throw alone would have passed with a stale commit still
landing.

## 6. Undo/redo with no snapshot cost

`pushUndo` (`session.ts:102-107`) pushes **the live document object itself**:

```ts
const pushUndo = (s: OpenState): void => {
  s.undoStack.push(s.document);
  if (s.undoStack.length > UNDO_CAP) s.undoStack.shift();
};
```

No clone. The insight is a consequence of §2, not an independent trick:

> **If every commit installs a fresh object and nothing is ever mutated in place, the object
> being replaced is already an immutable snapshot. Snapshot undo is free for anyone who
> already clones to commit.**

The clone `apply` pays for atomicity therefore pays for history too. A design that mutates
in place gets neither, and has to buy history separately — with inverse ops (§8).

The rest of the history contract, as the tests pinned it:

- **`UNDO_CAP = 100`**, enforced *after* the push (`push`, then `shift` if over), so the
  stack holds at most 100. Pinned exactly: 105 mutations then 100 undos succeed and the
  101st throws.
- **A new mutation clears the redo stack** (`s.redoStack = []` in both `apply` and the
  file-reload commit). Standard, but note it is in the *commit* block, so it can never be
  cleared by a mutation that was subsequently rejected.
- **Empty stacks throw** — `nothing-to-undo` / `nothing-to-redo`, both 409 at the HTTP edge.
  They are not silent no-ops, because a client that asked to undo with nothing to undo has a
  stale view of `canUndo` and should learn that.
- **`undo`/`redo` are synchronous** — no validation on the way back, because everything on
  the stacks validated on the way in. This is only sound while nothing else can invalidate a
  past document; if a successor's schema can change under a live session, it stops being
  sound.
- **`revision` is a change counter, not a document version.** Undo *increments* it (undoing
  one mutation takes revision 1 → 2). It answers "has anything happened since you last
  looked", which is what an SSE-driven client needs; it does not identify a document state.
- **The redo stack is uncapped** — bounded only transitively, since you can only redo what
  you undid, and at most 100 entries can be undone.
- **File reloads are undoable mutations.** `onFileChanged`'s commit block is `apply`'s (push
  undo, clear redo, swap, bump, emit) with `command: "file-reload"` — plus one extra line,
  `s.savedText = serialize(parsed)`, because a reload lands **clean** where a mutation lands
  dirty. An edit made in an external editor goes on the undo stack like any other.

## 7. One canonical serialization, three jobs

```ts
export function serialize(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
```

`session.ts:60-63`. It is exported, and it is the *only* definition of the document's byte
form. Three otherwise-unrelated behaviours are defined in terms of it:

1. **Dirty** — `isDirty(s)` is `serialize(s.document) !== s.savedText` (`:89-90`). There is
   no dirty *flag* to keep in sync with reality; dirtiness is derived on every read.
2. **Save-echo suppression** — the watcher fires on the daemon's own write. `onFileChanged`
   compares `serialize(parsed) === s.savedText` (`:138`) and returns. Because both sides are
   re-canonicalized, this also absorbs genuine no-op rewrites and pure reformatting on disk.
3. **The bytes on disk** — `save()` writes `serialize(s.document)` verbatim.

Because all three are the same function, **they cannot disagree**. The classic failure here
is a dirty flag maintained by hand plus a separate echo-suppression heuristic (mtime,
content hash, a "we just wrote this" boolean with a timeout); each is a place for the two
notions to drift apart, and the symptom is either a save that keeps reporting dirty or a
watcher that clobbers unsaved work.

Two consequences worth carrying:

- **`savedText` is canonical, never the raw file bytes.** `open` sets
  `savedText = serialize(raw)` (`:190`), so a compactly-formatted file on disk opens *clean*
  even though its bytes differ from what a save would write. Pinned by a test whose whole
  point is that ("open a compactly-formatted file starts clean"). Formatting is not
  considered a change.
- **`save()` sets `savedText` BEFORE the write** (`:205-214`):

  ```ts
  s.savedText = serialize(s.document);
  await writeFile(s.abs, s.savedText, "utf8");
  ```

  The ordering is the point: the write is what makes the watcher fire, so setting `savedText`
  first means there is no window at all in which an echo can arrive against a stale
  `savedText`. **Set the expectation before performing the act that triggers the
  notification, not after.** In practice the production watcher made that window hard to hit
  anyway — `chokidarWatchFile` (in `packages/editor/src/daemon/watch.ts` at `4197f807`) used
  `awaitWriteFinish: { stabilityThreshold: 100 }`, so echoes arrived ≥100 ms late — which is
  exactly why the ordering is worth writing down: it is defensive against an interleaving no
  test run would have surfaced, not a fix for a measured race. The accepted cost is honest:
  if `writeFile` throws, `savedText` has already moved and the session reports clean over
  stale bytes. Nothing compensated for that, and a successor writing to a less reliable store
  should decide deliberately rather than inherit it.

The related conflict rules, for completeness: a disk change under a dirty session sets
`conflict` and emits `file-conflict` without touching the document (never clobbers); a
delete or unreadable file does the same, deliberately leaving the choice to the user, since
`save` restores the file and `open` moves on; `save()` clears `conflict` unconditionally,
making it the "my version wins" resolution.

## 8. What transfers to the field store, and what does not

The successor substrate is the field's op log (`packages/core/src/field/types.ts`, `OpLog` /
`LogEntry`), not a JSON document. The differences are not cosmetic:

**Does not transfer — `structuredClone` as the atomicity mechanism.** The field is chunked
voxel data; cloning it per brush stroke is not affordable at any interesting size. Core
already went the other way: `LogEntry` carries `inverse: OpInverse` and chunk pre-images,
i.e. it mutates in place and buys undo with inverses. That choice is correct for the
substrate and it *costs* what §2 and §6 were getting for free — a rejected mid-transaction
edit now needs a real rollback path, and the rollback path needs its own tests. Budget for
that; it is the single largest thing the donor design was hiding.

**Does not transfer — dirty by re-serialization.** `isDirty` runs `JSON.stringify` over the
whole document on *every* `view()` call. Fine for a scene; absurd for a field. The successor
needs a cheap identity (a monotonic op-log length, or a saved-op-index) — but should keep the
*property* that dirtiness is **derived from one definition** rather than tracked as a flag,
and that the same definition answers "did this file event come from us".

**Transfers directly:**

- The commit block as a synchronous, straight-line, all-or-nothing tail after the last await.
- One await per transaction where possible; a staleness re-check after *every* await.
- Silent-return for notification-only continuations, throw for continuations that owe a
  caller an answer — and the discipline of deciding which one each site is.
- A closure-shaped transaction (`txn(label, fn)`) so that grouping N edits into one undo
  entry needs no batch-specific code.
- Test-only injection of whatever the transaction awaits, plus a hand-resolved `deferred()`
  to script the interleaving rather than race it, asserting on the *absence* of emissions.
- Labels/commands carried into the emitted change event, so "one gesture = one named undo
  entry" is a property of the transaction and not of the caller's bookkeeping. The field
  side already derives its labels rather than storing them
  (`packages/editor/src/viewport-host/field-history.ts`) — the two halves meet here.

## 9. Line-reference index

All into deleted files; use `git show 4197f807:<path>`.

| Ref | What |
| --- | --- |
| `packages/editor/src/daemon/session.ts:216-241` | `apply` — the transactional core |
| `…/session.ts:102-107` | `pushUndo` — the no-clone snapshot |
| `…/session.ts:109-165` | `onFileChanged` — reload, echo-suppression, conflict, 3 guards |
| `…/session.ts:205-214` | `save` — `savedText` before the write |
| `…/session.ts:60-63` | `serialize` — the one canonical form |
| `…/session.ts:89-100` | `isDirty` + `view` |
| `…/session.ts:168-199` | `open` — fresh registry, canonical `savedText`, stack reset |
| `…/session.ts:243-273` | `undo` / `redo` |
| `…/session.ts:28-39` | `SessionDeps`, incl. the test-only `readTextFile` seam |
| `packages/editor/tests/session-race.test.ts:26-32` | `deferred()` — the interleaving lever |
| `packages/editor/tests/session.test.ts` | the behavioural contract (cap, throws, conflict) |
| `packages/editor/src/daemon/mutations.ts` | the pure structural edits `apply` composed |
| `packages/editor/src/daemon/handlers.ts:234-261` | `scene.batch` — grouping for free |

The as-built prose for this design lived in `docs/reference/editor-architecture.md` §4.2 and
was accurate at `4197f807`. That section is removed along with the code — this file is the
surviving record.
