---
status: queued
injected: true
after: docs-system
summary: parallel + incremental typecheck, the per-package coverage gap, scoped-gate scripts
---

# Build-cycle speed

The gate is slow enough to change behaviour — it gets skipped, and skipped gates stop being
gates.

**Measured 2026-08-12** (dated snapshots; re-derive before acting, the numbers move with the
tree):

- typecheck: **26.3 s** sequential across the five package lanes; **~7.8 s** projected if
  the lanes run in parallel.
- suite: **67–70 s** single-core.

**Three strands:**

1. **Parallel + incremental typecheck** — the five lanes are independent and run in series.
2. **The per-package coverage gap** — root `scripts/` is in no typecheck target at all
   (`docs/backlog/testing-and-quality/root-scripts-have-no-typecheck-lane.md`).
3. **Scoped-gate scripts** — a docs-only or scripts-only change should not pay for a full
   GPU suite. This slice's own gate was scoped by hand, per ruling; the ruling wants a
   script.

Background: `docs/backlog/infrastructure/build-cycle-gate-cost.md`.
