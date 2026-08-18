---
summary: The world a session is authoring — the untitled scratch, the dirty bit derived from the op count, the one job field, and the drawer that holds every dangerous verb.
verified: 2026-08-18
---

# The world

A world is a directory under the project's `worlds/`. The daemon owns the bytes and the
index ([commands](commands.md) tables `world.list` / `makeDefault` / `delete` / `rename` /
`duplicate`, and the `field.load` / `generation.bake` pair that reads and writes one); the
browser owns which world this session is authoring, whether it has unsaved work, and what a
long write is currently doing. That second half is this file.

## It is SHELL state, not palette state

`packages/editor/src/frontend/hooks/useWorld.tsx` holds it, mounted by the shell rather than
by any surface. The world chip reads it, ⌘S drives it, the drawer lists against it — and a
control stack that owned the save verb could be dissolved into palettes, taking ⌘S with it
when the palette holding it closed.

It sits **under** `FieldHostStateProvider` because the dirty bit derives from the stats seam,
which it reads through `useFieldHostState` — its own latch on that seam, beside the status
bar's. A duplicate mirror of a seam is the normal arrangement ([chrome](chrome.md)).

The hook splits into a **state** context and an **actions** context. What the split isolates
is `drawer` and `job`, which move far more often than `name` and `dirty` — the verbs close
over the latter two and are rebuilt when either changes.

## `name` is `null` for an untitled scratch, and is never prefilled

A fresh editor boots into an untitled world, and no default name is ever put in the field. A
stale default silently overwrites the game's world at the first Save; an untitled ⌘S opens the
drawer in `save-as` mode to be named first (D-21). The same `null` is the key the session
claim uses for an unnamed session ([change-feed](change-feed.md)) — a key rather than an
absence, because the commonest session in the editor's life is a user digging before they have
named anything.

## `dirty` derives from the op count, and deliberately only one way

The stats push carries `totalOps`; a change in it sets `dirty`. That is honest in the
direction that matters — an edit always sets it — and deliberately imprecise in the other:
undoing back to the saved state leaves it set.

- A **`savedOps` ref** carries the op count at the last save point, so the discard confirm can
  say **how much** is at stake. A number the user can weigh is the difference between a prompt
  they read and one they click through; when the baseline is not yet established the message
  drops the number rather than claiming "0 unsaved ops".
- A **`seenOps: null` sentinel** re-establishes the baseline across a world swap, so adopting
  the new world's op count does not read as an edit.

## One `job` field names the verb, and the readout labels it

`job` is `"save" | "bake" | "open" | null` — one field rather than a flag beside a label. The
action registry only ever asks whether one is running (`ActionCtx` projects `busy`), while the
status bar renders its own `JOB_LABELS` map. The tags name the **verb**, not the readout; a tag
spelled `"saving"` would be a UI string living in state.

**The long-job readout (D-19)** is the status bar's one non-interactive chip, driven by two
facts and no store of its own: this field for a write or a read, and `FieldStats.voidCastPending`
for the X-ray's whole-world worker job ([tools](tools.md)). The cast rides the existing per-frame
stats push rather than a seam of its own — every reader of that fact already reads stats, and
`analyzerPending` beside it had already established job-in-flight-ness as a member of that type.
In-flight is said at the controls (they disable) and on the bar, **never in a toast**, because a
toast slot spent on "saving…" is a slot the outcome then cannot have.

**There is no cancel on the chip**, and D-F4.5-19's second clause is the reason ("the job polls;
no cancel theater"): `bakeFieldWorld` is synchronous core with no yield in its per-chunk loop,
the uploads carry no `AbortSignal` against a daemon that clears the world directory before
rewriting it, and the cast's per-chunk loop is inside a worker handler that runs to completion
per message — a cancel `postMessage` would queue behind the work it means to stop. The reasons
and their re-check triggers live at `useWorld.tsx`'s `write` / `open` and at
`packages/editor/src/field-host/field-voidcast.ts`'s `requestVoidCast`; nothing else restates
them.

## The verbs are a narrow surface over two dependencies

`packages/editor/src/frontend/lib/world-actions.ts` is where saving and loading are actually
written, and it takes exactly what it touches: `WorldHost` is
`Pick<FieldHost, "exportArtifact" | "loadWorld">` and `WorldApi` is picked off the real client
(`generationBake`, `fieldLoad`, `worldList`), so a signature change in either breaks here rather
than at runtime and the test double is three lines instead of a whole host.

Both verbs answer an **outcome union** rather than throwing: `SaveOutcome` is
`saved | invalid-name | needs-tracked-confirm | failed`, `LoadOutcome` is
`loaded | invalid-name | failed`.

**The tracked guard is a round trip, not a precheck.** A save issues with
`confirmedTracked: false`; a `needs-tracked-confirm` outcome comes back and raises the confirm
naming the path. The upload is an await, so a separate check-then-write would race — and the
tracked flag is read fresh from `world.list` at write time rather than from whatever the drawer
last rendered, since a stale row is exactly the shape of the clobber the guard exists to
prevent.

`rememberWorld` writes the `lastWorld` key ([chrome](chrome.md) covers the persistence blob),
and `worldToRestore` checks the remembered name against `world.list` before anything is loaded,
so a world deleted behind the editor's back is a miss rather than a failed load.

## `tracked` is a tri-state, and `null` earns no badge

`world.list`'s per-row `tracked` comes from `git check-ignore`: `true` / `false` are answers,
and **`null` means git could not tell** — no repo, or an ambiguous answer. The chrome renders
nothing for a `null` rather than guessing a badge, in the drawer and in the save confirm alike.

## The drawer is where every dangerous verb lives

`packages/editor/src/frontend/components/shell/WorldDrawer.tsx` (D-20/D-21) is every world in
one modal list, summoned from the world chip and gone the moment it is dismissed. Transient by
construction, so it can afford to say more per row than a permanent sidebar could.

It is a **modal `Dialog` rather than a popover** because make-default, delete and
save-over-tracked all live there, and a stray outside-click must not leave a half-typed rename
hanging over the canvas.

It **owns no world state**: verbs come from `useWorldActions`, confirms are the App-owned
prompt, and rows come from `world.list` **refetched on every `worlds-changed` tick — never
patched from a mutation's response** ([change-feed](change-feed.md)), so a change made behind
the editor's back (a git checkout, another editor) shows up the same way the editor's own do.

Its list is the **other** APG model from the roving grids the rest of the chrome uses —
`aria-activedescendant`, DOM focus never leaving the filter field. The two models are not
interchangeable and must not be mixed on one surface ([design-system](design-system.md)).
