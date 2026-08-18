# Working Standards

Behavioural baseline for all contributors working in this repository.

## Engine conventions take precedence

These are general defaults. Where they conflict with a committed engine convention, the engine convention wins — `docs/reference/engine-conventions.md` is the canonical reference, and its §Failure policy is the **authority** on where the hot/warm/cold-path performance stances override the generic `typescript.md` / `clean-code.md` rules (e.g. intentional compiler-bypass classes, out-param mutation, imperative hot-path loops). The rule files link here rather than restating it.

## Reasoning
- Never state uncertain things as facts. Distinguish between "verified in this session" and "I believe based on general knowledge."
- State what assumptions a recommendation depends on. If an assumption is wrong, the recommendation is wrong.
- Before acting on a hypothesis, look for evidence that disproves it. If you can't find disconfirming facts, proceed. If you can, revise.
- When citing data or precedents, reference the source. Don't synthesise from memory when a canonical source exists.

## Communication
- Challenge ideas — point out flaws, edge cases, and risks before agreeing.
- Be direct: say "this is a bad idea because..." not "that could work but maybe..."
- Defend your position with evidence or admit you were wrong. Don't change your answer just because someone pushes back — if you do change, explain what changed.
- Give clear recommendations with reasoning, and show tradeoffs so informed decisions can be made.

## Discipline
- Correct yourself immediately when you realise you gave wrong information, even if nobody has noticed.
- Compounding errors are the biggest risk. Prioritise factual accuracy over agreeableness.
- Do what was asked. If you think the scope should be larger, say so — don't silently expand it.
- Before claiming work is done, verify it — at minimum a type check, ideally run the relevant tests. Match the verification to the scope of the change.
- Numbers in tracked docs are computed from the artifact — state the deriving command beside the count; a typed number is a defect.
- Before trusting that an assertion pins a behaviour, delete the line it pins and watch the test go red.
- A measuring instrument you build to grade your own work needs a **positive control** before its clean result is believed — inject a known-dirty input and watch it fire. (Genre-contracts, 2026-08-18: two self-built instruments produced flattering false results in consecutive batches; both self-caught only by controls.)
- Before/after figures come from **one instrument** — mixing two fabricates the delta.

## Planning

From the placement-arc postmortem (`docs/learnings/2026-07-05-dungeon-placement-arc-postmortem.md` — four hard blocks in one arc, each a premise meeting reality late).

- **No commitment without a measurement that predates it.** An acceptance bar, or a plan whose later tasks depend on a quantitative premise, must cite a probe taken BEFORE the commitment — cheapest flavour that can disconfirm: napkin arithmetic (some killing shapes are computable from the config on paper) → availability spike (does the API/mechanism work at all — binary) → capability spike (what rate/cost does it actually achieve — statistical) → demand spike (generate inputs at the real distribution and look at them before building what must satisfy them). Specs for solver/search/generator systems carry a **Premises table**: `premise | evidence today | probe | stop condition`. Probes are plan artifacts the planner owns — never discoveries left for the downstream executor at task N. Ambition sets the roadmap, never the current slice's gate.
- **Precedent-fidelity check.** When a design adopts a published or shipped approach, list every deviation from the precedent's load-bearing mechanism and either justify why it can't bite here or schedule the probe that would catch it. Keeping a precedent's shape while dropping its mechanism is how it fails (Edgar's cycles-first ordering; Ma's joint chain optimization — both relaxed without a license, both billed later).
- **Search systems get budgets on day one.** Any task that introduces a search/solve loop ships wall-clock/attempt ceilings with fail-fast semantics in that same task, not as later hardening — robustness lives in the outer retry loop, not in search depth (the DunGen/Warframe shape). Unbounded search cost discovered late makes measurement, retries, and the bars themselves intractable.

From the undo-attribution review (2026-08-14 — three plan defects in one slice, each
caught downstream of where it was written; seal
`docs/learnings/seals/2026-08-14-undo-attribution.md`).

- **Plans FLAG their load-bearing factual claims.** Any claim an acceptance bar or an
  accepted-risk argument rests on is marked `[load-bearing — verify first]` where it is
  stated, and the executor re-verifies flagged claims before relying on them, ahead of
  everything else. Approval launders nothing — a handed claim is not a verified claim,
  at any level of the chain: the stale-tab residue's third "mitigation" was false in an
  APPROVED plan and survived into a shipped docblock until the executing agent verified
  it instead of quoting it.
- **Every task's verify step sweeps for derived pins OUTSIDE its file list — touched
  packages' READMEs included, by name.** Code-shaped file lists and `src`-scoped greps
  both structurally exclude other packages' tests and every package README; the class
  fired in four tasks of one slice, and the editor README alone was the blind spot three
  times. The sweep is per-task, never one late sweep task.
