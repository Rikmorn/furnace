---
summary: `edit_apply` answers a bare ok, so a brush op that changed zero samples is indistinguishable from one that worked
consumer: door-set
---

# `edit_apply` reports nothing about what it wrote

Filed at sculpting-worlds cycle 2's review (2026-08-12), from that cycle's E1 monastery run.

`edit_apply` answers a bare `{"ok": true}` — no dirty-chunk count, no written-sample count, no
touched bounds — while `generate`, the sibling write verb, reports `dirtyChunks`
(`generate` in `packages/editor/src/field-host/field-mutation.ts`, `dirtyChunks:
committed.dirty.size`). **A write that changed zero samples is indistinguishable from one that
worked.**

That asymmetry is not theoretical: it is exactly how the lattice-aligned no-op in
`docs/backlog/engine-architecture/lattice-aligned-box-op-writes-nothing.md` went undetected in
the run. A fill whose faces landed on the sample lattice wrote nothing, answered `ok`, and was
caught only because an unrelated prop-contact measurement came back byte-identical
(`0.2641420364379883` before and after). The same run carried a systematic one-cell fill bias
through **~66 hand-computed box ops** for three staircases without noticing, for the same
reason — nothing the write path returns could have contradicted the caller's arithmetic.

The general form: **every write verb should report what it wrote.** A count is enough; bounds
are better. It is the cheapest possible check on a caller's own model of the world, and its
absence means an agent's only feedback loop on a batch of ops is to re-measure the field
afterwards — which costs door calls, and which the read surface is itself bad at
(`field-read-surface-gaps.md`, *a ray answers only the FIRST hit*).

Editor-local by classification (the door's response shape and `shared/wire.ts`), with one core
leg: `ops.ts` would have to return a written-sample count for the answer to carry one, which is
the second of the two candidate fixes the lattice-aligned entry names. The first — refuse an op
whose bounds enclose no sample — is core-only and would close the specific defect without
closing this entry.

**Trigger to revisit:** **`door-set` planning takes this as its E0-equivalent** (ruled by the
owner at cycle 2's close, 2026-08-12). Sooner if `edit_apply`'s response shape is revisited for
any other reason, or the next time an author reports a brush op that "did nothing".

**Reference:** `packages/editor/src/field-host/field-mutation.ts` (`dirtyChunks` on `generate`
— the precedent this verb lacks); `packages/editor/src/daemon/mcp.ts` (the
`edit_apply` row); `docs/backlog/engine-architecture/lattice-aligned-box-op-writes-nothing.md`
(the defect this would have surfaced, and the core leg);
`docs/learnings/2026-08-12-agent-world-building-cycle-2.md` §5. Siblings:
`docs/backlog/engine-architecture/field-read-surface-gaps.md` and
`advisor-answers-volume-not-questions.md` — the other three of that run's four small items.
