---
summary: Docs system · rungs 1–4 — the registers get a design, checks, and a board — *injected; prevention/canon/detection + `docs/work/` and `bun run sitrep`; 188 citation violations triaged to 0; the archive rule found an unsealed arc; rung 5 deliberately deferred*
sealed: 2026-08-12
seq: 36
---

# Docs system, rungs 1–4 — the registers get a design, checks, and a board

- **Sealed:** 2026-08-12 (review closed 2026-08-13). Injected ahead of the cockpit epic's
  remaining slice, and priced here rather than absorbed silently — which is itself one of the
  problems the slice exists to fix.
- **Package(s):** none. Root `scripts/` + `docs/` + agent guidance only; no package source
  changed.
- **Gate:** `bun run check` · `bun run typecheck` · full root `bun test` — all green, run by
  the executor at close and independently re-run by the review's reviewer and by the review
  session after its own edits. **No user walk was owed** (no render or interaction surface).
  The owner gate that WAS owed is strand D's: the owner ran `bun run sitrep` against the real
  register and confirmed it reads true.
- **Suite:** 3,292 pass / 1 skip / 0 fail across 376 files (`bun test` from root, at seal).
  The slice's own tests: 54 pass across 4 files
  (`bun test scripts/check-docs.test.ts scripts/docs-frontmatter.test.ts scripts/docs-index.test.ts scripts/sitrep.test.ts`).

**Counts, computed** (`BASE=43b13b28`, `HEAD=4496c2a6`):

| measure | value | command |
| --- | ---: | --- |
| commits FF-merged | 25 | `git log --oneline $BASE..HEAD \| wc -l` |
| diff | 151 files, +3,015/−313 | `git diff $BASE..HEAD --stat \| tail -1` |
| backlog entries | 118 → 122 | `git ls-tree -r --name-only <rev> -- docs/backlog \| grep '\.md$' \| grep -v README \| wc -l` |
| files the checker scans | 145 | `bun -e 'import{collectLiveRegisterFiles}from"./scripts/check-docs.ts";console.log(collectLiveRegisterFiles().length)'` |
| check-docs marginal cost | ~0.1 s on a ~1.4 s gate | `/usr/bin/time -p bun scripts/check-docs.ts` ×3 |

## What landed

Three layers around a plain-markdown store, plus a projection.

**Prevention** — `.claude/rules/docs-authoring.md`, always in agent context: one record per
file, the frontmatter contracts, the values rule, the citation ban, the scaffolding-joins-by-slug
rule. **Canon** — `docs/reference/docs-system.md`, nine sections: genres and their unit rules,
the values rule's three tiers, statuses and typed supersession, the work register, the
scaffolding lifecycle and its promotion gate, the prose-pin taxonomy, pruning's three moves,
and the checks table. **Detection** — `scripts/check-docs.ts` in `bun run check`: path
liveness, the `file:line` ban, derive-marker drift, zod frontmatter schemas, generated-index
staleness, work-register consistency, and `consumer:` liveness. **Projection** —
`docs/work/` (epic = directory, slice = file) rendered by `bun run sitrep`, which is where the
queue lives now instead of in agent memory.

**The triage that came with it:** 188 violations at branch base — 84 dead-path occurrences
(35 unique) and 104 `file:line` occurrences (95 unique) — all cleared. Dead paths were either
re-pointed to where the file actually moved or marked ` (gone)`; every `file:line` became a
symbol citation. 121 backlog entries got frontmatter; the backlog README became generated.

## What the slice measured, and what it cost the plan

Two premises came back mixed, and both point the same way.

**The citation-triage size held where it was measured and was mis-sized where it was not.**
The spec estimated ~27 stale citations; 35 unique dead paths is within noise of that. But the
spec never sized the `file:line` class at all, and it turned out to be ~3× larger by
occurrence and the dominant share of the work.

