# 2026-08-14 — Process retro: the weight was the third session, not the docs system

Dataset: the build-speed + isolate-hardening slices end-to-end (2026-08-13/14) —
20 commits, 6 code / 14 docs
(`git log --format="%s" 28fd6a1d..92e933ec | awk -F: '{print $1}' | sort | uniq -c`),
five sessions plus subagents, and roughly six long owner paste-relays between sessions.

## Findings

1. **The felt weight decomposed into three threads, and only one was the docs system.**
   The docs machinery (register, seals + promotion gate, check-docs hygiene) earned its
   cost this cycle: the promotion gate caught an unpromoted digest whose corrections
   reframed two live work items, and review sabotage caught a live hole in the brand-new
   gate. The owner likes the format overall (rung 5 fills the noticed gaps).
2. **The big cost was topology drift.** The owner's model is TWO sessions — planner
   (Fable, root: plan/design/explore, handoff prompt, independent final review) and
   executor (Opus: execution + its in-task diligence) — split for CONTEXT MANAGEMENT
   only. The cycle-1 lesson ("planner ≠ executor") had been over-generalized in memory
   into "review in a third session"; the isolate-hardening executor prompt propagated it,
   and the paste-relay burden was the bill. The relay itself was avoidable regardless:
   every pasted report already existed as a file both sessions could read.
3. **The original performance complaint's root was confirmed and is fixed.** Executor
   tasks ran hours because the inner loop churned tests + typecheck. The two slices cut
   typecheck 27 → ~2 s warm and the per-commit gate ~96 → ~25 s, with quality moved UP,
   not traded: serial stays the review standard and the fast gate runs 100% of the suite
   where the old fast path silently ran 69%.

## Rulings (owner, 2026-08-14) and where each landed

- **Two-session model; the planner owns tranche-review and the seal** → tranche-review
  SKILL.md (ownership block), working-standards §Execution.
- **Deviate-and-log, never block** — executor autonomy over plan defects is standing
  policy; every deviation logged (what/why); the planner adjudicates at review (ratify /
  follow-up item / rollback) → working-standards §Execution, SKILL.md §2.
- **Handoffs travel as files; the owner relays a pointer** → working-standards
  §Execution, SKILL.md ownership block.
- **Ritual docs commits batch** (take + seal absorb recording; standalone rulings
  excepted) → working-standards §Execution.
- **Seals: ~80-line guidance, depth in the archived execution report** — unpinned per the
  D8 guidance-over-machinery posture → seals README §Writing a seal; resolves
  `seal-entries-are-growing-into-essays.md` (gone).
- **Digest agents conditional** — only when the next slice lacks measured inputs, after
  checking `report/` + `archive/report/` for existing coverage → SKILL.md §3.

## Open thread

Whether the planner can drive the executor directly (a `claude -p` child, or SendMessage
to a sibling local session) instead of the owner hopping — deferred; the billing question
is unverified. The owner hops for now; the file-handoff rule makes each hop one line.
