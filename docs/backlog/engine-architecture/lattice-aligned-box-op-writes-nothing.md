---
summary: a box fill whose faces land exactly on the sample lattice writes nothing into already-solid cells and still answers ok
consumer: door-set
---

# A lattice-aligned box op writes nothing and still answers ok

Filed 2026-08-12 from the sculpting-worlds cycle-2 E1 monastery run; validated and accepted at
that cycle's review the same day.

A box's SDF is `halfExtents[a] - |p[a] - center[a]|` (`shapeSdf`'s box branch), so a sample
lying exactly ON a box face scores **0**. A box whose extent along an axis is a whole number
of cells AND whose faces land on the sample lattice therefore has every sample on that axis
sitting at `sdf == 0` — and at `sdf == 0` the write predicates in `applyOp`
(`packages/core/src/field/ops.ts`) decline, so the op writes nothing and still answers
`{"ok": true}`.

**The write gates, per leg — re-derived from source 2026-08-12.** The entry originally said
all writes are gated on a strict `sdf > 0`. That is true of only some of them, and the
difference matters to anyone fixing this:

| leg | predicate at `sdf == 0` | writes? |
| --- | --- | --- |
| `fill` density | `writeD = nd < d`, and `nd = clampInt8(-0 × DENSITY_SCALE) = 0` | only if the cell is currently air (`d > 0`) — **not** against already-solid density |
| `fill` material | `writeM = sdf > 0 && …` | never — this one IS the strict test |
| `paint` | `if (sdf <= 0 \|\| d >= 0) continue` | never — strict test |
| `dig` | `nd = clampInt8(0)`, then `if (nd <= d) continue` | yes, on a solid cell (`d < 0`) — dig is **not** gated on `sdf > 0` at all |

So the measured "writes nothing" outcome is the conjunction of two different refusals, not
one: the material write refuses because it tests `sdf > 0` strictly, and the density write
refuses because `0 < d` is false against a floor that is already solid. **The defect is
therefore narrower than the title suggests** — a lattice-aligned fill into AIR does write
(a zero-density surface). The repro below fills against an existing floor, which is the
case that silently does nothing.

`applySmooth` is a separate function and its behaviour at `sdf == 0` has NOT been
re-derived; the original entry asserted it and that assertion is unverified.

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
actually mutate") and already REJECTS for zero extents — `assertShapeValid`'s TSDoc
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

**Reference:** `packages/core/src/field/ops.ts` (`shapeSdf`'s box branch for the box SDF,
`assertShapeValid`'s TSDoc for the zero-extent stance, and the `sdf > 0` gates in
`applyOp`'s fill/paint legs and in `applySmooth`). Sibling:
`docs/backlog/editor-and-tooling/edit-apply-reports-nothing-about-what-it-wrote.md` — the
second candidate fix above, filed on its own because it closes a class rather than this
defect, and scheduled into the `door-set` E0-equivalent set.
