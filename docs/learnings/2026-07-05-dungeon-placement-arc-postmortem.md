# Postmortem — the placement arc (Slices 2.2.5b-B2 → B2c, 2026-07-02 → 2026-07-05)

> **Status: SEALED 2026-07-06** (reviewed with the user; adoption settled — see §Adoption).
> Scope: the four verified escalations across the topology-generator (B2) and chain-placer (B2c) slices.
> This is a PROCESS postmortem: every block was real, every fix was correctly built and reviewed — the
> failures live in how the work was scoped and premised, not in how it was executed.
>
> **User review verdict (2026-07-06):** escalations themselves are the process working — their
> FREQUENCY is the failure, and frequency of escalation reveals under-informed/naive planning.
> Procgen has been consistently pushed back or severely underestimated across the epic (a known
> LLM-planning weakness); it is the hardest system in the project AND essential to the vision. The
> named missing artifact class: **the spike** — a quick probe to prove a hypothesis is far cheaper
> than assuming it holds and leaving the downstream executor to discover otherwise at task N.
> The epic's structure itself is under-serving the system (procgen housed as ballooning 2.2.x
> sub-slices of a content umbrella) — an epic-level refocus discussion follows this seal.

## Timeline of escalations

| # | When | Symptom | Verified root cause | Response |
|---|---|---|---|---|
| 0 | B2 (07-04) | generated worlds place ~0–7.5% vs ≥80% bar | 2 placer substrate bugs (occupancy yaw shortcut, envelope over-claim) + position-poverty residual | freeze; research pass; B2c spec |
| 1 | B2c Gate A (07-05) | 0/8 default after the toolbox placer | interconnected cycles (weak hygiene) + cross-unit foreclosure + no closure steering — spec design gaps | Amendment 1 (hygiene, steering, backjumping, dogleg-aware fwd-check) |
| 2 | post-8B (07-05) | still 0% default; SA rescues fixtures, plateaus on real cycles | macro ring realizes as a ~15-room-member fundamental cycle — demand shape outside all precedent | Amendment 2 (hierarchical two-level placement) |
| 3 | Task 9A frontier (07-05) | per-sector premise disconfirmed: 3 rooms = 75–83%, nothing reaches 90%; 30–110 s search blowups | cave-cluster envelope collisions (box-heavy passes, cave-heavy fails) → **substrate mismatch**: rigid-tile placement forced onto field-native content | arc paused; this postmortem; re-plan as "built places, organic carves" |

## What went RIGHT (keep doing)

- **The verified-escalation protocol worked every time.** No block was false; no bar was massaged; every
  executor stop was evidence-backed and every stop prevented waste (block 3 stopped Tasks 9B–9D from being
  built on a disconfirmed premise).
- **Independent verification earned its cost.** The orchestrator's reproduction overturned or materially
  refined the diagnosis at every block (B2: found both substrate bugs behind the executor's cave theory;
  block 1: tree-strip control found Layer 1; block 3's frontier grid separated built-kit success from
  cave failure). Executor + verifier is a strictly better instrument than either alone.
- **Measurement-gate-first ordering was the one process fix that landed mid-arc and immediately paid.**
  Amendment 2 put the frontier measurement (9A) BEFORE the build tasks (9B–9D) — that ordering is why
  block 3 cost one measurement instead of three built-and-discarded tasks.
- **The work itself is real.** Tasks 0–8B (exact OBBs, loci, chains, portal freedom, forward checking,
  steering, backjumping, doglegs, joint annealing) are a reviewed, fixture-proven, industry-baseline
  placer for BUILT kit content — the component the endgame architecture needs regardless.

## Root-cause patterns → corrective rules

**P1 — Bars set by ambition, not capability.** The ≥90%/≥80% bars were attached to a config chosen for
vision (30 rooms, macro ring, loops) before ANY capability measurement existed; our own research pass had
already flagged that config as the hard regime (Edgar: <20 rooms, 0–1 cycles). Every block was, at bottom,
the bar meeting reality.
→ **R1: Capability-first bars.** An acceptance bar on a search/placement/solver system must cite a
measurement (frontier probe, prototype rate) taken BEFORE the bar is set. Ambition sets the roadmap
(what capability to build next), never the current slice's gate.

