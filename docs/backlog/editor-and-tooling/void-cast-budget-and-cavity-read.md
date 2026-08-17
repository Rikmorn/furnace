---
summary: the X-ray's 512-chunk budget refusal and its read from INSIDE a carved space have never been walked at a gate — the one field overlay whose render nothing has ever checked, on a measurement taken on bun/JSC rather than in a browser
---

# The void cast's budget refusal and its inside-the-cavity read have never been walked

*(Absorbed into the F4.5 capability-sweep register at T5, 2026-08-11 — the void cast is one of that sweep's own capabilities, and the unwalked half belongs beside the deferred column; the sweep's stage is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

Two questions about the X-ray view mode that only a gate can answer, and that no gate has:

**(a) the 512-chunk budget.** A world over `VOID_CAST_CHUNK_BUDGET` refuses, and since the
F3b fix round the refusal SAYS so rather than being silent. What nobody has done is hit it on
a real world and decide the follow-up: does the budget rise, or does the cast scope to the
current selection? The measurement behind 512 is `~630 ms–1.3 s` of worker time at that
ceiling depending on fill, on **bun/JSC** — and browser V8 is not JSC, so the number wants
re-measuring in the browser before it is moved either way.

**(b) the inside-the-cavity read.** The cast is designed for outside-looking-in:
`compare: "always"` makes it dominate every opaque surface, which is exactly the case the
tool exists for. From INSIDE a carved space the read is expected to be much weaker. If
inside-view turns out to matter, that is a render-design item (a second material, a
depth-aware variant) and not a toggle bug.

## Context

Both were filed as F3b gate round-2 watch items and never got their round 2: F3b sealed with
the void cast's pixels visually UNCONFIRMED (an accepted gate variance — round 1 predated the
visible-refusal fix, so the user could not distinguish refusal from silence), and the F4.5
holistic gate's script walks sculpting, stamps, props, flags and the bake-and-walk spine but
does not touch the X-ray at all. So the cast remains **the one field overlay whose render
nothing has ever checked**. The template for checking it exists — the advisor's marker layer
is pixel-confirmed by a committed, re-runnable recipe at
`packages/editor/scripts/analyzer-pixel-check.md`.

A third, related gap is filed separately and is a design question rather than an observation:
the cast monopolises the one field worker, has no cancel, and drops a toggle-off-then-on
instead of coalescing (`void-cast-monopolises-the-worker.md`).

## Trigger to revisit

**Either** a world large enough to trip the 512-chunk budget in normal use (F5's scale work
is the obvious candidate), **or** the first time somebody reaches for the X-ray while inside
a cavity and it does not answer. Cheap to take opportunistically: both are observations on an
existing build, not work.

## Reference

- `packages/editor/src/field-host/field-voidcast.ts` — `requestVoidCast`,
  `VOID_CAST_CHUNK_BUDGET`, the four refusals, `voidCastGen` / `voidCastJobGen`. (All of it
  lived in `field-host.ts` until foundations T3b1, 2026-08-06.)
- `packages/editor/scripts/analyzer-pixel-check.md` — the pixel-check recipe to copy.
- `docs/reference/editor-architecture.md` §14 (the void cast, its refusals and its lifetime).
- `docs/learnings/2026-07-21-invisible-line-overlays.md` — why "it is drawn" is not a claim to
  make from a green test suite.
