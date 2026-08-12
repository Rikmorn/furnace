# The world verbs — the follow-on set

Three entries about the `world.*` family's edges. Two were consolidated at the F4.5 seal
(2026-08-03); the third was added at foundations T2 (2026-08-05). All are the same class of
thing: a world verb that WORKS and whose failure, confirmation or vocabulary says less than
it could. The verbs themselves (list, make-default, delete, rename, duplicate) and the
drawer that drives them are as-built at `docs/reference/editor-architecture.md` §4 and §16.4.

Each section keeps its own trigger.

## Route a tracked-precheck failure INTO the overwrite confirm

`saveWorld` (`packages/editor/src/frontend/lib/world-actions.ts`) reads `world.list`
before every write to find out whether the target world is tracked, because D-21 requires
an explicit confirmation before overwriting one. Today a failure of that pre-check
**refuses the save** — "save refused — could not check whether worlds/<n> is tracked
(<why>); nothing was written".

### Context

Three behaviours were on the table when the guard shipped (F4.5a Task 8):

1. **Degrade to indeterminate** — treat a failed check as `tracked: null` and write
   anyway. Rejected: `null` already means "no git repo / ambiguous answer", so a daemon
   hiccup would silently become a bypass of the one guard standing between a scratch
   session and the world the game loads. A safety check that disappears when the system
   is unhealthy is the wrong shape.
2. **Fail loud** (shipped) — refuse, and say the write did not happen. Endorsed at review:
   `world.list` and `generation.bake` cross the SAME transport, so the dominant failure
   mode (the daemon is down) would have failed the bake a moment later anyway. Refusing
   costs approximately zero availability in that case.
3. **Escalate into the confirm** — on a failed check, open the overwrite prompt with the
   uncertainty named: *"Couldn't verify whether worlds/<n> is tracked — overwrite
   anyway?"*, and write only if the user says yes.

(3) strictly dominates both: it keeps the user's ability to save through a partial
outage (which (2) takes away) while never writing over a possibly-tracked world without
consent (which (1) does). It was not shipped because it is not a message change — it adds
a **fourth outcome status** to `SaveOutcome` (`needs-unverified-confirm`, distinct from
`needs-tracked-confirm`: different copy, different meaning, and the caller must not
collapse them), plus its own routing branch in `useWorld`'s `write()`, plus its own
confirm copy and tests. That is design surface, and the case that motivates it has never
been observed.

The narrow window (2) actually costs anything in: `world.list` fails while
`generation.bake` would have succeeded — a permissions/`readdir` problem confined to
`worlds/`, or a daemon partially degraded. Real, but unobserved.

### Trigger to revisit

The first time the fail-loud refusal bites a real session — i.e. someone hits "save
refused — could not check whether worlds/<n> is tracked" while the daemon is otherwise
working. That report is the evidence the narrow window is real, and it should be taken as
sufficient on its own; no second occurrence needed.

### Reference

- `packages/editor/src/frontend/lib/world-actions.ts` — `saveWorld`'s pre-check block
  (its own `try`, separate from the write-path catch) and the `SaveOutcome` union.
- `packages/editor/src/frontend/hooks/useWorld.tsx` — `write()`, which routes
  `needs-tracked-confirm` into the App-owned prompt; a fourth status lands beside it.
- `packages/editor/tests/world-actions.test.ts` — "a world.list failure fails the save
  rather than silently dropping the guard" is the case that changes.
- D-21 (the overwrite-confirm requirement) in the F4.5 charter.

---

## The world-name commit cue has two gaps: rename/duplicate, and case-folding

F4.5c Task 6 gave `NameForm` an OVERWRITE cue — type a name that is already taken and the
form says so *before* you commit, rather than leaving you to read an error toast afterwards.
It is wired to exactly one form, save-as, and deliberately: the prop is named `overwrites`
(the consequence) rather than "taken names", because save-as REPLACES while `world.rename`
and `world.duplicate` are refused outright by the daemon. Wiring the same set to those two
would promise an overwrite that never happens.

Two gaps survive that decision.

### 1. Rename and duplicate still teach by error toast

Both handlers refuse a taken name with `already-exists` — the `throw new EditorError
("already-exists", …)` inside `handlers.set("world.rename", …)` and
`handlers.set("world.duplicate", …)` in `daemon/handlers.ts` — so the user types, submits, and
learns from a red toast. D-25's "the commit verb explains refusals" arguably wants a line in the field there
too — but it is a DIFFERENT line ("that name is taken" / the verb is refused), not the
overwrite warning, so it needs its own copy and its own prop rather than a second consumer
of `overwrites`. That is the design question this half is filed on.

### 2. Case-folding: `Cavern` overwrites `cavern` and the field says nothing

