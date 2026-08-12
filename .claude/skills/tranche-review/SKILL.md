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

## The protocol

### 1. Verify the branch, then ONE reviewer subagent

Confirm you are on the tranche branch and that it is the branch the tasks committed to —
`git branch --show-current`, `git log --oneline master..HEAD`. Never review a working tree
you have not located in history first.

Then dispatch **exactly one** reviewer subagent, **run synchronously** (you need its verdict
before anything else happens). One reviewer, not several: contradictory sub-reviews get
trust-picked, and the passing lane is the one that gets believed. Give it:

- the plan path, and the plan's **numbered exit claims** — the reviewer checks claims, not vibes;
- the gates, all three, from the repo root: `bun run check` · `bun run typecheck` ·
  the **FULL root `bun test`** (not the package suite — a tranche reds other packages);
- **1–2 sabotage re-runs**, each restored **byte-identical** afterwards;
- a **tree-clean proof** — `git status --short` empty, quoted in the report.

### 2. Fix minors inline

Minor findings are fixed in this session and committed on the branch. Anything that is not
minor is a ruling for step 3, not a silent fix.

### 3. In parallel: the digest agent and the user round

Run these two concurrently — they do not depend on each other:

- **Next-tranche digest agent** — background, **read-only**, scoped to the sweeps the next
  tranche will need, counts computed by it, and it **persists its own output** to a file. A
  digest that only exists in a subagent's return message is lost the moment the session ends.
- **One `AskUserQuestion` round** — the Safari-first user gate plus every decision that needs
  a ruling. **ONE round**, with your recommendation marked on each question. Batching is the
  point: a ruling asked three turns apart is three interruptions for one decision.

### 4. On gate pass

1. **Fast-forward merge** the branch to master (`--ff-only`; if it will not fast-forward, stop
   and report rather than creating a merge commit).
2. **Seal** — add the seal file per `docs/learnings/seals/README.md` §Writing a seal, plus its
   one index line.
3. **Update the reference docs and the affected package README** — `docs/reference/*.md` is
   "how the project IS today"; `packages/<pkg>/README.md` owns that package's current state.
4. **Clear the promotion gate — three verifications, all three before the seal closes.**
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
5. **Write the next plan and its prompt.**

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
