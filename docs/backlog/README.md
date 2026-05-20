# Backlog conventions

This directory holds deferred work across sessions. Each entry lives in its own file under a topic subdirectory (e.g. `native-runtime/`, `editor-and-tooling/`). When the work completes, delete the file.

## How to use

- **When deferring mid-session:** add a new file before moving on. Don't lose context that took a conversation to surface.
- **Don't put bugs here:** fix urgent bugs; use GitHub Issues for non-urgent ones once the repo exists.
- **Don't put decisions here:** decisions go in `docs/reference/` or ADRs.
- **Don't put in-progress work here:** that's `TaskCreate`'s job — within-session only.
- **Prune on entry:** when starting new work, scan the relevant subdirectory for items that just became actionable; promote them out by deleting the file.

## Entry shape

Each entry lives at `docs/backlog/<topic>/<slug>.md`:

```markdown
# <Entry Title>

<Context paragraph(s) — why we deferred, what it is, optional link to the relevant reference doc.>

**Trigger to revisit:** Concrete signal (e.g., "first time we render >1 mesh", "before public release").

**Reference:** Optional pointer — a reference doc, a learning, a paper, an issue.
```

Topic subdirectories: add new ones as needed (kebab-case). Don't pre-create empty ones.