On macOS's default case-insensitive filesystem, `worlds/Cavern` and `worlds/cavern` are one
directory entry. The save-as cue is an exact-match `Set` lookup
(`WorldDrawer.tsx`'s `overwrite` const, `valid && overwrites.has(value)`), so typing `Cavern` against a listed
`cavern` shows no warning while the write lands on the existing world.

**Pre-existing and not this cue's fault**: the tracked-world confirm downstream has the same
blind spot for the same reason — it asks git whether `worlds/<typed name>` is tracked
(`lib/world-actions.ts`'s `needs-tracked-confirm` guard), and git's index is case-sensitive, so the differently-cased
path reads as untracked and no confirm fires either. Both surfaces are exact-match against a
filesystem that is not.

Note the daemon already handles this correctly for the OTHER two verbs — `world.rename` and
`world.duplicate` both `existsSync(worldDir(...))`, which the filesystem itself folds, and
both carry a comment saying so. It is only the save path that is blind.

The honest fix is daemon-side, because case-equivalence is a property of the filesystem and
the frontend cannot know it: either report FS case-sensitivity in the project info the
drawer already fetches, or add a "would this overwrite?" probe the form can call. Doing it
in the frontend would mean lowercasing both sides, which is wrong on Linux where the two
worlds genuinely are distinct.

### Trigger to revisit

Either half being reported by a user (gap 2 loses work silently, so a single report is
enough), or the next task that touches `NameForm`'s props — both fixes land in that file's
contract and doing them together is most of the saving.

### Reference

- `packages/editor/src/frontend/components/shell/WorldDrawer.tsx` — `NameForm`'s
  `overwrites` prop and the docblock stating why rename/duplicate must not pass one; `:512`
  is the one form that does.
- `packages/editor/src/daemon/handlers.ts` — the `existsSync` collision check in the
  `world.rename` and `world.duplicate` handler bodies, and its case-insensitive-filesystem
  comment. **Cited by SYMBOL rather than by line, deliberately**: this entry has now carried
  wrong line numbers twice (`:500-540`, then `:316-373`/`:339`/`:369` — the T4b re-cite that
  was meant to fix them landed ~29 off, `:339` being a comment and `:369` sitting inside
  `dispatch`). `grep -n 'already-exists' packages/editor/src/daemon/handlers.ts` is the
  durable instrument; the file's line numbers move whenever the registry gains or sheds a
  family, and it shed one to `session-handlers.ts` in T4b.
- `packages/editor/src/frontend/lib/world-actions.ts` — the tracked-overwrite confirm's
  predicate (the `needs-tracked-confirm` return).

---

## `world.list`'s `legacy` kind now names a world that cannot boot

`listWorlds` (`packages/editor/src/daemon/worlds.ts`) classifies every directory under
`worlds/` as `kind: "field" | "legacy"`, on one test: does it have an `oplog.json` beside
its `manifest.json`? With one → `field`. Without → `legacy`.

`legacy` was accurate when it was written: it meant "a v1 world — real, loadable by the
game, just not editable, because `field.load` needs the oplog the editor writes". The
drawer says exactly that (`WorldDrawer.tsx`'s `LEGACY_REASON` — *"a v1 world: no oplog, so field.load
can't read it into the editor"*) and disables Open on those rows.

**Foundations T2 (2026-08-05) made that untrue.** The game's `loadWorld`
(`packages/dungeon/src/world/world-loader.ts`) now gates every manifest through
`isWorldManifest`, which admits `version: 2` + `kind: "field"` and nothing else, and
**throws** — `"...is not a world this runtime understands — re-bake"` — on anything that
fails. A `worlds/` directory with a manifest and no oplog is therefore not a v1 world the
game can still boot; it is a directory nothing in the repo can open. The word `legacy`
outlived the thing it named.

### This is a naming question, not a bug

The classifier's *mechanics* were deliberately left alone at T2 and should stay. It is a
live guard: it is what stops the drawer offering Open on a foreign or half-written
directory, and "manifest but no oplog" is still exactly the right test for that. Nothing
misbehaves today — a `legacy` row is correctly refused everywhere it appears.

What is stale is the vocabulary and the copy that explains it, in four places:

- `packages/editor/src/daemon/worlds.ts` — the `WorldRow["kind"]` union and the ternary in
  `listWorlds` that produces it.
- `packages/editor/src/frontend/lib/api.ts` — the client-side `WorldRow` type and its
  docblock ("`legacy` = a v1 world directory with a manifest but no oplog").
- `packages/editor/src/frontend/components/shell/WorldDrawer.tsx` — `LEGACY_REASON`, the
  `reason` ternary that selects it, and the `legacy` badge on the same row.
- `packages/editor/src/frontend/lib/world-actions.ts` — the `lastWorld` docblock, which
  lists `legacy` among the reasons a boot-reopen silently answers `null`.

The design question is which of these it becomes:

1. **Rename to what it now means** — `unreadable`, `unrecognized`, `foreign`. The badge and
   the reason line change with it. Honest, and the smallest change, but it broadens the
   name to cover directories that were never worlds at all, which may want its own row
   treatment rather than sharing one.
2. **Split the kind.** Distinguish "a v1 world we could migrate" from "not a world this
   build understands", if a migration path is ever wanted. Only worth it if migration is on
   the table — and after T2's v1 cut, it probably is not.
3. **Stop listing them.** If nothing can open a manifest-without-oplog directory, the
   drawer arguably should not show a disabled row for it at all. Cheapest UI, but it hides
   a directory the user may be looking for and wondering about, which is worse.

### Trigger to revisit

The next task that touches the world drawer's row rendering or `WorldRow`'s shape — all
four sites are in that blast radius and doing them apart costs more than doing them
together. Or, sooner: the first time someone reads a `legacy` badge and expects the world
to still work in the game, which is what the word now promises and no longer delivers.

### Reference

- `packages/editor/src/daemon/worlds.ts` — `listWorlds` and the `oplog.json` test.
- `packages/dungeon/src/world/world-loader.ts` — `loadWorld` and `isWorldManifest`,
  the gate that made `legacy` mean "cannot boot".
- `docs/reference/editor-architecture.md` §4 — the daemon's world verbs as-built.
