---
summary: The field's op log as the editor's only history — the derived step labels, the change token that rides the payload, the palette that steps rather than seeks, and why there is no transaction layer.
verified: 2026-08-18
---

# History

**The field's op log IS the editor's history.** There is no second document to step, so ⌘Z and
⇧⌘Z call `FieldHost.undo()` / `redo()` and nothing else, and there is no editor-side second undo
system. The canvas binds the same chord itself and stops propagation, so a ⌘Z with the viewport
focused steps once, not twice ([chrome](chrome.md) has the two-listener split).

The mechanism — the LIFO stacks, persistence, replay — is core's and stays there because the game
needs it. What the editor adds is a name for each step, a change token, and a surface.

## The labels are DERIVED, never authored

`packages/editor/src/field-host/field-history.ts` derives what each undo/redo step DID, in words
(D-F4.5-11). Core's `LogEntry` carries no label field and deliberately so — a label is a
presentation fact that would have to be authored at every push site and serialized into worlds it
has no business being in. This module is the one place the derivation lives, so the burger's
"Undo dig" and the palette's rows cannot disagree.

- It reads core's `FIELD_GENERATORS` constant for display names and **deliberately not
  `generatorById`**, which is setup-loud on an unknown id: a world file can name a retired
  generator, and a label that threw would take down every surface rendering history. The id is
  the fallback.
- `entryLabel` is total over `LogEntry` and, through `opsEntryLabel`, over `FieldOp` — enforced
  by an `unhandled(value: never)` **function** rather than a trailing default. A function because
  an unused `const _: never` is what Biome's unused-variable rule removes, and a guard a
  formatter can delete is not a guard.
- A `splice` with empty `inserted` is a **delete**; a splice whose region moved while seed and
  params settled is a **move**; anything else is a **reconfigure**. An `entity-update` checks
  **baked before frozen**, because baking clears `frozen` as part of severing the recipe, and
  asking about `frozen` first would call the one irreversible verb an "unfreeze".
- `HISTORY_TAIL` = 50 bounds the PAYLOAD, never the history: ⌘Z still reaches everything. Fifty
  is Photoshop's own default history-state count, which is the precedent the palette is shaped
  after, and the argument is at the constant. `FieldHistory` carries the true stack depths beside
  the arrays so a consumer can say how much it is not showing, and both arrays are
  **newest-last** — `undo.at(-1)` is exactly what ⌘Z would step.

The host publishes on this seam only when the log's two entry stacks really moved (several paths
tick the entity list without touching them), which is why the chrome's mirror needs no
comparator, and the hook DEFAULTS rather than throws outside its provider because an empty
history means "nothing has been done yet", which is exactly true there.

The action context reads the top of each stack for `Undo <label>` / `Redo <label>` off the
LABELS rather than off the stats depth: the depth says whether there is a step, the label says
what it is.

## The change token rides the PAYLOAD

`FieldHistory` carries a `revision`: an opaque, **compare-only** string over
`worldEpoch / ops.length / undoLen / redoLen / nextId`, composed by
`packages/editor/src/field-host/field-history-feed.ts`'s `revisionOf` from the very signature the
publish was decided by. It is what an agent re-reads to know something moved
([agent-door](agent-door.md)).

**It is in the payload because the alternative was measured and rejected.** A `FieldHost` poll —
which this briefly shipped — runs one-directionally AHEAD of the chrome's latched mirrors, so an
ask landing between a log mutation and React's next commit answers with a post-edit cursor over a
pre-edit picture, which a reader caches and which every later ask then confirms as unchanged for
ever. Riding the payload makes *"this token and these labels describe one moment"* structural.

**The cursor therefore certifies `history` and nothing else.** Stats, selection, selected entity,
tool, session and world ride their own latches — stats is published per rAF, so it can trail the
cursor by a frame after an edit — and the camera is polled live. It answers about the FIELD only:
selection, camera, tool and gesture all move without touching it.

The token is STATELESS in the sense that separates it from the log-signature cache in
`field-stats.ts`: it can alias but it cannot latch, because there is no tracker to fall behind.
`HistorySignature` stays module-private — the token is a string, so nothing outside can still ask
what a signature IS.

**The change guard compares five terms, and three of them are load-bearing in ways a pin holds.**
Comparing the two stacks alone meant a world swap that left the history empty published nothing —
measured: a fresh host's new-world plus a whole world load left the subscriber on its single
arrival push — so a payload-carried token would have missed a world load entirely. The epoch is
the world term; `nextId` and `ops.length` are a PAIR standing in for the top-entry identities,
which cannot serialize — `nextId` catches undo-then-a-new-op, `ops.length` catches
undo-then-a-freeze/bake, which mints no op while the undo has already peeled the log. The cost is
one extra publish per world swap over an empty history.

