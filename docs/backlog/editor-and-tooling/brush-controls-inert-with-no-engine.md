---
summary: in `no-webgpu` / `engine-error` the shell still renders the rail and top strip fully interactive over a host that will never exist, so they absorb every press in silence — a presentation decision owed to every host-backed control at once
---

# The brush controls are permanently inert with no engine, and say nothing about it

In the `no-webgpu` and `engine-error` states the editor still renders its whole chrome —
`App.tsx` renders `<Shell />` unconditionally — but `status` never reaches `ready` and
`fieldHostRef.current` is never assigned. The tool rail and the top strip therefore render
fully interactive and absorb every click in silence.

## Context

Foundations T3b2 Task 6 made this visible rather than causing it. Before it, the chrome held
`tool` and `radius` in provider cells, so a click MOVED the strip while `host?.setTool`
no-opped — a control that looked alive over a host that did not exist. The tool seam's
conversion removed the cell, so the strip now shows the truth (nothing armed, nothing
changing). That is the right ANSWER and the wrong PRESENTATION: a permanently dead control
should say it is dead rather than swallow presses.

The same window exists during a normal boot, for the length of the engine-bundle load. That
one is short enough to accept and is documented as a delta
(`docs/reference/editor-architecture.md` §22.8). This entry is only about the states the
window never closes in.

## What it is not

Not the tool seam's problem. The seam is a state mirror over a host, and with no host there
is no state to mirror. Whatever is done here belongs to the SURFACES — the rail, the strip,
and whatever the status bar already says about the failure — and it is a presentation
decision (disable? explain? a single banner?) that should be made once for every host-backed
control at the same time, not one control at a time.

## Trigger to revisit

Either of:

- the next pass over the editor's failure/empty states, or anything that touches what the
  status bar says about `no-webgpu` / `engine-error`;
- a report of someone clicking brush controls on a machine without WebGPU and not
  understanding why nothing happens.

## Reference

- `packages/editor/src/frontend/components/App.tsx` (the unconditional `<Shell />`, the two
  failure dispatches)
- `packages/editor/src/frontend/hooks/useFieldHostState.tsx` (`FieldShell.host`'s docblock,
  which states the superseded "a control that silently did nothing … is a dead control"
  principle and what replaced it)
- `docs/reference/editor-architecture.md` §22.8, delta 2
