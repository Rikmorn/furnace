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

## Planning

From the placement-arc postmortem (`docs/learnings/2026-07-05-dungeon-placement-arc-postmortem.md` — four hard blocks in one arc, each a premise meeting reality late).

- **No commitment without a measurement that predates it.** An acceptance bar, or a plan whose later tasks depend on a quantitative premise, must cite a probe taken BEFORE the commitment — cheapest flavour that can disconfirm: napkin arithmetic (some killing shapes are computable from the config on paper) → availability spike (does the API/mechanism work at all — binary) → capability spike (what rate/cost does it actually achieve — statistical) → demand spike (generate inputs at the real distribution and look at them before building what must satisfy them). Specs for solver/search/generator systems carry a **Premises table**: `premise | evidence today | probe | stop condition`. Probes are plan artifacts the planner owns — never discoveries left for the downstream executor at task N. Ambition sets the roadmap, never the current slice's gate.
- **Precedent-fidelity check.** When a design adopts a published or shipped approach, list every deviation from the precedent's load-bearing mechanism and either justify why it can't bite here or schedule the probe that would catch it. Keeping a precedent's shape while dropping its mechanism is how it fails (Edgar's cycles-first ordering; Ma's joint chain optimization — both relaxed without a license, both billed later).
- **Search systems get budgets on day one.** Any task that introduces a search/solve loop ships wall-clock/attempt ceilings with fail-fast semantics in that same task, not as later hardening — robustness lives in the outer retry loop, not in search depth (the DunGen/Warframe shape). Unbounded search cost discovered late makes measurement, retries, and the bars themselves intractable.

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
- **Deletion pass before addition pass.** When evolving existing API surface, list deletion candidates before listing additions. For every existing export in the affected area, ask "if we add the new thing, could we delete this?" Removing surface is a first-class option, not a fallback.
- **Single source of truth as a forcing function.** Two ways to spell the same thing — sugar fields alongside explicit fields, two parallel mutators, derived state that's also user-settable — is a smell. Pick one path and delete the other. Parallel paths force conflict-resolution rules (throw / warn / clear / silent) that are pure cost.
- **Mine wrong proposals.** A rejected design idea usually surfaces a real constraint that a different shape can satisfy. Don't dismiss rejections; ask "what was that trying to solve?" and propose differently. Tranche A-2's construct-time sugar was wrong but exposed the constraint that the policy-factory namespace then satisfied cleanly.
- **Hygiene tranches bias reductive; feature tranches still pass the overlap check.** Audit and clean-up tranches whose explicit goal is "tidy existing surface" default to removing things. Feature tranches that add capability should still pass each new primitive through "does this overlap with anything existing?" — and if yes, ship the new thing AND delete the old, or ship neither.

## Debugging
- **Public API before internals.** When debugging a library integration, grep the library's exported functions first. Most "we need to fork" intuitions are wrong — the function you want usually exists in the public surface (e.g. `build_as_child` vs `build` in wry).
- **Reference implementations before reverse engineering.** For any widely-used library combination, search for an open-source project using both together. Half an hour of pattern-matching against working code saves days of reverse-engineering from internals.
- **Fix the broken invariant, not the symptom.** When a symptom has a clear mechanism (e.g. an unsafe cast reading wrong-class memory because someone replaced the expected view), the fix is to restore the invariant the mechanism assumes. Don't paper over downstream effects (timing, focus, lifecycle); make the original assumption true again.
- **Stop after two failed fixes on the same symptom, not three.** Without new evidence, the third attempt is the same intuition with more conviction — not a better hypothesis. Verify the model against disconfirming evidence before trying again.