- **A test step that rides an existing harness cites what that harness can OBSERVE, read
  from the harness at plan time.** An expectation the harness cannot reach is a plan
  defect that surfaces at execution (the MCP probe's fake chrome never reaches the real
  action registry, so "expect the guard's refusal" was unreachable as written).

## Execution

From the process retro (2026-08-14, ruled). The workflow is TWO sessions: the planner
(more capable model, root) plans, hands off by prompt, and reviews the executor's report;
the executor executes. The split exists for context management, not ceremony.

- **Deviate-and-log, never block.** An executor that finds a plan defect mid-task
  addresses it for the better and keeps moving, logging what changed and why in the
  execution report; the planner adjudicates every logged deviation at review — ratify,
  spawn a follow-up work item, or instruct a rollback/tweak. Silent adherence to a broken
  plan and stop-the-world blocking are both wrong; the log is what makes the autonomy safe.
- **Ritual docs commits batch.** The take-commit absorbs plan-recording; the seal commit
  absorbs the register pass; only a ruling with standalone value earns its own docs
  commit. Docs-only commits gate on `bun run check` alone (AGENTS.md §Before committing).
- **Handoffs travel as files.** Execution reports live under `docs/superpowers/report/`
  named by slug; the receiving session reads the file — the owner relays a pointer, never
  pasted content.

## Design
- **Boundaries enforce declared surface, not path shapes.** A module's contract is what
  it *declares* — its public surface (`index.ts`) and its package-private seam
  (`internal.ts`). Importing a declared name through a deep file path is fine; importing
  an undeclared name is the violation, whatever path it takes. Design rules and checks
  around imports/boundaries must test surface membership, and mechanical churn
  (re-pointing imports, adding barrel seams) is only justified when it closes a real
  ownership gap — publicness should be a decision someone made, never an accident of
  file layout. (Stated 2026-08-05 during the foundations doors design; canonical form in
  `docs/reference/api-posture.md` §R8 enforcement.)
- **Stance→check.** An architectural invariant (import direction, state ownership, module
  boundaries) isn't landed until a check enforces it; prose in a reference doc is a
  proposal. Hygiene stances (file size/growth) stay guidance by explicit ruling (D8,
  2026-08-04): the seal asks, no machinery ratchets.
- **New mode = new module.** A new interaction mode or subsystem is a new module against a
  framework seam (action registry, gesture machine, facade), never a new region in an
  existing file. The field-host reached 7.4K lines one region at a time; un-growing it took
  four tranches.
- **Deletion pass before addition pass.** When evolving existing API surface, list deletion candidates before listing additions. For every existing export in the affected area, ask "if we add the new thing, could we delete this?" Removing surface is a first-class option, not a fallback.
- **Single source of truth as a forcing function.** Two ways to spell the same thing — sugar fields alongside explicit fields, two parallel mutators, derived state that's also user-settable — is a smell. Pick one path and delete the other. Parallel paths force conflict-resolution rules (throw / warn / clear / silent) that are pure cost.
- **Parallel-subsystem reconciliation.** The rule above at subsystem scale, with a deadline. A new subsystem that parallels an existing concern (a second content model, registry, validation path) files its reconciliation decision — which wins, and when the loser dies — the day it is born. Scene vs the field op log cost a 24K-line deletion because this was filed two months late.
- **Justify by scaling.** Design decisions justify at the meaningful upper-bound scale the project is headed to, not the scale it has; where a threshold exists ("fine below N chunks"), write the threshold down where the decision lives.
- **Mine wrong proposals.** A rejected design idea usually surfaces a real constraint that a different shape can satisfy. Don't dismiss rejections; ask "what was that trying to solve?" and propose differently. Tranche A-2's construct-time sugar was wrong but exposed the constraint that the policy-factory namespace then satisfied cleanly.
- **Hygiene tranches bias reductive; feature tranches still pass the overlap check.** Audit and clean-up tranches whose explicit goal is "tidy existing surface" default to removing things. Feature tranches that add capability should still pass each new primitive through "does this overlap with anything existing?" — and if yes, ship the new thing AND delete the old, or ship neither.

## Debugging
- **Public API before internals.** When debugging a library integration, grep the library's exported functions first. Most "we need to fork" intuitions are wrong — the function you want usually exists in the public surface (e.g. `build_as_child` vs `build` in wry).
- **Reference implementations before reverse engineering.** For any widely-used library combination, search for an open-source project using both together. Half an hour of pattern-matching against working code saves days of reverse-engineering from internals.
- **Fix the broken invariant, not the symptom.** When a symptom has a clear mechanism (e.g. an unsafe cast reading wrong-class memory because someone replaced the expected view), the fix is to restore the invariant the mechanism assumes. Don't paper over downstream effects (timing, focus, lifecycle); make the original assumption true again.
- **Stop after two failed fixes on the same symptom, not three.** Without new evidence, the third attempt is the same intuition with more conviction — not a better hypothesis. Verify the model against disconfirming evidence before trying again.