**The frontmatter backfill was mechanical in form and judgement in content.** On the
designated first directory, 23 of 39 entries (59%) needed reading past the H1 to write a
summary that stands alone in an index — 68 of 121 overall. The driver is structural: a merged
tracker's H1 names a subsystem while its body names the items, so a summary written from the
H1 is indistinguishable from its siblings.

Both measurements name the merged tracker, independently of each other and of the T5 review
that first named it. They are carried forward in `docs/work/genre-contracts.md` as that
slice's demand evidence rather than left in the execution report.

## Did any file grow disproportionately? Yes — two, both by design.

`docs/reference/docs-system.md` is the largest new file (319 lines) and it is the point of the
slice: it absorbed `docs/backlog/README.md`'s §Pruning and §Two file shapes so the README
could become generated. `scripts/check-docs.ts` (307 lines) carries seven checks; if it passes
~500 lines it should split by check family rather than grow a section.

`docs/backlog/README.md` grew +225/−63, which is not growth — it is a hand-written index
becoming a generated one over 122 rows.

## Orphaned surface

**None.** No `@furnace/core` export lost a consumer; the slice touched no package source. The
one surface deletion is `docs/backlog/README.md`'s hand-written prose, which moved to the
canon rather than disappearing.

## What the review changed

The reviewer found the mechanism sound and honest — every number in the execution report that
was still derivable re-derived exactly, every pin it attacked went red naming its own
behaviour. Eleven minors were fixed in-session and four rulings were taken:

1. **The `door-set` fifth member was dropped.** The backfill marked a fifth entry by matching
   a clause that is an apposition describing its *sibling*. All four real members carry an
   explicit owner ruling in their Trigger line; that one carries none. The owner had been
   asked about it at the sitrep gate and answered "I really don't know" — a question that
   rested on a misreading. **This is the semantic-claim-rot class the canon says review has to
   catch, committed inside the tranche that codified the rule.**
2. **`consumer:` is now checked against the live work register**, with a fourth promotion-gate
   clause that sweeps pointers into a sealing slice. The rot is structural: clause 2 deletes
   the work item, so the ritual that closes a slice is the one that dangles every pointer into
   it, at the moment nobody is reading the backlog.
3. **Rung 5 went on the board** (`docs/work/genre-contracts.md`, renamed from
   `docs-system-rung-5.md` when the slice was taken), carrying the two demand
   measurements, and the charter re-points at it.
4. **The canon's live derive marker was demoted to command-only** — its own tier-2 rule applied
   to itself. It fired three times in one day, each time on a doc the change had nothing to do
   with, and no reader of that doc needed the count.

**And canon §7 stated future conformance in the present tense** — "Every pin states its
kind…" while neither live pin did. A convention described as an existing state on the day it
was invented, in the document that defines the rule against exactly that. Rewritten to
"ratified; pending", with each pin's annotation assigned to the slice that next opens it
(`door-set`, then `vocabulary-expansion`). The general rule is now in the prevention layer:
**a reference doc never states future conformance in the present tense** — the values rule's
sibling for claims, where a dated commitment is honest and an undated "is" that means "will
be" is rot at birth.

## The sweep found a hole, and the hole got closed

Task 13's rule — *live scaffolding dirs hold unsealed work only* — could not classify three
papers. That is how the structural-housekeeping arc was found to have merged on 2026-08-04
with no seal. It was sealed retroactively at this review
(`docs/learnings/seals/2026-08-04-structural-housekeeping.md`), and one durable fact carried
only in its gitignored papers was promoted on the way out.

The general shape is worth keeping: **the archive rule earns its place by producing files that
will not classify.** A process gap that is invisible becomes three objects on disk.

## Rung 5 is deliberately NOT in this slice

Tracker un-merge, the `editor-architecture.md` split, and the AGENTS.md trim. That ordering is
the whole safety argument — checks before the motion they protect — and the checks now exist,
so the motion can be planned against a protected as-built.
