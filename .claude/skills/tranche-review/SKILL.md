---
name: tranche-review
description: Use when reviewing/closing a furnace tranche against its plan — the standing review-session protocol.
---

# Tranche review

The standing protocol for a furnace review session: the tranche's task commits are on a
branch, its plan is written down, and this session decides whether the tranche closes.

Until now this protocol lived only in session memory, which is why it is here. Every
sweep clause below is scar tissue from a specific tranche — the reason is stated beside
each one, because a rule without its reason is the first thing a future reader deletes.

**The planner session owns this protocol** (two-session model, ruled at the process retro,
2026-08-14): the planner plans, hands off by prompt, and reviews the executor's report;
the executor never self-reviews. Handoffs travel as FILES — the executor's report lives
under `docs/superpowers/report/` named by the slice slug, and this session READS it; the
owner's relay is one line ("done — review it"), never a pasted report. A separate review
session is the fallback only when the planner's context is genuinely spent, not the shape.

## The protocol

### 1. Verify the branch, then ONE reviewer subagent

Confirm you are on the tranche branch and that it is the branch the tasks committed to —
`git branch --show-current`, `git log --oneline master..HEAD`. Never review a working tree
you have not located in history first.

Then dispatch **exactly one** reviewer subagent, **run synchronously** (you need its verdict
before anything else happens). One reviewer, not several: contradictory sub-reviews get
trust-picked, and the passing lane is the one that gets believed. Give it:

- the plan path, and the plan's **numbered exit claims** — the reviewer checks claims, not vibes;
- the gates, from the repo root: `bun run check` · `bun run typecheck` · `bun run test` ·
  **`bun run test:serial`** — serial is the close/review standard, and the two modes
  disagreeing is itself a bug (never a package suite — a tranche reds other packages);
- **1–2 sabotage re-runs**, each restored **byte-identical** afterwards;
- a **tree-clean proof** — `git status --short` empty, quoted in the report.

### 2. Fix minors inline

Minor findings are fixed in this session and committed on the branch. Anything that is not
minor is a ruling for step 3, not a silent fix.

**Executor deviations arrive logged, never blocked** (ruled 2026-08-14): the executor
addresses plan defects for the better mid-flight and logs what changed and why in its
report. This review adjudicates every logged deviation — ratify it, spawn a follow-up
work item, or instruct a rollback/tweak. A deviation with no log entry is itself a
finding.

### 3. In parallel: the digest agent and the user round

Run these two concurrently — they do not depend on each other:

- **Next-tranche digest agent — CONDITIONAL** (ruled 2026-08-14): dispatch it only when
  the next slice lacks measured inputs, and check `docs/superpowers/report/` AND
  `archive/report/` for an existing digest first — a duplicate was dispatched at
  isolate-hardening because the existing one wasn't found. When dispatched: background,
  **read-only**, scoped to the sweeps the next tranche will need, counts computed by it,
  and it **persists its own output** to a file under the NEXT slice's slug. A digest that
  only exists in a subagent's return message is lost the moment the session ends.
- **One `AskUserQuestion` round** — the Safari-first user gate plus every decision that needs
  a ruling. **ONE round**, with your recommendation marked on each question. Batching is the
  point: a ruling asked three turns apart is three interruptions for one decision.

### 4. On gate pass

1. **Fast-forward merge** the branch to master (`--ff-only`; if it will not fast-forward, stop
   and report rather than creating a merge commit).
2. **Seal** — add the seal file per `docs/learnings/seals/README.md` §Writing a seal, with its
   `summary:`/`sealed:`/`seq:` frontmatter, then run `bun run docs:index`. The index row is
   generated; never write one by hand.
3. **Update the reference docs and the affected package README** — `docs/reference/*.md` is
   "how the project IS today"; `packages/<pkg>/README.md` owns that package's current state.
