---
summary: `world.rename` and `world.duplicate` refuse a taken name with `already-exists`, so the user types, submits and learns from a red toast — the in-field line D-25 wants there is a DIFFERENT line from the overwrite warning and needs its own copy and its own prop
---

# Rename and duplicate still teach a taken name by error toast

F4.5c Task 6 gave `NameForm` an OVERWRITE cue — type a name that is already taken and the
form says so *before* you commit, rather than leaving you to read an error toast afterwards.
It is wired to exactly one form, save-as, and deliberately: the prop is named `overwrites`
(the consequence) rather than "taken names", because save-as REPLACES while `world.rename`
and `world.duplicate` are refused outright by the daemon. Wiring the same set to those two
would promise an overwrite that never happens.

Two gaps survive that decision. This is the first; the second is
`world-name-case-folding-overwrites.md`.

## Context

Both handlers refuse a taken name with `already-exists` — the `throw new EditorError
("already-exists", …)` inside `handlers.set("world.rename", …)` and
`handlers.set("world.duplicate", …)` in `daemon/handlers.ts` — so the user types, submits, and
learns from a red toast. D-25's "the commit verb explains refusals" arguably wants a line in the field there
too — but it is a DIFFERENT line ("that name is taken" / the verb is refused), not the
overwrite warning, so it needs its own copy and its own prop rather than a second consumer
of `overwrites`. That is the design question this half is filed on.

## Trigger to revisit

Either this being reported by a user, or the next task that touches `NameForm`'s props — the
fix lands in that file's contract, and `world-name-case-folding-overwrites.md` lands in the
same place, so doing them together is most of the saving.

## Reference

- `packages/editor/src/frontend/components/shell/WorldDrawer.tsx` — `NameForm`'s
  `overwrites` prop and the docblock stating why rename/duplicate must not pass one.
- `packages/editor/src/daemon/handlers.ts` — the `already-exists` throws in the
  `world.rename` and `world.duplicate` handler bodies. **Cited by SYMBOL rather than by line,
  deliberately**: this entry has now carried wrong line numbers twice (`:500-540`, then
  `:316-373`/`:339`/`:369` — the T4b re-cite that was meant to fix them landed ~29 off,
  `:339` being a comment and `:369` sitting inside `dispatch`).
  `grep -n 'already-exists' packages/editor/src/daemon/handlers.ts` is the durable
  instrument; the file's line numbers move whenever the registry gains or sheds a family, and
  it shed one to `session-handlers.ts` in T4b.
- `docs/reference/editor/commands.md` and `docs/reference/editor/world.md` — the `world.*` verbs and the drawer
  that drives them, as-built.
