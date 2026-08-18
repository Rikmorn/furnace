---
summary: Sculpting worlds · cycle 2 — the skill held, and material is what makes a place — *first real use, 3 sessions; 58/80 calls, 5 places, owner-walked blind; material beats a 2.4× width contrast; low-clearance 0-on-walkable-ground in all 12 worlds; §Composing 1 keep / 2 rewrite / 1 strike; register 109→118*
sealed: 2026-08-12
seq: 35
---

# Sculpting worlds · cycle 2 — the skill held, and material is what makes a place

- **Sealed:** 2026-08-12 (work 2026-08-12) — the skill's FIRST real use, which is what
  cycle 1's seal said cycle 2 had to be.
- **Package(s):** dungeon (backlog + the analyzer re-run), editor (the `flags` arm, the
  skill, the README). Core untouched this cycle — read at review, never edited.
- **Gate:** three sessions, planner ≠ executor ≠ reviewer (cycle 1's process lesson,
  applied). E0 gated by the full root suite + three sabotage proofs; E1 gated by its own
  ≤80-call budget and an honest report; **the cycle gated by the OWNER WALKING the world
  blind** — the five place-identifications are the measurement the cycle was designed
  around, and they came back mixed, which is the answer it was built to get.
- **Suite:** 3,238 pass / 1 skip / 0 fail across 372 files (`bun test` from root, at the
  merged head).

**Counts, computed:** 11 commits `87086f73..ada7eb81` (1 planning ruling + 5 E0 + 5
review — `git log --oneline 87086f73..HEAD | wc -l`); 34 files, +1,539/−110
(`git diff 87086f73..HEAD --stat | tail -1`); the skill 948 → **1,097 words** against its
1,100 pin (`wc -w`); register 109 → **118** (the README's own `find`, re-run).

**The cycle.** E0 grew `session_query` its sixth arm — `about="flags"`, the advisor's
findings finally reaching the agent, which cycle 1 had named as the gap that "costs the
ability to learn from a build". E1 then ran the ask verbatim (*a monastery buried in the
rock: cloister, refectory, scriptorium, crypt, spring cave — five places that should feel
like crossing into somewhere else*) in **58 of 80 door calls**, skill loaded. The skill
held: corners were probed, gaps were filed by name, measurement stayed segregated from
conclusion. **The run's own report is the best artifact this cycle produced** — it graded
its own inferences honestly enough that the review found only two source-facts to correct.

**The measurement, from the owner's blind walk.** *"I could tell they were supposed to be
different, but it was too simplistic for me to really differentiate … the spring cave
looked different from the crypt … even if the cloister and refectory kinda look like
rooms."* Mapped onto the build: the pair differing in MATERIAL and form read as distinct;
the pair sharing masonry read as "rooms" **despite a 2.4× width contrast**. Dimensional
contrast did no identification work; material did all of it. Four classes across five
places forced three onto masonry, and the sharing places are the ones that blurred. The
vocabulary ceiling entry has its answer — MORE vocabulary, roughly a class per place that
must read as distinct — with the honest qualification that the failing pair was also the
**same generator, same material, same feature**, so composition owns a share the owner's
"it's the tools" reading does not cover.

**The finding that outgrew the cycle.** `low-clearance` scores **0 on walkable ground in
all twelve worlds the analyzer covers — 1,117 candidates, zero actionable, every time**
(`bun scripts/measure-analyze.ts` from `packages/dungeon`). It anchors on the offending
neighbour, which that script's own comment says is excluded from standable ALWAYS. The new
arm relays it as `severity: "candidate"` regardless: 184 of 255 rows in this run, enough to
blow `MAX_REPORTED` and set `truncated: true` on the rows that mattered. **Cycle 1 ended
"the analyzer named the defect correctly and the finding reached nobody"; cycle 2 ends "it
reached the agent in a shape it could not use."** Building the door was necessary and not
sufficient.

**Did the `flags` arm earn its place? USED, and it changed NOTHING the agent fixed** — the
adjudication the cycle owed, recorded as it came out rather than as it was hoped. E1 called
it, got `{total: 2541, pending: 0}` and 255 candidate rows, **reported the numbers and
triaged none of them**, because there was no way to narrow 184 low-clearance and 71 narrow
findings to a place. The arm is still right to exist — it is what made every measurement
above possible, and without it the low-clearance discovery would still be waiting for a
third cycle. But "the agent can now ask" was the cheap half of the gap cycle 1 named, and
the cycle-1 entry that E0 deleted as *resolved* was resolved only in that half. The
remainder is filed as `advisor-answers-volume-not-questions.md`.

