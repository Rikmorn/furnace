---
summary: on macOS's case-insensitive filesystem `worlds/Cavern` and `worlds/cavern` are one entry, but the save-as cue and the tracked-overwrite confirm are both exact-match, so typing `Cavern` against a listed `cavern` warns nobody and the write lands on the existing world
---

# Case-folding: `Cavern` overwrites `cavern` and the field says nothing

F4.5c Task 6 gave `NameForm` an OVERWRITE cue — type a name that is already taken and the
form says so *before* you commit, rather than leaving you to read an error toast afterwards.
It is wired to exactly one form, save-as, and deliberately: the prop is named `overwrites`
(the consequence) rather than "taken names", because save-as REPLACES while `world.rename`
and `world.duplicate` are refused outright by the daemon. Wiring the same set to those two
would promise an overwrite that never happens.

Two gaps survive that decision. This is the second; the first is
`rename-duplicate-teach-by-error-toast.md`.

## Context

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

## Trigger to revisit

A single user report is enough — this gap loses work silently. Or the next task that touches
`NameForm`'s props: the fix lands in that file's contract, and
`rename-duplicate-teach-by-error-toast.md` lands in the same place, so doing them together is
most of the saving.

## Reference

- `packages/editor/src/frontend/components/shell/WorldDrawer.tsx` — `NameForm`'s
  `overwrites` prop and the `overwrite` const's exact-match lookup; `:512` is the one form
  that passes a set.
- `packages/editor/src/frontend/lib/world-actions.ts` — the tracked-overwrite confirm's
  predicate (the `needs-tracked-confirm` return), which carries the same blind spot.
- `packages/editor/src/daemon/handlers.ts` — the `existsSync(worldDir(...))` collision check
  in the `world.rename` and `world.duplicate` handler bodies, and its
  case-insensitive-filesystem comment: the two verbs that get this right.
  `grep -n 'already-exists' packages/editor/src/daemon/handlers.ts` is the durable
  instrument; this entry has carried wrong line numbers for that file twice.
- `docs/reference/editor-architecture.md` §4 and §16.4 — the `world.*` verbs and the drawer
  that drives them, as-built.
