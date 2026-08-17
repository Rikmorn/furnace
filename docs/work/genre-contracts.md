---
status: in-flight
summary: finish the genre contracts — un-merge the merged trackers, split editor-architecture.md, trim AGENTS.md §Deferred work
---

# Genre contracts — the motion the checks were landed to protect

Rungs 1–4 shipped 2026-08-12 (sealed; canon at `docs/reference/docs-system.md`). Rung 5 was
excluded from that slice **by design**: it is the only rung that MOVES existing content, and
the argument was that detection should exist before the motion it protects. It now does —
`bun run check` fails on dead paths, `file:line` citations, derive drift, frontmatter
violations, index staleness and work-register inconsistency, so a bulk move that breaks a
citation cannot land silently.

**Three motions:**

1. **Un-merge the merged trackers.** The register's stated unit is one record per file, and
   the merged tracker (one H1 naming a subsystem, a body carrying many independent items) is
   the shape that violates it. Consolidation as a *move* is retired — a merged view is
   generated now, never a merged file.
2. **Split `docs/reference/editor-architecture.md`.** It is the repo's largest reference doc
   and carries several distinct subjects.
3. **Trim `AGENTS.md` §Deferred work.** Rungs 1–4 corrected the statements they falsified and
   deliberately did no more; the section still restates canon that `docs-system.md` now owns.

## Demand evidence — two measurements taken during rungs 1–4 (2026-08-12)

Both are **dated snapshots** of a state that no longer exists (the registers were triaged
green in the same slice), so they are recorded rather than derived. Both point at the merged
tracker as the problem shape, independently of each other and of the T5 review that first
named it.

**1. The `summary:` backfill was mechanical in form, judgement in content.** Backfilling
frontmatter across 121 entries, measured on `engine-architecture/` (39 entries, the
designated first directory): **23 of 39 — 59% — required reading past the H1** to write a
summary that would stand alone in an index; wall-clock 2 min 23 s. Rates elsewhere:
`editor-and-tooling` 18/27, `dungeon` 12/22, the four small dirs 15/33 — **68 of 121 overall**.

The driver is structural, not stylistic. The merged trackers ("Frame surface gaps", "Physics
tracks", "Cookbook debt") carry an H1 that names a subsystem while the body names the actual
items, so a summary written from the H1 alone is indistinguishable from its siblings. This is
the same defect from the index's side: a merged tracker cannot have one honest summary,
because it is not one record.

**2. The `file:line` class outweighed the dead-path class ~3:1.** At branch base the scanner
reported **188 violations — 84 `dead-path` occurrences (35 unique paths) and 104
`file-line-citation` occurrences (95 unique)**. The spec had sized only the dead-path class
(~27 estimated, 35 actual — the premise held); the `file:line` class was never estimated and
turned out to be the dominant share of the triage. Concentration matters here too: a single
entry, `docs/backlog/dungeon/grid-vocabulary-consolidation.md`, carried **19 of the 84**
dead-path occurrences — a merged tracker citing a retired subsystem's whole module list from
one body.

**What both measurements say to rung 5:** the un-merge is not tidying. The merged tracker is
what makes summaries unwriteable and what concentrates citation rot, and it must precede any
directory sharding — sharding a directory of merged trackers relocates the wrong unit. See
`docs/backlog/infrastructure/engine-architecture-topic-dir-wants-sharding.md`, which records
that ordering.

## Genre completion — APPROVED SCOPE (owner ruling, 2026-08-13)

Rungs 1–4 gave backlog and work full contracts; reference/learnings/research got thin ones,
and the corpus violates the thin ones that exist. Designed with the owner in the tooling
session's follow-up and approved as rung-5 scope — planning inherits this, no re-brainstorm:

1. **Learnings TRIAGE, not a rename pass.** The undated files are mostly misfiled genres:
   recipe/known-issue docs making present-tense claims from inside the check-exempt history
   shelf (path-liveness exemption is granted by folder but earned by genre — a live claim in
   `learnings/` escapes the checks; that hole closes here). Date the true events (birth date
   from git history), REHOME the live facts into `docs/reference/` where they enter the
   checked set. Filename contract `YYYY-MM-DD-<slug>.md` thereafter, pattern-checked.
2. **Seals:** one-line `summary:` frontmatter, backfilled FROM the existing README index rows
   (reversing the drift direction); seals README index becomes generated + `--check`ed — the
   repo's last hand-maintained per-entry index. Planning input:
   the ~80-line seal guidance ruled at the process retro (2026-08-14, seals README
   §Writing a seal; `infrastructure/seal-entries-are-growing-into-essays.md` (gone) —
   resolved by that ruling, deliberately unpinned per the D8 guidance-over-machinery
   posture; if a PIN is ever added it is a drift alarm, never a budget, per canon §7).
3. **Research:** filename contract `YYYY-MM-DD-<slug>.md`, dated *directories* allowed for
   multi-file research (legalises the two existing ones, each carrying a README.md); each doc
   ends with what it FED (decision/spec/reference); pattern-checked, content stays exempt.
4. **Reference:** canon states the three kinds (as-builts / contracts / consumer patterns)
   and loose naming; NO kind-subdirectories (reference paths are the repo's most-cited
   strings; churn buys nothing at 13 files) — revisit flat-vs-sharded past ~20 top-level
   files, threshold stated in canon. `verified:` stamps go LIVE with the editor-architecture
   split (sitrep's freshness block is their consumer). The split creates `reference/editor/`,
   the first subsystem directory.
5. **The boundary test** enters the rules file and canon: **true now → reference · happened →
   learnings/research · to do → backlog · doing → work.** Every misfiling above violates
   that one line; it is the keystone if anything else gets cut.

## Naming — ruled IN SCOPE (owner, 2026-08-17)

**Design:** the 2026-08-17 genre-contracts naming spec.
**Scope:** canon §5 contract, genre one-liners, three renames — this file's own rename is
the first test case, shelf audit folded into the learnings/research triage.

## Provenance

`docs/backlog/infrastructure/docs-registers-findability.md` — the charter, kept as this
design's provenance and carrying the measured framing (growth rate, the two failed prune
shapes) that the canon states as bare conclusions.
