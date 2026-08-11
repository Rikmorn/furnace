# The human cannot tell where they are — no position readout, no way to go to coordinates

Filed at the T4c gate walk (2026-08-11) — the user's own finding, live.

## Context

The agent reported the cave at "x 4–7, y 11.5–14, z 11.5–15.5" and the user had no way
to act on it: the chrome shows no camera/pivot position, and there is no go-to-
coordinates affordance. The agent's spatial vocabulary (regions, ray probes, entity
footprints — all world-space numbers) is now a conversation the human is locked out of:
the two collaborators cannot exchange a location.

## The fix

Smallest honest: a camera/pivot position readout in the status bar (world-space, the
agent's coordinate language). Next rung: a go-to affordance (⌘K "go to x y z", or
click-a-coordinate in the entity inspector to frame it). A minimap is a design pass,
not this entry.

## Trigger to revisit

First editor-UX pass after T4 — and note it compounds with
[[entity-list-has-no-legible-order]]: either fix alone would have let the user find the
gate walk's cave.

## Reference

- `StatusBar.tsx` (the natural home). `docs/learnings/seals/2026-08-11-foundations-t4c-verbs-eyes-gate.md`.
