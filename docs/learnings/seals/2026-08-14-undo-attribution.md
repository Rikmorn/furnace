---
summary: Undo + attribution — the fence lifts behind an ownership guard, and the wire learns who — *injected; oplog v4 (`origin?: string`, absent = human — the migration IS the default); every committing path stamps two altitudes; compaction folds stop at origin boundaries; fence → tab-side guard promising AGENT-AUTHORED (the mechanism's true word); `session.confirm` unstamped + tripwired; door headroom 200, tenth row unaffordable — door-set opens with the re-derivation*
sealed: 2026-08-14
seq: 39
---

# Undo + attribution — the fence lifts behind an ownership guard, and the wire learns who

- **Sealed** — 2026-08-14
- **Package(s)** — core, editor
- **Gate** — headless: `bun run check` · `bun run typecheck` · `bun run test` ·
  `bun run test:serial` (identical on every figure, the close standard's stop condition
  never fired at any task); independent single-reviewer verdict PASS-WITH-MINORS with two
  sabotage re-runs restored byte-identical; Safari waived by owner ruling — no visual
  surface, MCP flows pinned headless end-to-end
- **Suite** — 3340 pass / 1 skip / 0 fail, 3341 tests / 378 files, identical in both modes
  (`bun run test` · `bun run test:serial`); the skip is the standing capability gate

Eleven commits, 42 files, +2227/−347 (`git diff --stat c776e926^..f16771ec`); the last
two are planner-added scope (the confirm tripwire, the guarantee-wording fix), the final
one the review round's minors.

## What sealed

**The oplog is v4 and every op can say who authored it.** `origin?: string` on all four
op kinds, ABSENT = human — so human ops are byte-identical with v3, all nine committed
world oplogs (5×v3, 4×v1 bare-array) parse unchanged, and no file was rewritten: the
absent-means-human rule IS the migration. `parseOps` reads v1–v4; the writer emits v4
only. Every committing path stamps op (durable) and pushed entry (volatile) from one
parameter; `redo`'s recapture carries the entry origin; core `undo`/`redo` stay
policy-free. Compaction folds stop at origin boundaries and a uniform fold inherits its
run's origin — measured as load-bearing, not theoretical: four committed worlds are 100%
foldable (`compactableOps` probe, spec §8 table), so an origin-blind fold would have
erased attribution wholesale.

**The agent undo fence died and an ownership guard replaced it.** `FENCED_ACTIONS` is
gone; `edit.undo`/`edit.redo` refuse an agent-origin dispatch unless
`FieldHost.topEntryOrigin(stack)` matches, class `inert`, human ⌘Z untouched. The guard
is tab-side and state-dependent where the fence was daemon-side and static — the
stale-tab residue is accepted on TWO facts (single-user loop; an errant step is
non-destructive, the entry moves to the other stack), and explicitly NOT on
`bundle-outdated`, whose watcher covers consumer extension source only. That third
"mitigation" was a false claim in the APPROVED PLAN, propagated into a docblock, and
caught because the executing agent verified a handed claim instead of quoting it —
the slice's standing process lesson, now beside the sabotage one: **a green suite is not
evidence a sabotage landed; read the sabotaged text back before believing the run.**

**The guard promises exactly what the mechanism holds: AGENT-AUTHORED, not "your own".**
One shared `AGENT_ORIGIN` tag and a door that admits two agents through one claim means
concurrent agents are indistinguishable; the refusal message, the door row and the
`undoAgentAuthoredOnly` pin all state the weaker true word, and the pin's comment is
where the promise upgrades WITH per-claim tags if they land (filed:
`per-claim-origin-tags`). `session.confirm` commits stay UNSTAMPED whoever triggers them
— mixed authorship (human stages, agent triggers) is unruled, the conservative default
keeps the forbidden direction closed, and the tripwire in `field-host-move.test.ts` reds
any casual threading (filed: `whose-work-is-a-confirm`). Stamping lives at the tab's
answerer seam, a ratified plan-time deviation from the spec's daemon-stamping: the
backchannel's only producer is the daemon's handler module, so the seam sees agent
traffic by construction (premise verified by grep at execution AND at review; its
conventional half is filed: `chrome-mutating-verb-premise-unpinned`).

**The door's prose budget is now the next slice's first move.** The confirm explainer
plus the wording fix cost 126 bytes; the row total is 7,992 against the unbumped 8,192
ceiling (derivation method documented beside the pin), headroom 200 — shorter than every
standing row, so a tenth tool is unaffordable without a re-derivation. Door-set opens
there, by ruling recorded in the archived execution report.

## Cross-seal note

The fence message that named this slice as its lift condition is deleted with the fence;
`docs/reference/editor/agent-door.md` §"Attribution — the origin tag, and what an agent
may undo" and §"What the door does NOT do" are the as-built (guard + corrected residue
bound, confirm posture, ruled non-goals). Six backlog entries filed at this seal — the two
above, the seam pin, `op-origin-stamp-helper-rule-of-three`,
`compact-threshold-under-mixed-authorship`, `entities-palette-bypasses-action-registry`.

## Orphans and growth

No exports orphaned — `FENCED_ACTIONS`/`fenceMessage` were module-private and died with
their module's fence block; every new name (`topEntryOrigin`, `AGENT_ORIGIN`,
`stepsOwnWork`) shipped with consumers. Largest growths (`git diff --stat
c776e926^..f16771ec`, sorted): `mutation.test.ts` +211 (the module harness the volatile
pins required), `editor-architecture.md` +204 (§29 plus the §27.5 amendments), and
`actions.test.ts` +152 — test and reference weight in proportion to a slice whose
subject was making claims checkable; no source file grew disproportionately (the largest,
`actions.ts` +103, is the guard plus its docblock).