**P2 — The demand side was frozen; only the solver flexed.** Three amendments improved the placer; the
generator's demand shape (cycle sizes, room footprints, theme mix, connector lengths) was treated as fixed
until block 3 forced the question. The research's Warframe lesson — success rate is engineered into the
CONTENT KIT, co-designed with the placer via automated measurement — was cited in our own docs and unused.
→ **R2: Both levers in scope.** Any slice gating on a solver's success rate must name the demand-side
knobs in its spec and treat "reshape the demand" as a first-class fix, not a concession.

**P3 — Premises built on before being measured.** Amendment 2 assumed "per-sector ≈ the easy ≥90% regime"
from small-world data points (13–37% at 8 rooms — which never supported 90%). The B2c spec assumed
"toolbox → moderate rate; doglegs close the gap." Neither premise was measured before tasks were built on it.
→ **R3: Premise probes.** Every plan whose later tasks depend on a quantitative premise gets a cheap
measurement task FIRST (the 9A pattern), with an explicit disconfirmation branch ("if < X, stop").

**P4 — Precedent relaxations without a license.** 2.2.5a knowingly relaxed Edgar's cycles-first ordering
("closing a cycle edge degrades to a check") — billed us in B2. The B2c spec relaxed Ma's joint chain
optimization to greedy-with-lookback — billed us in blocks 1–2. Both relaxations dropped the precedent's
load-bearing mechanism while keeping its shape.
→ **R4: Precedent-fidelity check.** When a design adopts a published/shipped approach, the spec must list
each deviation from the precedent's mechanism and either justify why it can't bite or schedule the premise
probe (R3) that would catch it.