4. **Clear the promotion gate — four verifications, all four before the seal closes.**
   - **Confirm promoted facts landed.** The slice's scaffolding is named for its slug; walk
     those files and spot-check 2–3 durable facts against the execution report to confirm each
     one now lives in reference/backlog/learnings. A fact that only exists in a gitignored
     report does not exist.
   - **Confirm the work item is deleted.** `docs/work/<slug>.md` is gone (and a closed epic's
     directory went with its last slice). The seal is the tombstone; two records of "what is
     live" is one too many.
   - **Confirm the live scaffolding dirs hold no files for this slug.** They moved to the
     archive. Live dirs are unsealed work only, which is what keeps the working set from
     outgrowing the tracked corpus.
   - **Sweep the pointers INTO the slice.** `grep -rl "^consumer: <slug>" docs/backlog/` —
     each hit was either consumed (promote it or delete it, per its content) or gets
     re-pointed at the successor work item, or cleared to a prose trigger. The verification
     above deletes the work item, which is precisely what dangles these; the ritual that
     closes a slice is the ritual that breaks them.
5. **Write the next plan and its prompt.** The handoff prompt states, every run
   (ruled 2026-08-14 at the undo-attribution close — the first managed-execution run):
   - **execution mode** — subagent-per-task by default for any multi-task plan; gate
     output stays inside task subagents (pass/fail + counts + deviations come back, never
     raw logs); the orchestrator reviews each task's diff between dispatches and
     re-dispatches on a bad result rather than absorbing fixes inline — inline absorption
     is how the orchestrator's context dies;
   - **branch policy** — which branch the tasks commit to, stated rather than inherited
     from whatever HEAD happens to be (undo-attribution landed on master because nothing
     said otherwise);
   - **checkpoint triggers** — named per slice, the FIRST one early (after the first
     task) so execution style is visible before real work accrues, and "otherwise just
     work" said explicitly;
   - **the sabotage read-back clause, verbatim, for every task subagent prompt** —
     *"after applying a sabotage, confirm the sabotaged text is actually present in the
     file before interpreting the suite result; a green suite proves nothing if the
     sabotage never landed"* (it failed silently three separate times in one slice);
   - **deviate-and-log + the report path** (`docs/superpowers/report/<slug>.md`).

## Sweep clauses

The reviewer carries these, and so do you when you fix minors. Each has fired:

- **Walk the plan's NAMED SMALL ITEMS — each one done or filed, never silent.** T4a's walk
  surfaced a task's pre-existing answer and a fourth silent defect class nobody had asked about.
- **Citation sweep over every file the tranche grew.** T4a found stale `file:line` citations
  five separate times, always in files the tranche itself had grown.
- **Audit docblock REASONS, not counts.** The count stays right while the argument beside it
  goes stale — if a comment says "for X's reason" and X changed, the comment is now a lie.
- **Suspect your own new prose as hard as prose you falsified.** The sentences written this
  session are the only ones no reviewer has read; probe every build-time, reachability, or
  purity claim BEFORE writing it.
- **Quote your grep globs.** Write `grep -rn "foo" packages --include="*.ts"` — an unquoted
  `--include=*.ts` once let 47 stale references survive a sweep.
- **The sabotage bar: delete the line a pin is about and watch it go red before trusting it**,
  then restore byte-identically. T4c found eleven assertions that had been passing while their
  subject was already deleted.
- **Numbers computed from the artifact, never typed.** State the deriving command beside every
  count. T4a's check caught five hand-typed figures, one of them inside the execution report's
  own protocol section.
- **Gate and demo builds start on a SCRATCH world.** T4c's gate built into an existing large
  world and the delta was invisible — nothing to see means nothing gated.
- **Walk the plan's `[load-bearing — verify first]` flags** — each flagged claim was
  re-verified by the executor (the report says where), or verify it now; an UNFLAGGED claim
  that an acceptance argument rests on is itself a finding. Canon: `working-standards.md`
  §Planning. The undo-attribution plan shipped a false mitigation inside an accepted-risk
  argument; only a downstream re-verification caught it.
- **Confirm every wording/claims sweep reached the touched packages' READMEs.** `src`-scoped
  greps exclude them structurally — the editor README was the blind spot three times in one
  slice: absent from every file list, false until a loud flag, missed again by the wording
  sweep. Canon: `working-standards.md` §Planning.
