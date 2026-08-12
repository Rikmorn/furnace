---
summary: individual seal files have grown from a paragraph to ~1000-word essays — the failure the seal record was split to escape, one level down
---

# Seal entries are growing into essays

Observed 2026-08-03 while planning the structural-housekeeping arc; promoted here at that
arc's (retroactive) seal, 2026-08-12, because it is an open question that nothing tracked
carried.

## The observation

Seal entries have grown from a paragraph to walls of prose. The 3.2.1 seal was **4 lines**;
by F4.5 the entry was the longest in the record at roughly a thousand words, and entries
written since are longer still.

Compare the record's own history, which is the reason this matters:

- `AGENTS.md`'s per-package bullets grew to ~50 KB of history loaded into every session, so
  in 2026-07-06 the record was extracted to `docs/learnings/seal-log.md` (gone).
- That single file reached 115 KB with one 42 KB line in it, so it was split into one file
  per seal plus an index (2026-08-03), and the general rule was promoted to `AGENTS.md`: an
  append-only record is a directory of dated entries plus an index with no content of its own.

Both moves fixed the *container*. Neither addressed the growth of the individual entry. A
directory of forty essays is cheaper than one 115 KB file — nothing loads them all — but the
cost lands on whoever reads a seal to answer a question, and the trend has no ceiling.

## Why it is not obviously a defect

Seal prose is not a context tax the way `AGENTS.md` was: seals are read on demand, one at a
time. Length that buys a reader the reasoning behind a ruling is worth paying for, and the
long seals are long mostly because the slices were dense. The question is whether the length
is *load-bearing* or whether the shape has drifted into narrating the work instead of sealing
it.

## Candidate answers, none chosen

1. **A length ceiling per entry**, pinned by a test — and by `docs/reference/docs-system.md`
   §7 it would have to declare its kind: a budget (derived from what a reader pays) or a
   drift alarm (a ratified size × slack). A drift alarm is the more honest instrument here,
   since no consumer economics bound it.
2. **A fixed skeleton** — gate verdict / premises / counts / deletions / next — with prose
   forbidden outside the named sections.
3. **An explicit split**: a one-paragraph seal, plus a per-slice detail file for the
   reasoning, so the record stays scannable and the depth stays available.

Option 3 recreates the container problem one level down unless the detail file is genuinely
optional; option 2 risks the reverse failure, where the interesting half of a seal has
nowhere to go.

## Trigger to revisit

When a seal is written that the author notices is long, or when the seals directory is next
restructured — whichever comes first. It also wants an owner ruling, since the candidate
answers trade scannability against depth and that is a taste call, not a measurement.

## Reference

- `docs/learnings/seals/README.md` §Writing a seal — what a seal must answer today; it bounds
  the *content* and says nothing about length.
- `docs/reference/docs-system.md` §7 — the prose-pin taxonomy any ceiling would have to
  declare itself under.
- `docs/learnings/seals/2026-08-04-structural-housekeeping.md` — the arc where this was
  observed, and the container fix that did not address it.
