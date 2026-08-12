# `MazeParams.cells` has no upper bound — a fat-fingered knob value hangs the tab

**Context:** Surfaced in the W3 Task 4 review. `maze()` in `packages/dungeon/src/themes/maze.ts` (gone)
validates that `cells` are integers `>= 2` but imposes NO ceiling. Cost grows quadratically in
the footprint and the fine grid multiplies it again: `cells: [200, 200]` yields coarse dims
`[1001, 8, 1001]` ≈ 8M coarse cells, which `rasterize` (`substrate/grid.ts`, `SUB` = 2 per axis)
expands to ≈ 64M fine cells — a 64 MB `Uint8Array` — before skinning and collider extraction even
start. No budget guard, no deadline, no fail-fast. That is squarely against working-standards
§Planning ("search systems get budgets on day one"; ceilings ship in the same task, not as later
hardening).

This has no live consumer today — every `maze()` call site is a test or a hand-authored spec. It
becomes real the moment W3's World panel (the editor half) exposes `cells` as a user-editable
knob: a typo in a number field becomes a hung tab with no cancel path.

Proposed fix, either or both: (a) a setup-loud cap inside `maze()` — the VALUE is a design
decision, not a mechanical one (it needs a measured cost-per-cell probe to land somewhere
defensible rather than arbitrary), so this is not an inline fix; (b) a clamp in the World panel's
knob schema, which bounds the interactive path but leaves the API itself unguarded.

**Trigger to revisit:** BEFORE the World panel ships the `cells` knob (the W3 editor half).
That is the point where an unbounded generator parameter reaches a user's fingers.

**Reference:** `packages/dungeon/src/themes/maze.ts` (gone) (`maze()` validation block, `PITCH`,
`PASSAGE_CELLS`), `packages/dungeon/src/substrate/grid.ts` (gone) (`rasterize`, `SUB`).
`.claude/rules/working-standards.md` §Planning ("search systems get budgets on day one").
Compare `LayoutBudget.deadlineMs` (Slice 3.2.3) — the precedent for a measured, fail-fast
generator budget. Filed 2026-07-12 from the W3 Task 4 review.
