---
status: queued
injected: true
summary: parallel + incremental typecheck, the per-package coverage gap, scoped-gate scripts
---

# Build-cycle speed

The gate is slow enough to change behaviour — it gets skipped, and skipped gates stop being
gates.

**Measured 2026-08-12** (dated snapshots; re-derive before acting, the numbers move with the
tree):

- typecheck: **~27 s** sequential across the five package lanes (`time bun run typecheck`;
  measured 26.3 s on 2026-08-12 and 26.9–27.2 s on 2026-08-13 — the spread is noise, treat the
  figure as command-only).
- suite: **67–70 s** single-core (`time bun test` from root).

**Three strands:**

1. **Parallel + incremental typecheck** — but read strand 2 first: the lanes are not just
   serial, several are **redundant**, and deleting them may beat parallelising them.
2. **The per-package coverage gap** — root `scripts/` is in no package typecheck target
   (`docs/backlog/testing-and-quality/root-scripts-have-no-typecheck-lane.md`, whose 2026-08-13
   correction is load-bearing for strand 1: only three packages have a `tsconfig.json`, none of
   the three sets any `compilerOptions`, and the two packages without one resolve the root
   config — so the gate runs the whole-repo check twice. The root project is a strict superset
   of all five lanes.)
3. **Scoped-gate scripts** — a docs-only or scripts-only change should not pay for a full
   GPU suite. This slice's own gate was scoped by hand, per ruling; the ruling wants a
   script.

Background: `docs/backlog/infrastructure/build-cycle-gate-cost.md`.