**The one alias it carries is documented and pinned**: two `entity-update` entries create no op,
so freeze → ⌘Z → bake composes the same five numbers over a world where a different thing is
true. It is a change HINT — the caller re-reads state and never diffs cursors.

## The palette is a STEPPER, not a seeker

`packages/editor/src/frontend/components/shell/HistoryPalette.tsx` is a contract rather than a
simplification. Core's undo/redo are strictly LIFO — each entry's chunk images assume the state
below it, and splice and entity-update entries address the op list positionally — so **there is no
honest way to build a seek on these primitives.**

A row click therefore calls `undo()` (or `redo()`) N times, which is exactly what the user could
have done with N presses, and the loop is bounded by construction because no row can be further
from the divider than the tail it was rendered from. If the log moves between the render and the
click, the click still takes N legal steps, just not to the state the row named; that cannot
corrupt anything, because "N steps" is meaningful against any log where "seek to entry 7" would
not be.

Rows run **newest-first with the current position implicit at a divider** — redo above, undo
below — so time runs downward into the past. That is the inverse of Photoshop's list and the
right way round for a panel whose top line answers "what did I just do?". Both sides report what
they are **not** showing (true depth less rows in hand), because ⌘Z and ⇧⌘Z really do reach past
them.

The palette is **summoned rather than always-on**. It starts closed, and the ways in are the
status bar's `undo N` chip (a button, present even at 0 — a history you have not started is still
the surface a first-time user should be able to find), the Edit menu's row, and the burger's
palette checkbox. **`edit.history` deliberately has NO chord**: ⌘Y is redo on Windows and would
teach the wrong thing, and every bare letter in the editor is a tool family
([action-registry](action-registry.md)).

## Compaction runs at WORLD LOAD only

`COMPACT_THRESHOLD_OPS` is 200, and core's fold requires a **quiescent history** — both stacks
empty — because its splice and entity-update entries address the op list by position. World load
is the one moment that holds. **A failed fold never fails a load.** The durable fix is filed:
`docs/backlog/engine-architecture/field-log-entries-anchored-by-index.md`.

The op-cost meter that answers "why has this world got slow" reads core's log stats, pushed with
the per-frame stats under a log-signature dedup, and surfaces as the status bar's ops chip
([chrome](chrome.md)).

## There is no transaction layer, and that is a decision

A `TransactionManager` / `txn(label, fn)` layer was **DROPPED** on measured evidence rather than
deferred, and the premises that killed it are all still true:

- **Only three of the five candidate commit paths are real writers**, and each owns a core
  composite that cannot decompose (`commitGenerator`, `reconfigureGenerator`, `logApply`).
- **`FieldHost.commitSession` had ZERO production callers and is deleted.** It meant "end the
  live session with whichever verb its MODE calls for"; the app-level ⏎ is `confirmSession`, and
  the session card's footer routes there too because the button wears the ⏎ keycap and must mean
  what the key means. The mode→verb mapping it exposed is not deleted — it survives inside the
  machine as `confirmSession`'s first step.
- **`logApplyGroup` already IS the grouping layer** for the day a gesture emits a list. The
  editor's own gestures do not emit one: its only call site under `packages/editor/src` is the
  agent-facing mutation seam (`grep -n "logApplyGroup(" -r packages/editor/src`).
- **A `txn` LABEL would author a fact the history module already DERIVES**, and that module's
  no-label stance is a written decision, not an accident.

**UI state stays non-undoable** — selection, camera and palettes are not history. The one open
question about group apply is filed and unchanged by any of this:
`docs/backlog/engine-architecture/oplog-group-apply-is-not-a-transaction.md`.

## Entries carry an author, and the palette does not show it

Every `FieldOp` and `LogEntry` carries an `origin`; **absent means human**, so a person's entries
are byte-identical to their pre-attribution form. The editor asserts exactly one tag, at the
seam where agent traffic enters the tab, and an agent's batched ops are ONE entry — the
**named-stroke guardrail**, which is what makes an agent's batch one ⌘Z for the human. Who may
step whose entry, and what a `session.confirm` commit is left as, are
[agent-door](agent-door.md)'s.

Nothing in this surface reads that field. **No attribution is surfaced to the human** — showing
who authored an entry is blame UI and is nobody's job yet — and there is no "added since your
last look" rung: the log attributes entries, it does not diff them for a reader. Core stays
policy-free too: its `undo`/`redo` read no `origin` and the stacks arbitrate nothing.
