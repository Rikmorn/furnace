---
paths:
  - ".claude/agents/**"
  - ".claude/skills/**"
  - "agents/**"
  - "skills/**"
  - "plugin/agents/**"
  - "plugin/skills/**"
---

# sk-* Agent Prompt Authoring

Rules for writing and reviewing subagent definitions (`.claude/agents/*.md`, a plugin's `agents/`) and the skills that orchestrate them. Adapted from the broader Anthropic agent-prompts discipline; these rules codify lessons from in-spec prompt engineering across multiple projects.

This rule extends the portable sk-* set rather than replacing any of it: `sk-guidance-authoring.md` decides what earns a place in standing guidance of any kind, and `sk-working-standards.md` and `sk-language.md` govern this file's prose as they do any doc. What this file adds is the surface the portable set doesn't cover — the agent-prompt control surface — and on that surface it takes precedence over any third-party skill's authoring advice.

**Scope assumption — capable frontier models.** This discipline is calibrated for the capable frontier models the sk-* toolchain runs on. Several rules lean on that: trusting the model's intent-detection (Rule 8), preferring zero-shot reasoning over worked examples (Rule 3), and treating directive-density as a smell rather than a hard cap (Rule 4). On a weaker model you would lean harder on explicit examples and structure. Where a rule is frontier-specific, it says so inline.

## Why this exists

Agent prompts are the primary control surface for agent behaviour. Three rounds of in-spec discipline tightening on `sk-ui-auditor` (T-17 → T-18 → SK-SMOKE-04) failed to converge: the auditor kept rationalising around progressively-stricter rules. The pattern is universal — LLMs treat verbose rules + worked examples as "considerations" that they can find surface features to distinguish themselves from. Adding more rules makes it worse, not better.

The rules below describe how to author prompts that hold up under model rationalisation.

## Rule 1: Goal-oriented identity

This rule and Rule 2 are a house ruling, not a platform fact. Anthropic's own exemplar subagents open with numbered steps, and its guidance prescribes low freedom for fragile operations. The ruling stands here because state-machine prompts failed to converge in this toolchain; a fragile, mechanical operation may still take a step list, and says so.

Identity sections state what the agent exists to achieve. They do not describe how it should work.

**Do:**

> You are the `sk-ui-color` specialist. You find colour violations in the changed UI files and return them as evidence the orchestrator can score.

**Don't:**

> You are the color auditor. When invoked, first read DESIGN.md, then run grep for hex values, then count results, then look up the matrix tier, then emit a score block.

The first gives purpose. The second gives a procedure that breaks on any input that doesn't fit the steps.

## Rule 2: Constitutional constraints

Define the boundary the agent works *within*, and leave the space inside it open for reasoning. Prefer positive affordances — "do X", "stay within Y" — over prohibitions, and reserve explicit "never" for a small, non-negotiable safety tier. Negation is followed less reliably than affirmative instruction, even on capable models — so state the boundary as what to do, and keep "never" for the cases where the prohibition is the whole point.

**Do:**

```
<constraints>
# Safety tier — the few non-negotiable prohibitions
- Read-only: never modify source code, branches, or git state

# Operating boundaries — stated as affordances
- Ground every finding in the grep evidence (report only what the evidence supports)
- Return exactly one JSON object as the deliverable
</constraints>
```

**Don't:**

```
<behavior>
1. FIRST read DESIGN.md
2. THEN run the Pillar 3 grep
3. THEN count findings rows
4. IMPORTANT: Steps 1-3 happen before scoring
</behavior>
```

When to use a constraint vs leave it to judgment:
- **Constraint:** the violation would cause real harm (modifying state, fabricating findings, returning malformed structured output the orchestrator can't parse).
- **Judgment:** reasonable people might disagree on the right action (which lines count as one violation vs two; how much context to capture in evidence).

## Rule 3: Few-shot examples with reasoning

Replace if/then branching with examples that teach the reasoning pattern. Always include the reasoning — without it, examples become a lookup table the model pattern-matches against.

**Do:**

```
<examples>

Code: <button style={{ color: "#FF0000" }}>Save</button>
Reasoning: One line, one place to fix. The hex value and the inline style
are co-located — replacing the `style` prop with `text-red-500` resolves
both. Count as ONE finding; the violation count drives the score tier.
Action: Emit one finding row.

Code: const RED = "#FF0000"; ... <Button color={RED}>Save</Button>
Reasoning: Two distinct places — the constant declaration and the usage.
Fixing requires editing two lines. Even though it's the same colour,
they're separate findings.
Action: Emit two finding rows.

</examples>
```

**Don't:**

```
RULE: Hardcoded hex via inline style is ONE finding (one place to fix), NOT two.
RULE: Hardcoded hex shared via constant + usage is TWO findings.
RULE: Read the matrix top-to-bottom, do not skip past tier 3 to tier 1.
```

Examples teach pattern recognition. Rules teach rule-following. The agent that learned from examples handles the variation that doesn't match either example. The agent following rules pattern-matches surface features and rationalises around them.

**Model-dependent.** Worked examples matter most for weaker models and for pinning down an output format. On frontier reasoning models the lift shrinks — zero-shot CoT can beat few-shot — so don't reach for examples reflexively when the format is simple. The reasoning-pattern principle holds either way: lead with the reasoning you want the agent to do, and add examples when it needs the pattern *shown*, not by default.

## Rule 4: Minimise directive density

Every MUST, ALWAYS, NEVER, IMPORTANT, CRITICAL, "binding", "unconditional", "forbidden", "verbatim" overrides the agent's reasoning. Each one should earn its place.

**Reserve strong directives for:**
- Safety boundaries (read-only constraints, never modify state)
- Framework requirements (output schemas the orchestrator parses)
- Invariants that are genuinely never wrong to enforce

**Use softer language for behavioural guidance:**
- "Prefer X over Y" instead of "ALWAYS do X"
- "When in doubt, lean toward X" instead of "MUST do X"
- "X tends to produce better outcomes because..." instead of "NEVER do Y"

**The test** is `sk-guidance-authoring.md` §Form's constraint test, applied to prompts: if you can imagine a reasonable scenario where the agent should violate the directive, it shouldn't be a strong directive. If the directive would never be wrong in any context, it's a valid constraint.

**Density is a smell, not a threshold.** A pile-up of strong directives — say, past ~10 in an orchestrator or ~5 in a worker — is a signal to stop and redesign: you are encoding a workflow, not guiding judgment. Treat the number as a smell, not a hard ceiling — and don't slash counts to hit a magic number either. The real failure mode is *simultaneous* satisfaction: a model honours each directive in isolation far more reliably than it honours all of them at once, and the joint odds collapse as the count rises. Minimise the constraints that must hold at the same time, not the raw tally.

**Rank, don't flatten.** When constraints can conflict, give them a priority order instead of a flat list — a chain of command: *safety > correctness > style*. Ranking resolves conflicts by precedence ("when these collide, safety wins"), which is exactly what the agent needs the moment two rules disagree; a flat enumeration forces it to guess. This is the direct antidote to the simultaneous-satisfaction trap above — it turns "satisfy all N at once" into "satisfy the highest-priority one that applies".

## Rule 5: Verifiers are dimensional, not artifact-bound

A reviewer checks one quality dimension — structural validity, cross-reference integrity, spec adherence, anti-pattern smell, goal coverage, etc. The same reviewer can apply across multiple artifact types if its dimension applies.

**Producers and verifiers are distinct invocations — a hard invariant, not a style preference.** An agent that drafts an artifact does not also review it; a separate invocation does. The evidence runs one way and is strong: self-verification is *net-negative* — a model critiquing its own output tends to degrade, while a sound external verifier recovers the gains. And the lever grows with capability — the generation-verification gap *widens* as models scale, so this matters *more* as models improve, not less. Two consequences for wiring the gate:
- **Different invocation.** The verifier is a separate invocation from the producer — not the same agent reflecting in a later turn.
- **Seal it from the producer's context.** Give the verifier the artifact and the spec, not the producer's reasoning or rationalisations. Reward-hacking scales with capability *and* with visibility into the gate; the less of the producer's context leaks into the check, the harder it is to game.

**Quorum pattern.** When more than one dimension matters, dispatch several dimensional reviewers in parallel against the same artifact and combine their verdicts. Any failing → re-dispatch the producer with the combined feedback.

**Example.** A plan is produced by one drafter, gated by a deterministic lint (required sections present, every cited goal and decision ID resolves), and reviewed by a separate coherence reviewer that asks whether the tasks contradict the decided design. Either failing → re-dispatch the drafter with the combined feedback.

**When to add a new verifier vs widen an existing one.**
- Add a new agent if the dimension is genuinely distinct (different schema, different reasoning shape, different sources to consult).
- Widen an existing agent's `<inputs>` if the new artifact type fits the agent's existing dimension and schema knowledge.

**Naming.** Reviewers SHOULD be named after the dimension they check (`sk-coherence-checker`, not `sk-rfc-checker`). Producers MAY be named after the artifact they produce (`sk-rfc-drafter`).

## Rule 6: Chain of thought for orchestrators

Orchestrator contexts (skills or main-session orchestration that dispatches subagents and synthesises their returns) externalise their reasoning before significant decisions. Worker agents (those that do one focused task) do not — they just execute.

**For orchestrators, include in identity:**

> Before significant decisions (dispatching specialists, deciding what counts as a fixture mismatch, choosing how to compose the report), reason through your choice in prose. Specialists may also reason in prose around their structured output.

**What counts as significant:**
- Choosing whether to dispatch a specialist, retry one, or escalate
- Deciding whether the diff is in scope for this audit
- Choosing how to handle a specialist that returns malformed output

**What doesn't need explicit reasoning:**
- Routine tool calls (reading a file, running a grep)
- Following through on a decision already made
- Simple acknowledgments

The purpose is debuggability, not ceremony. If the reasoning would just be "I'm reading this file because I need to understand the code," skip it.

**Reasoning is not a constraint-guarantee.** Externalised reasoning improves *decisions*; it does not guarantee the agent honours its own *constraints*. Chain-of-thought can actually make a model neglect constraints it would otherwise have respected. The corollary cuts against over-trusting the trace: the more a decision rides on the agent reasoning its way to the right action, the more you must audit guardrail adherence *externally* at high stakes — with a separate verifier (Rule 5), not by trusting the reasoning to have enforced them.

## Rule 7: Structured output at boundaries only

Use structured output (JSON blocks, fenced code blocks, specific markdown templates) only where another agent or piece of code parses it. Everything else stays natural language.

**Framework boundaries (structured):**
- The deliverable JSON block a specialist returns to its orchestrator
- The final report template the orchestrator emits
- Hard-stop error blocks the orchestrator emits

**Agent communication (natural language):**
- Specialist reasoning prose around its JSON deliverable
- Orchestrator's reasoning before dispatching
- Error descriptions and status updates

Don't invent new structured formats unless something parses them. Unused structure is noise that constrains the agent for no benefit.

**Specialist contract pattern.** Specialists may reason in prose freely. Their *deliverable* is one JSON object inside a final ```json ``` fence. The orchestrator extracts that block and ignores everything else. This is the same shape as Anthropic's structured tool use — model can think out loud, runtime parses just the call.

## Rule 8: Trust the model

LLMs are good at understanding intent, reading context, and choosing appropriate actions. Don't encode things the model does natively.

**Don't encode intent detection:**

```
# Bad — the model already understands what counts as a violation
A VIOLATION is when the user has hardcoded a colour value (anything matching
#[0-9a-fA-F]{3,8}, rgb(...), or rgba(...) outside the design-token files).
```

**Don't encode conversation management:**

```
# Bad — the model naturally manages output flow
First emit the # UI Review heading. Then emit the Pillar Scores table.
Then for each pillar, emit the per-pillar section in order.
IMPORTANT: Do NOT emit pillars out of order.
```

If you find yourself listing surface forms the model might produce ("Confirmed:", "Verified:", "Now I have the picture"), or writing rules about basic output flow, you're doing work the model already does. Constrain only when the model has demonstrably failed in testing — not preemptively.

**The exception:** when the model's natural behaviour conflicts with a product requirement. If the model tends to be verbose but the orchestrator needs terse JSON, a constraint is warranted. But "the model might add a preamble" is not sufficient reason — test first, constrain only if needed. And when you do constrain, prefer structural enforcement (no surface for the unwanted behaviour) over rules (which the model rationalises around). Keep the two senses of "trust" separate, too: trusting the model's *intent-detection* (this rule) is not trusting it to *honour its constraints* — chain-of-thought can make it neglect them (Rule 6). At high stakes, verify adherence with a separate check rather than assuming the reasoning enforced it.

## Rule 9: Orchestrator owns deliverable writes; subagents return data

The orchestrator writes the deliverable files — specs, plans, decision docs, reports. Specialists return their contribution as data (prose reasoning + the ONE-JSON deliverable of Rule 7), and the orchestrator writes it through.

Why this holds: a specialist that writes its own deliverable bypasses the orchestrator's parse-and-validate step — the file lands whether or not the deliverable is well-formed — and in practice subagent file-writes also fail flakily, leaving half-written artifacts nothing detects. Centralising the writes gives one place that validates, one place that writes, one place that commits. It also lets the specialist's tool grant stay read-only, which is the structural half of sealing the quorum (Rule 5): a reviewer that cannot write cannot "fix" the artifact it is judging.

The boundary is *deliverable* writes, not all writes. A specialist whose work product IS the file change — an executor or fixer editing source inside a task's declared scope — writes as its function; that is the work itself, not the deliverable *about* the work (its deliverable is still the JSON status it returns). Even there, the orchestrator owns commits, verification, and rollback.

## Rule 10: Default single-agent; fan-out must buy something

One agent holding the full context is the baseline, not the fallback. Anything passed between agents is a lossy slice of that context, so a fan-out has to buy something the single context structurally cannot supply — at matched token budget a single agent matches or beats a multi-agent arrangement, and most celebrated multi-agent wins were bought with extra compute, not architecture. Three things are worth buying:

- **Breadth** — genuinely independent read-only directions (research angles, review dimensions) where no worker needs another's findings.
- **Independent verification** — reviewers sealed from the producer (Rule 5). Here parallelism isn't a speed-up; the independence is the point.
- **Context relief** — the work exceeds one *reliable* context window (well below the advertised one), or the input is noisy enough that a single trajectory can't separate signal from distractors.

Before fanning out, the orchestrator reasons in prose (Rule 6) about which of these the task offers. "It feels decomposable" buys nothing — decomposition without one of the three is pure handoff loss.

**Writes stay single-threaded.** Parallel writers make conflicting implicit decisions — naming, edge-case handling, patterns — and merge into incoherent output; this is the core multi-agent failure mode. Parallelism lives on the read-only/analysis side; writes flow through one thread (the orchestrator per Rule 9, or sequential per-task dispatch). Relaxing that takes structural isolation — disjoint file scopes, worktree isolation — not confidence, and the orchestrator still owns merge and commit.

## Rule 11: Frame first, guard both directions, cap every loop

**Open with a cheap framing pass.** Models default toward answering immediately — a trained-in prior, not laziness, so "think harder" instructions don't fix it; the prompt has to afford the opening move. Non-trivial work starts by restating what the task is, decomposing it, and surfacing the unknowns before producing anything. Keep the pass cheap, and treat what it yields as direction plus a *soft* depth prior — never a self-certified gate. Self-assessed difficulty is unreliable in both directions, so depth stays overridable within operator-set bounds; until an externalised sizing signal exists, the framing output is advisory.

**Guard over-engineering as hard as under-research.** Depth needs justifying both ways. Skipping research on a real unknown is the familiar failure; the symmetric one is just as real: past a threshold, more reasoning, more decomposition, more rounds flip correct results to wrong — over-processing is net-negative, not merely wasteful. When more compute genuinely is worth spending, prefer parallel samples with a verifier selecting over an ever-longer sequential chain: fresh attempts explore; a longer chain mostly digs the first rut deeper.

**Cap iteration; keep the best-so-far.** A loop earns its keep only against an independent gate (Rule 5) — self-judged iteration without an external signal degrades the result. Even a well-gated loop is non-monotonic: looping-until-the-gate-passes can degrade a previously-passing state, and the model has no reliable stopping criterion of its own. So every retry/refinement loop states a hard cap, and exhausting the cap halts cleanly with the best state preserved and named as such — never silently shipping the last attempt as if it were the best, never discarding everything. Loops the *user* drives are the exception: the human is the stopping criterion, so they run uncapped.

## Anti-patterns

### State machines in natural language

```
# Anti-pattern: encoding a flowchart in markdown
IF diff_target = "working_tree":
  CHANGED_FILES = git diff --name-only
ELSE:
  CHANGED_FILES = git diff --name-only $diff_target
IF [ -z "$CHANGED_FILES" ]:
  exit_with_error "empty_diff"
```

Natural language is the worst encoding for deterministic logic — followed inconsistently (worse than code), can't adapt to novel situations (worse than reasoning). If behaviour must be deterministic, put it in a Bash helper script the agent invokes. If it shouldn't be deterministic, don't encode it at all.

### Prescriptive tool sequences

```
# Anti-pattern: telling the agent which tools to call and in what order
1. FIRST call Bash to run the grep
2. THEN call Read on each matched file
3. THEN call Grep to verify the surrounding context
```

The agent has tools and knows what they do. It decides when to use them based on the situation. Prescribing sequences removes the agent's ability to adapt — what if the grep returns nothing? What if the file was deleted in the diff?

### Directive stacking

```
# Anti-pattern: layering directives that fight for priority
IMPORTANT: Always count finding rows, not failed checks.
CRITICAL: Read the matrix top-to-bottom.
MUST: Do not skip tiers.
BINDING: The first character of your output must be #.
UNCONDITIONAL: Apply the deletion test to every body sentence.
```

Contradictory or overlapping directives force the agent to guess which wins. The more directives, the more conflicts emerge. If you need this many rules to control behaviour, the prompt's approach is wrong — redesign for structural enforcement (split, validate post-hoc, remove the surface where the unwanted behaviour can occur).

### Worked-example accumulation

```
# Anti-pattern: each round of testing adds another worked example
T-17 worked example: <preamble form A>. Banned because...
T-18 worked example: <preamble form B>. Also banned because...
T-19 worked example: <preamble form C>. Also banned because...
```

Each new example teaches the model another surface form to avoid. The model learns to distinguish its own draft from each example individually, not to internalise the underlying rule. Two rounds of "more examples" is the signal that the lever is wrong (`sk-guidance-authoring.md` §Form states the same signal for rules files); redesign before adding a third.

### Complexity classification gates

```
# Anti-pattern: the agent classifies, then follows the matching recipe
SIMPLE FIXTURE (one violation): score per single-tier matrix
MODERATE FIXTURE (2-3 violations): score per multi-tier matrix
COMPLEX FIXTURE (4+ violations): score systemic
```

The agent should calibrate its approach based on the situation, not classify into buckets. Buckets are state machines in disguise.

## When to escalate from in-prompt rules to structural enforcement

If a behavioural rule keeps failing across rounds of tightening (worked example #2, worked example #3, more `MUST` directives), escalate to structural enforcement — the prompt-surface rung of `sk-guidance-authoring.md` §Placement's enforcement-first ladder:

- **Split** the agent into smaller specialists, each with narrower context.
- **Validate post-hoc** — orchestrator parses specialist returns and rejects mismatches arithmetically.
- **Remove the surface** — if a specialist's prompt has nowhere to put a preamble (its deliverable is JSON inside a fence), preambles are structurally impossible.

Two rounds of "more examples" without convergence is the signal. Don't pull the in-prompt lever a third time; redesign instead.

## Runtime facts that shape placement

Two facts decide where an orchestrator can live, and both moved recently, so check the version.

- **Subagents can spawn subagents, three layers deep by default** (Claude Code 2.1.219 and later; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes the limit). At the depth limit a subagent loses the `Agent` tool and does its delegated work itself. An orchestrator may therefore be a subagent, but every layer below the main session pays the handoff fidelity cost again, so prefer the main session for anything that needs the user or has to hold the whole picture.
- **Plugin subagents lose `hooks`, `mcpServers`, and `permissionMode` frontmatter.** Those fields are honoured for project and user subagents only.

Subagent `tools:` is enforced by the runtime; a skill's `allowed-tools:` is permission pre-approval, not restriction. When a step must not modify state, dispatch a tool-restricted subagent for it rather than asking a skill to refrain.

## Frontmatter is enforcement

Several rules above have a frontmatter field that enforces them structurally. Prefer the field to the sentence.

- `maxTurns` is the loop cap Rule 11 asks for: the subagent stops at the limit, its output is marked partial, and the orchestrator can resume it.
- `omitClaudeMd` (Claude Code 2.1.271 and later) and `skills` decide what a sealed verifier actually receives. By default every custom subagent loads the whole CLAUDE.md hierarchy, the project rules, and a git snapshot. A verifier that should see only the artifact and the spec sets `omitClaudeMd: true` and takes its inputs from the delegation prompt.
- `model` and `effort` pin the scope assumption at the top of this file. A prompt calibrated for a frontier model says so in its frontmatter rather than relying on the session default.
- `tools` is the read-only guarantee Rule 5 and Rule 9 rely on.

## Rewrites reconcile their blast radius

When you change an orchestrator's flow or its dispatch/return contracts, reconcile every agent it dispatches *in the same change*. The orchestrator is the ground its subagents stand on; moving it silently strands their self-descriptions. A subagent's identity line ("dispatched by X at step N"), its input/output schema, and the paths and section names it reads are all contracts with the orchestrator — an orchestrator rewrite that renames a section, drops a flag, or reorders steps invalidates them at a distance.

This is not optional tidiness — unreconciled drift is latent breakage, not cosmetics:
- A stale path silently no-ops: the agent reads nothing and loses its grounding, with no error.
- A stale schema field becomes fabricated or ignored data that flows through contracts no one reasons on.
- A producer and its checker that compute the same value two different ways never agree, and the gate they share can never pass.

**Reconcile against the live artifact, not the prose that describes it.** When a contract is implemented in tested kernel code (a CLI helper, a hook), that code is the ground truth — reconcile prompts to *it*, not to another prompt's description of it. A sweep that checks prompts against prompts will miss the case where a prompt and the code disagree (e.g. a hash the orchestrator's prose says is `git hash-object` but the tested CLI computes as SHA-256 — the prose is the bug, and only reading the code reveals it).

**Two senses of blast radius.** There is the *forward* radius — what an orchestrator change breaks downstream — and there is the audit-lens trap: coherence-with-the-orchestrator is a different dimension than prose-discipline, so a discipline-only review will pass agents that are quietly broken. It needs its own pass.
