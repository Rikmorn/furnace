---
summary: rung 5 executed — canon's genre + naming contracts finished, 32 merged trackers un-merged into 186 one-record entries, editor-architecture.md rewritten into a 17-file shard with 40 live falsehoods retired, seals index generated, freshness block live; the immutability rule refined (claims frozen, pointers repaired) and the instrument class named
sealed: 2026-08-18
seq: 40
---

# Genre contracts (rung 5) — the registers get their contracts, and the instruments get audited

- **Sealed** — 2026-08-18
- **Package(s)** — root docs + `scripts/` carry the substance; editor, core, cookbook,
  dungeon touched at citation/comment level (plus one dungeon test's report template)
- **Gate** — `bun run check` · `bun run typecheck` · `bun run test` · `bun run test:serial`,
  identical lanes; independent reviewer verdict PASS-WITH-MINORS (one minor, fixed on the
  branch), two sabotage re-runs restored byte-identical, tree-clean proof quoted
- **Suite** — 3402 pass / 1 skip / 0 fail, 3403 tests / 378 files, both lanes
  (`bun run test` · `bun run test:serial`); the skip is the standing capability gate

23 commits, 418 files, +15,527/−15,437 (`git diff --shortstat eb4316dd..ba5ef97a`).

## What sealed

**The docs system's contracts are finished and checked.** Canon §2 carries the boundary
test (true now → reference · happened → learnings/research · to do → backlog · doing →
work) and per-genre contracts: shelf filenames dated + pattern-checked, research Fed
lines checked, seals carry `summary:`/`sealed:`/`seq:` and their index is GENERATED —
the repo's last hand-maintained per-entry index is gone. §5 carries the naming contract:
epic (directory) → slice (file) → task (the only ordinal tier); content-names, synonyms
retired (rung/wave/tranche/cycle/phase/letter-digit codes), guidance under D8 with a
reopening trigger. The slice renamed itself as the first test case
(`docs-system-rung-5` → `genre-contracts`; also `f5-scale` → `huge-worlds`).
`verified:` stamps went live with sitrep's freshness block as their consumer.

**The register's unit rule is now real: 32 merged trackers → 186 one-record entries**
(backlog 128 → 285 at seal; the count RISING is the motion working — owner ruling; the
scale measurement is handed to the findability charter, which owns re-derivation).
Receipts-before-deletion saved live content twice: `carvePlan` (classified dead, alive in
core with a stringly-typed seam — filed) and two falsified "dead" claims in the one
deleted entry. The five `consumer:`-claimed charter inputs were excluded by ruling and
survived untouched.

**`editor-architecture.md` (6,822 lines) died into `docs/reference/editor/` — 17
subsystem files + generated index, every one `verified:`-stamped.** It was a REWRITE,
not a move: the line-by-line pass found **40 live falsehoods** (8 mapped + 32 found
reading), including the repo's most-read file citing a doc that refuted its own claim.
~477 references re-pointed across 107 citing files; the annals died into their 13 seals
— except the measurements live constants rest on, which seals do NOT carry (the
`ANALYZER_IDLE_MS` case); the receipts rule that emerged: **seal → drop; source → cite;
neither → dated snapshot.**

**The immutability rule refined (owner, 2026-08-18): seal CLAIMS are immutable; a
POINTER broken by a later move is repaired.** 16 repairs across 12 seal files, audited
word-level — the one claim-side token is a disclosed `is`→`are`. This seal's own commit
repaired the three citations its own event dangled (the rungs-1-4 seal ×2, the charter),
found by SIMULATING the seal event rather than predicting it.

## Process findings (detail in the archived execution report, 2026-08-17/18)

- **The instrument class — seven instances:** coarse regex, line-based grep over wrapped
  phrases, substring markers, filename-anchored citation scans, a self-built similarity
  detector (autojunk false-clean), an unrun classification net, and punctuation-assuming
  verification greps. *An instrument that exists and is not re-run is indistinguishable
  from a broken one; a report can be wider than its instrument.* Ruled into
  working-standards: positive controls for self-built instruments; one instrument for
  before/after figures.
- **The checkpoint loop caught the reviewer repeatedly** — including a planner-licensed
  move that would have overwritten a correct doc with a stale signature (defect 40, the
  only one with a delivery mechanism). "The batch was accepted" is not "this deviation
  was ratified" — the back half's per-item verdicts were reconstructed at close.
- **Enumerations falsify silently when the enumerated thing grows** — twice in this
  slice, once within hours, between two tasks of one plan.
- Four unguarded citation surfaces measured by probe (AGENTS.md, `packages/`, seals,
  bare basenames) — filed: `backlog-citations-from-packages-are-unchecked`,
  `bare-line-refs-escape-the-citation-check`.

## Growth + orphans

`docs/backlog/` 128 → 285 by design. `scripts/check-docs.ts` + `docs-index.ts` grew the
three new checks with tests (suite +62). No `@furnace/core` export orphaned — a docs
slice; the one API-adjacent edit is comment/TSDoc-level.