**Review (independent, this session): CLOSE-WITH-MINORS.** Every load-bearing E0 claim
re-derived — byte figures to the byte, the per-row list identical, backlog counts from the
commit tree, all five commits green in isolation, all three sabotages reproducing including
§4.2's honest negative at the exact 1,772/0. Minors, all fixed: a stale rows-not-spent count
in `mcp.ts:229` left on a sentence the diff itself edited, per-row byte figures in tracked
prose without a deriving command, two arithmetic errors in the E0 report (the flags sentence
is 364 B and the `Five`→`Six` edit RETURNS a byte — the 363 was the net, correctly), and the
report's blanket "<10 LOC" claim, false for two of eight inline fixes. A third flaky-suite
sighting was attached to the existing tracker rather than filed anew, and the register's one
live citation into gitignored plan scaffolding was removed.

**Rulings at close (owner):** Debt 1 on `pending: 0` LEAVES STANDING — it cannot bite while
`catalog/agent.json` exists, it costs scarce door prose, and an advisor-liveness fact should
be shaped alongside the advisor-filtering work · cycle 2 gets NO `editor-architecture.md`
section of its own; the material stays at the end of §28.2 (now `docs/reference/editor/agent-door.md`
§"`session_query` — the spatial read"), where 3→5→6 reads as one story ·
branch + `--ff-only`, matching cycle 1 · and, at the disposition sit-rep, EVERYTHING backlogs
with nothing inserted before the tooling session.

**Two corrections the review made to the run's own dispositions**, both from reading source
rather than re-running anything: **caller-seeded reachability is EDITOR-local, not core** —
`markUnreachable` and `detectPits` already take a `seeds` array, and only
`field-analyzer.ts:433`'s `playerStart`-only wiring is hard — and the door-anchor item splits
core/editor. Both had been classified core-only, so cycle 3 would have scoped a change that
is already built. That is cycle 1's costliest lesson (*four false facts entered by trusting a
report's inferences*) collecting a second time, on a report that was otherwise scrupulous.

**§Composing adjudicated**, identification verified against the cycle-1 notes first: *give
districts different material* KEEP (rewritten, promoted to first, now the evidenced one) ·
*contrast makes hierarchy* REWRITE to "…not identity" · *entrances and thresholds are
moments* REWRITE, joined to probing (two cycles, two walks, both wedges at a threshold) ·
*a landmark must be useful* STRIKE (two runs, zero evidence). Three rules ENTERED on run
evidence: the generator's source is part of the box; never defer verification to a tool you
have not confirmed is usable; and the material rule. The word pin bit twice during the edit
and was trimmed to rather than re-dialled.

**Orphaned surface: none.** No exports lost a consumer; the only deletion is a skill bullet.

**Did any file grow disproportionately this cycle?** Yes, and deliberately: the cycle-2 field
notes (`docs/learnings/2026-08-12-agent-world-building-cycle-2.md`) are **419 lines** (`wc -l`),
the largest learnings entry yet — the E1 executor's tool-surface audit alone is eleven ranked
sections. It is one dated entry per the append-only rule and it is not a write target, so the
size is a property of how much one run priced, not of a file accumulating. Named here per the
rule. The backlog also grew +8 in one close, the largest single-session growth its README
records — that rate is itself a finding: one agent build priced eight gaps that months of
human authoring had not.

**What this cycle did NOT get.** Part W asked for the dullest stretch and the defect
locations; neither was collected. The void hole therefore has an entry that admits it has no
location and cannot be closed without one, and the cave-mouth wedge's attribution
(hard-stop-in-a-0.25 m-slot vs the tracked organic rim-ride class) stays open. Stated here
rather than smoothed over, because the walk is the cycle's only instrument and a gap in it is
a gap in the result.

**NEXT: the tooling session** (doc strategy + build-cycle speed, with prose-pin number bases
on its agenda per the cycle-1 close) → **undo + attribution** as one wire-format design pass,
now carrying cycle 2's demand evidence that a `dig` with no inverse makes agents *timid*, not
just messy → **F5, "scale."** Cycle 3, when it comes, opens on the four E0-equivalent items
this cycle filed with that trigger — and should read the vocabulary-ceiling entry as
"material is the variable", not as "buy more materials".
