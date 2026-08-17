---
summary: Sculpting worlds · cycle 1 — aim and judgement, not discipline — *RED baseline owner-walked; skill 948 words + registry-checked guardrail; review 20/0/2, no fifth false fact; the skill itself unused until cycle 2*
sealed: 2026-08-12
seq: 34
---

# Sculpting worlds · cycle 1 — the agent learns aim and judgement, not discipline

- **Sealed:** 2026-08-12 (work 2026-08-11 → 12) — the first post-programme queue item:
  the agent world-building skill, run RED → GREEN per `superpowers:writing-skills`.
- **Package(s):** dungeon (README catalog section), editor. Core untouched this slice.
- **Gate:** the RED baseline was walked LIVE by the owner (a fresh unguided agent, 45
  MCP door calls, "an abandoned mine that broke into a natural cave system, on more than
  one level"); GREEN gated by the full root suite + guardrail mutation sabotages.
  **The skill itself is UNUSED — cycle 2 is its first real test**, stated here so this
  seal does not read as a proven skill.
- **Suite:** 3,234 pass / 1 skip / 0 fail across 372 files (`bun test` from root at the
  merged head, this session).

**Counts, computed:** 12 commits `c95b214d..383d77d3` FF-merged (9 executor + 3 review:
minors, the derivation pin, the two completeness filings —
`git log --oneline c95b214d..383d77d3 | wc -l`); 14 files, +949/−10
(`git diff c95b214d..383d77d3 --stat | tail -1`); the skill 948 words against a
1,100-word test pin; register 109 (`find docs/backlog -name '*.md' -not -name
'README.md' | wc -l`).

**The cycle.** The finding that reshaped the design: the unguided agent's engineering
discipline was already good — it derived the coarse cell from a probe stamp, ray-fixed
floors, verified junctions, repaired a dead-ended cross-cut, batched 966 ops into 12
undo entries. The prior (unguided agents under-scope and skip verification) was WRONG.
What was missing: verification aimed at straights while every defect sat at a corner,
and a report with no design language. So the skill teaches **aim and judgement, not
discipline** — 8 sections, 948 words, guarded by
`packages/editor/tests/skill-references.test.ts` (identifiers checked against the live
registries with candidacy read from the skill's own grammar; the unrotting numbers
searched-for with source-derived values; a word budget). Four false facts were caught
during development — all four entered by trusting the RED agent's report, which mixed
measurements (held) with inferences (did not); the field notes
(`docs/learnings/2026-08-11-agent-world-building-cycle-1.md`) now segregate the two.

**Review (independent, this session): CLOSE-WITH-MINORS.** The factual half survived
full source verification — **20 HOLDS / 0 FALSE / 2 honestly-labelled UNVERIFIABLE**
(run-record numbers resting on an uncommitted artifact, flagged by the notes
themselves); no fifth false fact; no fourth restatement of the door's own tool prose;
the out-of-plan `FORCE_COLOR` fix reproduced red→green in both directions; guardrail
mutations redded and restored sha-identical. Minors: three roster/queue staleness spots
(AGENTS.md skills roster, editor README ×2, §28.8's NEXT pointer) — fixed. The
completeness walk found the review brief's "all filed" was true for three of five
sized-separately items: **the flags sixth arm and the vocabulary ceiling had no
entries** — both filed at close (`analyzer-flags-cannot-reach-the-agent.md`,
`content-vocabulary-is-the-differentiation-ceiling.md`), each with cycle 2 as trigger.

**Rulings at close:** §Composing keeps its seven bullets — the four imported-canon ones
are ON TRIAL, cycle 2 adjudicates each against the growth rule · the module-private
numbers got their pin (the guardrail now evaluates the hall through the PUBLIC surface
and solves for cell + shell from the fill box's two independent axes, measures the door
aperture off the dig union — one correction to the review's sketch en route:
`BUILTIN_TABLE` carries no kit class, the stamp path refuses it setup-loud, so the pin
authors core's minimal kit fixture) · **the word pin (1,100) RATIFIED by the user at
close** — provenance established first: it is the cycle's own review-minted "1.16× head
at the cut", not a standard (the nearest guidance, `writing-skills`, targets <500);
accepted as an anti-runaway backstop, and by the same ruling the number's basis — and
prose-pin number bases generally (this pin + the mcp byte pins share the shape) — is
QUEUED FOR THE TOOLING SESSION's agenda.

**Orphaned surface: none.** New files only; nothing lost a consumer.

**Did any file grow disproportionately this slice?** No. The one candidate:
`skill-references.test.ts` grew 287 → 405 lines during review (the learns-to-fail cases
+ the derivation pin) — all guard, all sabotage-proven, named here per the rule.

**Process lesson (owner's observation, recorded for every future cycle):** the planner
and the executor were the SAME session this cycle, and it read as chaotic from outside —
the plan, the RED run, the GREEN writing and the self-review interleaved with no seam a
reviewer or the owner could stand on. Cycle 2 separates them: planning happens WITH the
owner in its own session, execution in another. The RED→GREEN discipline itself was
right and stays.

**NEXT: cycle 2, planned fresh with the owner.** The ask needs **more than two places
that must read as different** (the deliberate test of "uniqueness by scarcity does not
scale" — and of the vocabulary ceiling the new dungeon entry names); it starts on a
SCRATCH world; the flags-arm decision precedes or rides it ("it changes what cycle 2 can
do"). Then the tooling session (doc strategy + build-cycle speed) → undo + attribution →
F5.
