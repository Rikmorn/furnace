# The world-name commit cue has two gaps: rename/duplicate, and case-folding

F4.5c Task 6 gave `NameForm` an OVERWRITE cue — type a name that is already taken and the
form says so *before* you commit, rather than leaving you to read an error toast afterwards.
It is wired to exactly one form, save-as, and deliberately: the prop is named `overwrites`
(the consequence) rather than "taken names", because save-as REPLACES while `world.rename`
and `world.duplicate` are refused outright by the daemon. Wiring the same set to those two
would promise an overwrite that never happens.

Two gaps survive that decision.

## 1. Rename and duplicate still teach by error toast

Both handlers refuse a taken name with `already-exists`
(`daemon/handlers.ts:510` and `:540`), so the user types, submits, and learns from a red
toast. D-25's "the commit verb explains refusals" arguably wants a line in the field there
too — but it is a DIFFERENT line ("that name is taken" / the verb is refused), not the
overwrite warning, so it needs its own copy and its own prop rather than a second consumer
of `overwrites`. That is the design question this half is filed on.

## 2. Case-folding: `Cavern` overwrites `cavern` and the field says nothing

On macOS's default case-insensitive filesystem, `worlds/Cavern` and `worlds/cavern` are one
directory entry. The save-as cue is an exact-match `Set` lookup
(`WorldDrawer.tsx:103`, `overwrites.has(value)`), so typing `Cavern` against a listed
`cavern` shows no warning while the write lands on the existing world.

**Pre-existing and not this cue's fault**: the tracked-world confirm downstream has the same
blind spot for the same reason — it asks git whether `worlds/<typed name>` is tracked
(`lib/world-actions.ts:103`), and git's index is case-sensitive, so the differently-cased
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

## Trigger to revisit

Either half being reported by a user (gap 2 loses work silently, so a single report is
enough), or the next task that touches `NameForm`'s props — both fixes land in that file's
contract and doing them together is most of the saving.

## Reference

- `packages/editor/src/frontend/components/shell/WorldDrawer.tsx` — `NameForm`'s
  `overwrites` prop and the docblock stating why rename/duplicate must not pass one; `:512`
  is the one form that does.
- `packages/editor/src/daemon/handlers.ts:500-540` — the `existsSync` collision check and
  its case-insensitive-filesystem comment.
- `packages/editor/src/frontend/lib/world-actions.ts:98-104` — the tracked-overwrite
  confirm's predicate.
