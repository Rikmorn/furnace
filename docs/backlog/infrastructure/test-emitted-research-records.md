---
summary: a test that writes its deliverable into a content register makes that record live-regenerating, which the immutable-dated-record genre does not model — one instance is marked and ruled, the class is not
status: open
---

# Test-emitted records on the research shelf — a live generator inside an immutable genre

Filed 2026-08-17 during the `genre-contracts` slice, at the fold-in that marked the one
existing instance. This is the reconciliation `.claude/rules/working-standards.md` § Design
requires a parallel subsystem to file the day it is born; the subsystem is older than the
filing, which is the defect this entry closes.

## Context

`docs/research/` is a **content-immutable** genre: a dated record's claims are never
rewritten, and canon permits exactly three touches (filename dating, additive metadata,
mechanical citation repair). `packages/dungeon/tests/field-cave-walk.gpu.test.ts` writes
`docs/research/2026-07-23-f3b-p-f3-1-stepped-floor-probe.md` with `Bun.write` on every run
that reaches it, so that record is not immutable at all — it is a build output that happens
to be committed, and the F3b slice sealed it deliberately (the report was a later slice's
analyzer corpus).

The invisibility of that fact is what bit. Earlier in this slice a `**Fed:**` line was
hand-appended to the file; the next full test run deleted it, and once the `fed-line-missing`
check went live `bun run test` and `bun run check` were mutually exclusive. The immediate fix
moved the line into the emitting template, and this slice added a generated-by mark at the top
of the report plus a one-sentence exception in `docs/reference/docs-system.md` § 2. **That
rules the instance. It does not rule the class.**

The open question is a parallel-content-model question, and it has the shape that recurs:

- **Which model wins for a probe deliverable?** A dated record's authority comes from being
  fixed at a date; a regenerated record's comes from tracking the live suite. Today one file
  claims both — a 2026-07-23 filename over figures re-derived on the last run — and the mark
  is the only thing reconciling them.
- **Where do generated records live?** On the content shelf beside hand-written research, or
  in a generated-artifact location the register checks treat differently? The backlog and
  seals indexes are generated and live *inside* their registers, but they carry no dated
  claims, so they are not evidence either way.
- **What happens when regeneration is not a no-op?** Today it is: a run reproduces the
  committed bytes exactly, so the file is stable under the commit gate. The day an engine
  change moves a figure, the record's claims change under a filename that says 2026-07-23 and
  under a seal that cites it. Nothing currently decides whether that is a commit, a new dated
  record, or a stop.

**This will recur.** The repo's planning discipline mandates probes before commitments
(`.claude/rules/working-standards.md` § Planning: napkin → availability → capability → demand
spike, with a Premises table), and a probe's natural deliverable is exactly this shape — a
report a test emits, worth committing because a later slice reads it. The next one arrives
with the next solver/search/generator spec, and it will land on the same shelf.

## Trigger to revisit

Either of:

- **The next probe-style deliverable** — any new test or script that proposes to write into
  `docs/research/`, `docs/learnings/` or another content register. Canon § 2 already requires
  a ruling at that point; this entry is what that ruling reads.
- **The first time the existing report regenerates non-identically** — i.e. the deriving
  command below leaves `git status docs/research/` dirty with a figure change rather than
  clean. That is the immutability conflict arriving in fact rather than in principle.

Not urgent while regeneration stays a no-op and the population is one.

## Reference

- `packages/dungeon/tests/field-cave-walk.gpu.test.ts` — `REPORT_PATH` and `renderReport`
  are the generator; the marker text lives in the template's opening lines.
- `docs/research/2026-07-23-f3b-p-f3-1-stepped-floor-probe.md` — the one instance, marked.
- `docs/reference/docs-system.md` § 2 — the research genre's content-immutability rule, its
  three permitted touches, and the exception clause this entry backs.
- `.claude/rules/working-standards.md` — § Design (parallel-subsystem reconciliation, the
  rule this entry discharges) and § Planning (the probe ladder that keeps producing the shape).
- Whether the record is currently stable is derivable, not stated here:
  `bun test packages/dungeon/tests/field-cave-walk.gpu.test.ts && git status --short docs/research/`
  — empty output means regeneration is still a no-op.
