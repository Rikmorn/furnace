---
summary: `CanvasHost.tsx` holds the WebGPU lifecycle AND the viewport focus seam's two capture-phase window listeners, which share only the canvas element — extracting the second would let the recorder be pinned without mounting a whole Shell
---

# The viewport focus seam could leave `CanvasHost`

`CanvasHost.tsx` now holds two unrelated jobs. The first is what it has always been: the
WebGPU lifecycle — measure the canvas, `host.init`, the chained deferred dispose, the AA
re-init. The second arrived with F4.5c Task 10: the viewport FOCUS seam — two capture-phase
window listeners that record whether the canvas held focus at the start of each gesture, and
the `ViewportFocus` object (`focus`, `heldFocusAtGestureStart`, `carryGestureOrigin`) it
installs on the editor context for every overlay's close handler to read.

They already sit in separate effects, and deliberately so: the GPU effect re-runs on an AA
change, the focus effect must not. But that is the tell — the second effect depends on
nothing the first one owns except the canvas element.

## Context

Raised in Task 10's quality review and deferred there on purpose: the same round was already
carrying a behavioural fix (the hand-off), and a structural move on top of it would have made
the diff hard to reason about.

The shape, if it is taken: a `useViewportFocusSeam(canvas)` hook beside
`useViewportFocusReturn.ts`, taking the element and owning the listeners, the record and the
installed object. `CanvasHost` would keep the ref and one call. The two would then read as
what they are — a GPU host and a focus seam that happen to be about the same element.

What it buys is testability more than tidiness: the recorder is currently only reachable
through a mounted Shell with a stubbed `getBoundingClientRect`, so
`tests/chrome/viewport-focus-return.test.tsx` drives every recorder case through the whole
chrome. A standalone hook could be pinned directly, and the Shell cases could shrink to the
integration claims that actually need a Shell.

## Trigger to revisit

`CanvasHost.tsx` growing a THIRD concern, or the focus seam growing a fourth member. Either
is the point at which the file stops being "the canvas" and starts being a bag.

**The Task 15 conditional resolved NEGATIVE (2026-08-02).** That task was doc, gate and
backlog work; it did not touch `CanvasHost.tsx`, so the "while you are in there anyway"
opening did not arrive. Both conditions above are still unmet — the file holds two concerns
and `ViewportFocus` still has three members — so the entry stands unchanged.

## Reference

- `packages/editor/src/frontend/components/shell/CanvasHost.tsx` — both effects, and the
  comment on the second saying why they are separate.
- `packages/editor/src/frontend/components/editor-context.ts` — `ViewportFocus`, the seam's
  contract.
- `packages/editor/src/frontend/hooks/useViewportFocusReturn.ts` — the consumer half, which
  is already its own module.
