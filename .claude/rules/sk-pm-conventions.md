# sk-* Project Management Conventions

How work is tracked across the home projects (sidekick, furnace, aesir).

## Where things live
- **GitHub is the status surface.** Work items are issues; epics are milestones; each repo has its own project board, which is that repo's single view of what is happening. Issue number is the work item's identity.
- **Files keep content.** Designs, research, ADRs (`docs/adr/`), learnings, reference docs live in the repo. Every working doc names its issue (`#NN`) near the top. Join by issue number, never by file path.
- **No mirroring.** A fact lives in exactly one place; the other side points at it.

## Placement test (tense)
True now → reference doc · happened → ADR / learning record · to do or doing → GitHub issue.

Some history is frozen: sidekick's `docs/work/` holds per-item records from before work moved to GitHub. A frozen directory is never rewritten, and a broken link is the only edit it takes. If something inside it is still true now, promote that content out into a reference doc rather than editing the record. A record keeps the identifiers it was written with, even once the thing it names is renamed.

## Naming
Issue titles are **content names** — say what the work is, never a position code (`3.4 — …`, `bench-6 — …`, `wave 2 of…` as identity are all out). Ordering lives on the board and in milestones; legacy or external IDs live in the issue body as source pointers.

## Board discipline
- One project board per repo; that board is the repo's status surface. Columns: Backlog · In Progress · Verify · Done.
- "What do I pick up" is **derived at session start** (orient + a board query), not stored in a column: mid-milestone you continue what's In Progress or pause it on purpose; between loose issues it is a judgment call. A deliberate sequencing decision worth keeping is recorded as a comment on the issue it concerns.
- An issue labelled `backlog` is deliberately deferred — its body states what would unblock or re-raise it. (The Backlog *column* just means not started; the *label* marks the deliberate-deferral subset with a stated condition.)
- Closure is GH-native: done, or closed-as-not-planned with a one-line reason. When there is something worth keeping, write a learning record in the repo and link it from the close comment.

## Breakdown and labels
- Inside a work item, use a **task list** in the body for steps that need no independent tracking. Promote a chunk to a **sub-issue** only when it needs its own status, assignee, or milestone presence — a sub-issue is a real work item, not a checklist line.
- Every open issue carries exactly one `area:*` label (the what); `backlog` and `change-request` are the only process labels (the how).
- A repo may declare one further content axis and name it for what it distinguishes; aesir uses `pkg:*` for the package an issue touches. An issue carries any number of labels on that axis, or none. Keep it to one axis per repo, because a second turns label choice into guesswork.

## Change control
Objective or scope changes enter as issues labelled `change-request` and are prioritised explicitly before any work absorbs them. This applies to the releases' own gates.

## Working docs
Specs/plans/scaffolding under `docs/superpowers/` are disposable (gitignored where the repo so chooses): delete on closure; the learning record is the tombstone.