**P5 — Composition-model blindness (the arc's deepest error).** Organic, field-native content (SDF caves)
was baked into rigid star-shaped tiles and pushed through a built-architecture invariant ("pieces never
interpenetrate"). Every shipped cave game composes organic content by carving/union, where overlap is
composition, not collision — and our own substrate (field-as-truth, mesh-as-cache, `smoothUnion`, the B1
collar as the built↔organic interface, the backlog's noted "SDF-stamp option") was already the right tool.
All three B2c blocks are this one category error surfacing at three scales.
→ **R5: Composition-model question.** Brainstorms for content systems must ask, per content class: "what
is this content's native composition model (place rigid / carve-union / grid / grammar)?" — and mixed
systems get per-class jurisdiction, not one model forced onto all.

**P6 — Fixtures sampled the wrong distribution.** Tasks 4/5/8B passed on hand fixtures (single isolated
generously-ranged cycles, flat decagons) while the generator's REAL output (interleaved 15/7/4-member
cycle systems, cave-heavy warrens, height deltas) failed at 0%. Green fixtures created false confidence
twice.
→ **R6: Fixtures must sample the demand distribution.** Integration tests for a solver must include
inputs drawn from the real generator across seeds — hand fixtures prove mechanisms, only generated
fixtures prove the system. (The B2 lesson "subset-collider repros gave false confidence" was already in
memory; this is its solver-side twin.)

**P7 — Unbounded search effort, discovered late.** 8 restarts × 25k attempts × SA moves compounded to
30–110 s per FAILING seed — making measurement, retries, and the bars themselves intractable, and hiding
the cost until a sweep had to be killed.
→ **R7: Search systems get budgets on day one.** Wall-clock/attempt ceilings with fail-fast semantics are
part of the first task that introduces a search loop, not a later hardening — the retry loop, not search
depth, is where robustness lives (the DunGen/Warframe outer-loop shape).

**P8 — Accepted against a proxy demand (added at review, 2026-07-06).** The 2.2.5a placer was accepted
against a stand-in demand — the hand-authored 6-node graph — and every substrate assumption the stand-in
couldn't express calcified, then surfaced as a hard block when the real demand (the B2 generator) arrived:

| Latent 2.2.5a assumption | Why the hand world never tested it | Surfaced as |
|---|---|---|
| occupancy `yaw !== 0 → reject` | all hand-world voxel grids sat at yaw 0 | B2 fix 6a |
| whole-grid-AABB cave envelope | one cave, never packed against siblings | B2 fix 6b |
| loop edges "degrade to a check" | its single cycle was hand-designed to close ("descend into open space, close flat") — **a human performed the closure steering the placer lacked** | blocks 1–2 |
| rigid-tile no-interpenetration invariant | 6 nodes with hand-tuned gaps — never binds | block 3 |

Placement-first ordering was justified (hand-authoring a placeable graph took iteration at 6 nodes —
that's how we learned the generator must emit placement-friendly topology) and the placer is a keeper.
The error was accepting it without a demand stand-in at the right DISTRIBUTION: a throwaway ~50-line
random-graph sampler emitting the spec'd shape (room counts, cycle sizes, theme mixes — not a real
generator) would have cost half a day and converted three B2c hard blocks into 2.2.5a review findings.
The sharpest napkin miss: the ~15-member fundamental ring was COMPUTABLE from the B2 config on paper
(ring-at-sector-granularity × rooms-per-sector), and the research doc already held Edgar's envelope
(<20 rooms, 0–1 cycles) to compare it against — the comparison was never run.
→ No new rule number: the corrective is the merged R1+R3 (the **demand spike** flavor) plus R6's
general form. When component A is built to be consumed by not-yet-built component B, A's acceptance
is only as strong as the fidelity of the stand-in demand.

## Disposition

- Branch `epic2-slice2.2.5b-phase-b2-topology-generator` frozen at **1265 pass / 1 skip / 1 known
  fail** (verified at review, full suite ×2). The one fail is the "level↔wing seam" GPU walk — the
  known-accepted red carried since B2 Task 1's 45° ceiling. At review the upperA `[10.5,13]` retune
  was retried once with exact OBBs in (the fix the in-source comment predicted): **still unplaceable**
  (`layoutWorld` throws — the binding constraint is no longer only the rotated-AABB class); reverted,
  outcome recorded in-source. The red stays until the re-plan retires or reseats the hand edge.
  The executor's freeze consolidation was left mid-flight (the frontier harness + evidence addendum
  sat uncommitted in the working tree); completed at review — commit `d09655a`, 2026-07-06. Nothing
  merged; the hand world is still the shipped app.
- Tasks 0–8B are keepers: the built-kit placer, exact-OBB occupancy, chains/steering/SA machinery, and
  doglegs all survive into the next architecture as the BUILT-content composition path.
- The re-plan ("built places, organic carves" — field stamps for organic content, carve-aware connectors,
  collar-mediated interfaces) starts from a fresh brainstorm applying these rules. **Binding (the rules'
  own first test): "built places, organic carves" is hypothesis #5 in an arc where four predecessors each
  dissolved one hardness and revealed another. Its load-bearing premise — caves compose by field
  carve-union behind B1 collars at acceptable collision/visual/cost — gets a capability probe as the
  re-plan's FIRST task, with an explicit stop condition, before any bar is set or task stack built on it.**

## Adoption (settled at review, 2026-07-06)

Seven rules minted in one sitting is its own P-pattern (rule bloat — cf. AGENTS.md's inline-fix-threshold
lesson on individually-defensible items aggregating to cognitive load). Settled reductively — **three
durable rules, four folds**:

**Durable → `.claude/rules/working-standards.md` (§Planning):**
- **R1+R3 merged → "no commitment without a measurement that predates it."** One epistemic rule at two
  attachment points (the acceptance bar; the plan dependency). Spike flavors, cheapest-that-can-disconfirm
  first: napkin arithmetic → availability spike (binary — the 2.2.1 heightfield precedent, already
  practiced) → capability spike (statistical rate/cost — the missing flavor, 4×) → demand spike
  (generate real-distribution inputs and look — P8's missing artifact). Specs for solver/search/generator
  systems carry a Premises table: `premise | evidence today | probe | stop condition`. Probes are plan
  artifacts the planner owns, never discoveries left to the downstream executor.
- **R4 precedent-fidelity check** — standalone; fired twice in one arc with a crisp check.
- **R7 search budgets day-one** — standalone; concrete and needed under every re-plan direction.

**Folds:**
- **R2 (both levers in scope)** → largely subsumed by the merged rule (a real capability measurement
  exposes which lever binds — the frontier grid is what separated cave-failure from box-success); the
  re-plan enacts it structurally. Recorded here, no standing rule.
- **R5 (composition-model question)** → this document is its durable home; the re-plan IS its enactment;
  plus a memory feedback entry (it was the user's instinct that named it).
- **R6 (fixtures sample the demand distribution)** → folded into the existing memory lesson
  (`dungeon_2.2.1_collision_stuck_bug`: "subset repros give false confidence"), generalized to
  "proofs must sample the real input distribution" — one edit to an existing entry, no new rule.
- **P8** → corrective already covered by the merged rule's demand-spike flavor + R6's general form.
