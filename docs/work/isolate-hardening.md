---
status: in-flight
injected: true
summary: fix the isolate-incompatible test files so `bun test --parallel` can be the gate
---

# Isolate hardening

`bun test --parallel` finishes in **8.3–9.9 s** against **57–67 s** serial (measured
2026-08-12/13 — dated snapshots, re-derive before acting). But it does **not** complete the
suite — measured 2026-08-12, only ~69% of cases actually gate under it: **487 cases skip**
(the whole GPU population — `ensureBunWebGpu()` returns false inside any isolate, error
swallowed by the fixture's bare `catch`; single-file repro, so no cross-file state is
involved) and **532 never execute** (31 editor DOM files die at module evaluation — a
top-level-await TDZ in the inspector `_harness.tsx`). Two further classes: one real
shared-directory interaction (`build-frontend.test.ts` deletes `dist/frontend` while the
project-assets daemon test serves it) and the wall-clock budget files blowing bun's 5 s
default per-test timeout under 10-way CPU contention.

The work is to bring the missing 31% under the fast gate, in leverage order: the harness
top-level await (one file, 532 cases — cheapest, biggest); the GPU-fixture probe (log the
swallowed error under `--isolate` — decides whether the class is a fixture fix or blocked
upstream in `bun-webgpu`'s FFI, and with it most of this slice's value); the shared-dir
fix; the budget-files policy, which must explicitly re-open the fragility entry's ruling
(5) (baseline-relative budgets declined) rather than discover it at execution. Worker
count is a policy choice, not a default to inherit: 10 workers saturate this laptop and a
second concurrent session turns 9 s into minutes; `--parallel=4` costs ~1 s more with real
headroom.

**Deliberately unordered** — no `after:`. Related: the build-speed seal (2026-08-13) owns
the typecheck side; the scoped-gate script overruled there gets re-priced only if this
slice walls and the suite stays serial.
