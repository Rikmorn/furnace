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
| `engine-architecture/` | 33 | `@furnace/core` — capability gaps, internal structure debt, unbuilt modules |
| `editor-and-tooling/` | 21 | the editor daemon + chrome + field host, and the `@furnace/editor` package |
| `dungeon/` | 20 | the dungeon demo — traversal, generation, placement |
| `native-runtime/` | 12 | the native shell, its JS surfaces, and platform support |
| `testing-and-quality/` | 10 | test harness, benchmarking, visual regression |
| `infrastructure/` | 6 | the `@furnace/tools` harness/CLI and repo plumbing |
| `ai-agents/` | 2 | agent-facing surfaces |
| **total** | **104** | |

Counted 2026-08-11, at the foundations T5 register prune and re-run after the one entry filed on top of it. The per-dir number is the index granularity on purpose: entries are added and deleted continuously, so a per-entry index would be a constant write target that rots between sessions — the failure mode `AGENTS.md` names for append-only records. `ls docs/backlog/<topic>/` is the per-entry list, and it cannot go stale.

## How to use

- **When deferring mid-session:** add a new file before moving on. Don't lose context that took a conversation to surface.
- **Don't put bugs here:** fix urgent bugs; use GitHub Issues for non-urgent ones once the repo is on GitHub.
- **Don't put decisions here:** decisions go in `docs/reference/` or ADRs.
- **Don't put in-progress work here:** that's `TaskCreate`'s job — within-session only.
- **Scan on entry:** when starting new work, scan the relevant subdirectory for items that just became actionable, and promote them out.

## Pruning — three moves, and nothing is lost

Ruled at foundations T5 (2026-08-11). A prune is **keep-by-default**; it has exactly three moves, and deletion is not one of them:

- **Promote** — the trigger fired. Take the work; delete the entry in the commit that resolves it.
- **Consolidate** — merge same-theme entries into one tracker (below). Nothing is dropped, only relocated.
- **Close with a disposition** — only for an entry that **directly contradicts current direction**, and only with its live residual re-filed as a narrower entry first. Where a disposition is unclear, KEEP.

"No consumer", "nobody has looked at it in a year" and "the file count is high" are **not** grounds for deletion. The same reasoning governs the engine's own surface — see `docs/learnings/seals/README.md` §Writing a seal: an orphaned name is "a candidate for JUDGEMENT, not for the bin".

**The size bar that triggers a prune is provisional.** It lives in `AGENTS.md` § "Deferred work" (~150 entries / ~50 per topic dir as of 2026-08-11) and it is a holding number, not settled policy: the register grows at roughly +2 net entries/day, so any fixed count is re-crossed within weeks of the prune that satisfied it. Whether a file count is the right instrument at all is an open design question — filed as `infrastructure/docs-registers-findability.md`, which is where the numbers get re-derived. Don't re-dial them in `AGENTS.md`.

## Two file shapes

**A single entry** — one deferral, one file, the shape below.

**A merged tracker** — one theme, one file, one `##` section per absorbed entry, each keeping its own Context / *Trigger to revisit* / *Reference*. This is the dominant shape in the two large dirs and it is deliberate: entries that are decided together, and read together, belong in one file. Rules that have held across three consolidation rounds:

- A merge needs a **theme nameable in a phrase**. "These are all small" and "these are all in `field/`" are not themes; a module counts only when the module *is* the concern.
- **Already-merged trackers are not re-merged** into each other — that produces 700–1,000-line documents and destroys the findability the merge exists to buy. They absorb small siblings instead.
- A tracker's intro says **what was absorbed and when**, so the file's own contents stay checkable.
- **Re-point every reference in the same commit as the deletion that stranded it** — grep the whole repo, not just `*.md`: source comments cite backlog entries too. `docs/learnings/seals/**` is dated history and is left alone.

## Entry shape

Each entry lives at `docs/backlog/<topic>/<slug>.md`:

```markdown
# <Entry Title>

<Context paragraph(s) — why we deferred, what it is, optional link to the relevant reference doc.>

**Trigger to revisit:** Concrete signal (e.g., "first time we render >1 mesh", "before public release").

**Reference:** Optional pointer — a reference doc, a learning, a paper, an issue.
```

Topic subdirectories: add new ones as needed (kebab-case). Don't pre-create empty ones.
