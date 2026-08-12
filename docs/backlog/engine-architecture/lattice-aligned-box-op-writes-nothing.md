# A lattice-aligned box op writes nothing and still answers ok

Filed 2026-08-12 from the sculpting-worlds cycle-2 E1 monastery run; validated and accepted at
that cycle's review the same day.

Sample writes are gated on a STRICT `sdf > 0` (`packages/core/src/field/ops.ts:598`,
`:608`, `:687`), and a box's SDF is `halfExtents[a] - |p[a] - center[a]|` (`:83`–`:87`).
A sample lying exactly ON a box face therefore scores 0 and is excluded. Both faces are
exclusive, so a box whose extent along an axis is a whole number of cells AND whose faces
land on the sample lattice contains **no samples on that axis at all** — the op writes
nothing, and still answers `{"ok": true}`.

Measured in that run, at the default 0.25 m cell: a fill with
`center [20.25, 2.125, 14]`, `halfExtents [0.5, 0.125, 0.5]` — i.e. y spanning exactly
`[2.0, 2.25]`, one cell — changed nothing. The evidence it changed nothing is that a prop
contact gap re-read afterwards was byte-identical (`0.2641420364379883` before and
after), and a ray confirmed the surface still sat at y = 2.0. Re-issuing the same intent
with `halfExtents[1] = 0.375` landed correctly.

The same mechanism silently biases ordinary carving: every box fill whose top face is
lattice-aligned produces a surface **one cell lower than its nominal `max`**. The run's
rock stair was built from such fills and came out uniformly 0.25 m low. It stayed
walkable only because every tread shifted by the same amount, so the risers were
unchanged — a shift that happened to cancel, not a shift that was safe.

This is the defect class `ops.ts` already names for patches ("a mutation verb must
actually mutate") and already REJECTS for zero extents — the TSDoc at `:245`–`:260`
documents the zero case in detail, including its silent-no-op and phantom-write legs. A
positive-but-lattice-aligned extent lands in the same place and falls through the
validation hole, because the guard tests the NUMBER (`positiveLength`) rather than
whether the resulting shape contains a sample.

Candidate fixes: refuse an op whose bounds enclose no sample (the existing stance,
extended from "zero" to "empty"); or report `dirty: 0` / a written-sample count back
through `edit_apply` so a no-op is at least visible to its caller — today `edit_apply`
answers a bare `{"ok": true}` with no write count, while `generate` does report
`dirtyChunks`.

**Trigger to revisit:** Next time an author reports a brush op that "did nothing", or the
next time `edit_apply`'s response shape is revisited.

**Reference:** `packages/core/src/field/ops.ts` (`:83`–`:87` box SDF, `:245`–`:260` the
zero-extent stance, `:598`/`:608`/`:687` the `sdf > 0` gates). Sibling:
`docs/backlog/editor-and-tooling/edit-apply-reports-nothing-about-what-it-wrote.md` — the
second candidate fix above, filed on its own because it closes a class rather than this
defect, and scheduled into the cycle-3 E0-equivalent set.
