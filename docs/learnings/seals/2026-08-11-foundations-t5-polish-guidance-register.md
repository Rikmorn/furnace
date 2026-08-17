---
summary: Foundations T5 — polish, guidance, and the register · THE PROGRAMME CLOSES — *live Chromium walk; Safari waived to daily use; audit 150/10/1 keep-by-default; register 169→101, one closure; four ratifications at close*
sealed: 2026-08-11
seq: 33
---

# Foundations T5 — polish, guidance, and the register · THE PROGRAMME CLOSES

- **Sealed:** 2026-08-11 — the foundations programme's closing tranche (T1a → T5, all
  merged).
- **Package(s):** core, editor (dungeon: one README pointer line only).
- **Gate:** executor-driven LIVE Chromium walk (`bun run dungeon:editor` + the real MCP
  door over JSON-RPC — nine tools on the live daemon, 0 console errors, every polish
  behaviour probed against its T4c counterpart). **The user Safari walk was WAIVED to
  daily use by ruling (2026-08-11)** — accepted on the small non-render surface (list
  order, location chip, refusal wording); this seal does NOT record a passed Safari
  gate, and the T4-transferred dig/paint/bake + AA eyeballs remain with daily use too.
- **Suite:** 3,225 pass / 1 skip / 0 fail across 371 files (`bun test` from root —
  measured independently by the review's reviewer at `a15c74ef` and re-measured at the
  review session's own run).

**Counts, computed:** 13 commits `2e2b01cd..1feb9ef5` FF-merged to master
(`git log --oneline 2e2b01cd..1feb9ef5 | wc -l`); 190 files, +7,321/−3,989
(`git diff 2e2b01cd..1feb9ef5 --stat | tail -1`); register 173 at branch → 103 at close
(`git ls-tree -r --name-only HEAD -- docs/backlog | grep '\.md$' | grep -v README | wc -l`),
+1 filed at this review (`build-cycle-gate-cost.md`) → 104 at seal.

**The tranche.** No new capability, by design. The T4c gate walk's six filings close:
inert refusals name the ENABLING CONDITION (`inertHint`, 15 of 39 rows; `enabled`
widened to `(ctx, input?)` so a named entity is not refused before the run that would
honour it); `view.frame` returns the host's verdict instead of discarding it (third
host seam, `answeredByHost`); the entity list sorts newest-first and states the
contract in its tooltip (ids mint in commit order, gaps are brush ops); the status bar
carries a world-space location — the SELECTION's box, honestly NOT the camera's pivot
(`CameraPose` is `{yaw,pitch}`; the entry stays, narrowed to that named gap).
`session_query` grows three arms → five: `generators` relays the registry so an agent
can TUNE and not just call; `entities` slims + `entityTotal`; `entity {entityId}`
carries the detail — no numeric cap anywhere, the split IS the size answer. Door still
NINE tools; instructions 1,970/2,048 B; row prose 7,502/8,192 B — **the 690 B of prose
headroom, shorter than six of the nine rows, is now the binding constraint on a tenth
tool, not the ceiling of ten.** Guidance became tracked (four §Design rules, two
§Discipline lines, seals/README §Writing a seal — which this seal is written to — and
the `tranche-review` skill, used for the first time on this very close). Two stances
became machinery (`field-host-boundaries.test.ts` — the import graph measured for the
FIRST time, 21 seam modules, one standing value edge asserted exact;
`harness-conventions.test.ts`). Two rulings with evidence: the root whole-workspace
gate STAYS (the per-package fallback measured NOT to cover the workspace — 2 files in
neither list), and `ToolDefinition.build` RETIRED because its question conflated two
registries (§23.4 binds `ToolId` n=2, not the nine MCP rows). The core surface got its
keep-by-default classification audit: **418 names, 161 zero-consumer → 150 keep / 10
cookbook-debt / 1 delete** — the one delete a `_`-convention leak relocated behind
`registry/internal.ts`, and the `_`-prefix guardrail it cites found HOLED for
single-line exports and fixed in the same commit. The register consolidated 169 → 101
with exactly ONE closure (`region-recipe-as-truth`, net zero — residual re-filed) and
nothing else lost.

**Review + rulings (this session, 2026-08-11).** Independent reviewer:
**CLOSE-WITH-MINORS** — all three gates green from root, all 8 exit clauses verified
(clause 7 PARTIAL exactly as self-declared), all four of the executor's own attack
points held under direct verification (the prune sample 10/11, the `enabled` delta
pinned, `frameSelection` single-voiced on both paths, the guardrail sabotage), three
sabotages redded and restored sha256-identical. Three minors — all documentation count
staleness, the tranche's own three-numbers-one-fact instance — fixed at `1feb9ef5`.
**User rulings at close:** Chromium walk ACCEPTED, Safari transferred to daily use ·
all four ratifications GRANTED (threshold relaxation as provisional; the one closure;
the gate stays whole; `build` retired on the third shape) · `EDITOR_PROJECTION`
seam→seam value edge KEPT as the measured residual (the parked
`field-host-internals.md` deferral owns the eventual fix).

**Orphaned surface: none.** The audit's one deletion was a relocation with its caller
repointed in the same commit; the prune deleted register files, not exports.

**Did any file grow disproportionately this slice? Yes — `docs/reference/
editor-architecture.md`**: +520 lines in the close commit alone (`ddb49283`), now 6,603
lines — the largest tracked doc in the repo by 2.4×. Named here per the rule this
tranche wrote; the scheduled docs-strategy session owns the question of whether
reference-doc growth is the register disease one level up.

**THE FOUNDATIONS PROGRAMME CLOSES.** T1a tiers → T1b registry → T2 the deletion →
doors → T3a–d the facade → T4a–c the agent door → T5 polish, guidance, and the
register. **The queue after it, ruled at this close:** (1) **3b — the agent
world-building skill** (`packages/editor/.claude/skills/`, own brainstorm + external
research session; "how to fully use the editor to build convincing worlds"); (2) **the
tooling session** — doc strategy (organisation, tooling, guidance;
`docs-registers-findability.md`) PAIRED with build-cycle speed
(`build-cycle-gate-cost.md`), before returning to the main epic; (3) **undo +
attribution** (one wire-format design pass, ruling 2026-08-09); (4) **F5 "scale"**.
