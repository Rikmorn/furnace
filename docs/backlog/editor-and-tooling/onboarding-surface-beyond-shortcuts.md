---
summary: the editor can say what every KEY does and nothing about what to DO — no surface answers "I have just opened this, what is the loop?" — and the three candidate shapes (static page, first-run tour, contextual empty states) are not equivalent
---

# A usage / onboarding surface, beyond the shortcuts overlay

The editor can now tell you what every KEY does. It cannot tell you what to DO. There is no
surface that answers "I have just opened this — what is the loop?", and the user asked for
one at the F4.5 holistic gate.

The shortcuts overlay (`?`, or Help ▸ Keyboard shortcuts) renders the action registry, so it
is complete and cannot go stale — but it is a reference, organised by binding, and a
reference is the wrong shape for a first session. The command palette (⌘K) is random access
by name, which needs you to already know the name. Between them there is nothing that says:
dig with the brush, stamp a room, scatter props, read the flags, save-as, make default, bake,
walk it.

## Context

Requested by the user at the gate and deliberately not built in the fix round: the `?`
binding landed there and partially serves the ask, and a usage surface is a content
problem with a design decision in front of it, not a mechanism gap. Three shapes are
plausible and they are not equivalent:

- **a static help panel** — one authored page, cheapest, and the one that goes stale, since
  nothing checks prose against the app.
- **a first-run tour** — highest cost, most likely to annoy on the second run, and it needs a
  dismissal-persistence decision (the workspace blob is where it would live).
- **contextual empty states** — the entities palette on a world with no entities, the flags
  palette before the advisor has run, the canvas on an untitled world. This is the one that
  cannot go stale, because each surface teaches only its own next step, and the F4.5c "first-run
  hint" on the world name is the precedent already in the build.

Worth noting what the editor already does say, so a new surface does not duplicate it: every
refusal states its reason on press (`notify.sayRefusal`), the status bar's keymap line names
the four keys that matter in the armed mode, and every available control's tooltip carries its
own chord from the registry.

## Trigger to revisit

**A second person uses the editor**, or the user asks again after living with `?` for a
while. Until then the audience is one developer who built it, which is the worst possible
population to design onboarding against.

## Reference

- `packages/editor/src/frontend/components/shell/ShortcutsDialog.tsx` — the reference surface
  that exists; `shell/CommandPalette.tsx` — the by-name route.
- `packages/editor/src/action-registry/descriptors.ts` — the authored one-sentence `hint`s
  (optional member; 27 of the 39 rows carry one), which is authored content a usage surface
  could reuse rather than re-write.
- `docs/reference/editor-architecture.md` §18.5 (the palette and the overlay), §18.4 (what the
  chrome already says at the point of refusal).
- `packages/editor/PRODUCT.md` — "capability per pixel"; a permanent help surface has to earn
  its space against that.
