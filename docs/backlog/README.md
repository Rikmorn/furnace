# Backlog conventions

This directory holds deferred work across sessions, organised into topic subdirectories. When the work completes, delete the entry.

## The index

Counts are computed, not typed:

```
for d in docs/backlog/*/; do printf "%-25s %s\n" "$(basename $d)" \
  "$(find "$d" -name '*.md' -not -name 'README.md' | wc -l | tr -d ' ')"; done
find docs/backlog -name '*.md' -not -name 'README.md' | wc -l
```

| topic dir | files | what it holds |
| --- | ---: | --- |
| `engine-architecture/` | 38 | `@furnace/core` — capability gaps, internal structure debt, unbuilt modules |
| `editor-and-tooling/` | 27 | the editor daemon + chrome + field host, and the `@furnace/editor` package |
| `dungeon/` | 22 | the dungeon demo — traversal, generation, placement |
| `native-runtime/` | 12 | the native shell, its JS surfaces, and platform support |
| `testing-and-quality/` | 10 | test harness, benchmarking, visual regression |
| `infrastructure/` | 7 | the `@furnace/tools` harness/CLI and repo plumbing |
| `ai-agents/` | 2 | agent-facing surfaces |
| **total** | **118** | |

Counted 2026-08-11, at the foundations T5 register prune and re-run after each entry filed on top of it (`build-cycle-gate-cost.md`, then the three from the first agent world-building probe: `stamps-not-authored-to-connect.md`, `scatter-variants-not-bound-to-archetype.md`, `agent-can-add-but-cannot-revise.md`, then the cycle-1 review's two: `analyzer-flags-cannot-reach-the-agent.md`, `content-vocabulary-is-the-differentiation-ceiling.md`, then the cycle-2 planning ruling: `skill-cycle-worlds-have-no-durable-home.md`) — and re-derived 2026-08-12 when cycle 2's E0 **resolved** `analyzer-flags-cannot-reach-the-agent.md` and deleted it, which is the first deletion-by-resolution this table has recorded. Re-derived again at cycle 2's **review** the same day, +8 in one close and the largest single-session growth this table has seen: four from the E1 monastery run (`action-run-input-is-schema-untyped`, `kit-lattice-excludes-a-walkable-stair`, `lattice-aligned-box-op-writes-nothing`, `pending-zero-cannot-say-the-advisor-is-off`) and four minted at review from that run's tool-surface findings (`advisor-answers-volume-not-questions`, `edit-apply-reports-nothing-about-what-it-wrote`, `the-door-charges-per-question-and-assumes-a-filesystem`, `field-op-vocabulary-has-no-architectural-altitude`) — a rate that is itself the finding, since a single agent build priced eight gaps that months of human authoring had not. The enumeration above is a dated record of what was FILED and is left intact; the counts are the current derivation. The per-dir number is the index granularity on purpose: entries are added and deleted continuously, so a per-entry index would be a constant write target that rots between sessions — the failure mode `AGENTS.md` names for append-only records. `ls docs/backlog/<topic>/` is the per-entry list, and it cannot go stale.

## How to use

- **When deferring mid-session:** add a new file before moving on. Don't lose context that took a conversation to surface.
- **Don't put bugs here:** fix urgent bugs; use GitHub Issues for non-urgent ones once the repo is on GitHub.
- **Don't put decisions here:** decisions go in `docs/reference/` or ADRs.
- **Don't put in-progress work here:** that's `TaskCreate`'s job — within-session only.
- **Scan on entry:** when starting new work, scan the relevant subdirectory for items that just became actionable, and promote them out.

## Pruning and file shape

Both now live in `docs/reference/docs-system.md` — §8 for pruning (the three moves,
keep-by-default, `consumer:`-marked entries untouchable, and why the merged-tracker shape is
retired) and §2 for the unit rule. Don't restate them here; a second copy is a second thing
to rot.

## Entry shape

Each entry lives at `docs/backlog/<topic>/<slug>.md`:

```markdown
# <Entry Title>

<Context paragraph(s) — why we deferred, what it is, optional link to the relevant reference doc.>

**Trigger to revisit:** Concrete signal (e.g., "first time we render >1 mesh", "before public release").

**Reference:** Optional pointer — a reference doc, a learning, a paper, an issue.
```

Topic subdirectories: add new ones as needed (kebab-case). Don't pre-create empty ones.
