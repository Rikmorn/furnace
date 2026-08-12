---
status: queued
injected: true
summary: fix the isolate-incompatible test files so `bun test --parallel` can be the gate
---

# Isolate hardening

`bun test --parallel` completes the suite in **8.25 s** against **67 s** serial (measured
2026-08-12 — dated snapshot, re-derive before acting). It is not the gate because some test
files are not isolate-safe: they share state that only survives a single-process run.

The work is to find those files and fix them, so the fast path can become the default
rather than a thing you remember to try.

**Deliberately unordered** — no `after:`. It is independent of the rest of the queue and
can be taken whenever someone wants the suite to stop hurting. Ordering it would be a
fiction; the honest default for a queued item with no ruled predecessor is no `after:` at
all.

Related: `build-speed` attacks the same problem from the typecheck side.
