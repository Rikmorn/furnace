---
summary: two distinct instability sightings in full-suite runs at one-worker-per-core — a Bun panic (SIGTRAP) and a hang; neither reproduced at the ruled --parallel=4
---

# Bun instability under `--parallel` at one worker per core — two sightings, kept

Recorded because the sighting has a captured artifact and would otherwise be lost, not because
it is understood. It is one of the reasons the isolate-hardening slice ruled `--parallel=4`
rather than bun's default worker count.

## First sighting (2026-08-13): a Bun panic (SIGTRAP)

Measured 2026-08-13 on this laptop (Apple M1 Pro, 10 cores; bun 1.3.14), running the full suite
with the GPU tier restored — i.e. the first time `bun test --parallel` had ever actually
executed the GPU population rather than skipping it.

One run of four ended with a Bun panic in a worker running a GPU test file
(`field-host-analyzer.gpu.test.ts` in `packages/editor/tests/`), reported as
`worker crashed: SIGTRAP` and, in the crash dump:

```
panic: unhandled exception
oh no: Bun has crashed. This indicates a bug in Bun, not your code.
```

The other nine workers were then torn down with SIGTERM, so the run reported ~226 failures and
executed roughly a third of the suite. **The 226 failures are collateral, not 226 problems** —
the whole event is one panic plus the runner's response to it.

## What is and is not established

- **Not reproducible at the ruled worker count.** Zero panics in nine full-suite runs at
  `--parallel=4` (four during the ruling, five during the flake enumeration), all
  0-fail. The review round added four more, also 0-fail and panic-free — and hang-free, which
  matters now that the second sighting below exists.
- **Not reproducible in either population alone at full width.** The GPU-only population under
  `--parallel` completed clean; so did the non-GPU population. Only the mixed full-suite run at
  one-worker-per-core panicked, and only once in four.
- **Mechanism: unknown.** No hypothesis is offered here. Worth noting only that it appeared
  under the maximum concurrent Dawn-instance count the machine has ever been asked for, since
  each worker realm now dlopens its own.
- The crash dump reports a `bun.report` URL. The full run log is session scratchpad and does
  not survive; the reproduction command does: `bun test --parallel`, repeated.

## Second sighting (2026-08-13, at the isolate-hardening review): a HANG, not a panic

A plain `bun test --parallel` full-suite run at default width stopped making progress with a
single worker process still alive, no panic, no crash dump, no further output for ~5 minutes,
and was killed. The captured log ends mid-`FATAL ERROR: getCompilationInfo not implemented`
noise from a dungeon GPU file — that message is ordinary bun-webgpu chatter and is almost
certainly not the cause, only where the log stopped.

**Why it is recorded here rather than as its own entry.** Same population, same trigger
condition (full suite, default worker count, GPU tier live), same practical consequence — the
run cannot be trusted and the ruled `--parallel=4` avoids it. It is a *different* failure mode,
so the entry now covers two.

**What this adds beyond the fragility entry's existing sighting.** That one recorded a
`--reporter=junit` + `--parallel` run hanging past 240 s and then **completing normally on
retry**. This one had no junit reporter and did **not** self-resolve. So the hang is neither
junit-specific nor reliably transient, which is more than either sighting alone said.

**Mechanism: unknown**, and no hypothesis is offered. Not seen at `--parallel=4`.

## Trigger to revisit

A third sighting of either mode, or any move to raise the gate's worker count above 4 — that
move should first re-run the full suite at the proposed count enough times to say whether either
recurs.
Related: [`bun-isolate-top-level-await-tdz.md`](./bun-isolate-top-level-await-tdz.md) (a
different, understood Bun defect from the same slice); the `--parallel=4` ruling and its
evidence live in `docs/reference/test-gate.md`.
