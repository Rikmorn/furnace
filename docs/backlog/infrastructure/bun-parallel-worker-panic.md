---
summary: one Bun panic (SIGTRAP, "this indicates a bug in Bun") seen in a full-suite run at one-worker-per-core; never reproduced at the ruled --parallel=4
---

# Bun panics under `--parallel` at one worker per core — one sighting, kept

Recorded because the sighting has a captured artifact and would otherwise be lost, not because
it is understood. It is one of the reasons the isolate-hardening slice ruled `--parallel=4`
rather than bun's default worker count.

## What was seen

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
  0-fail.
- **Not reproducible in either population alone at full width.** The GPU-only population under
  `--parallel` completed clean; so did the non-GPU population. Only the mixed full-suite run at
  one-worker-per-core panicked, and only once in four.
- **Mechanism: unknown.** No hypothesis is offered here. Worth noting only that it appeared
  under the maximum concurrent Dawn-instance count the machine has ever been asked for, since
  each worker realm now dlopens its own.
- The crash dump reports a `bun.report` URL. The full run log is session scratchpad and does
  not survive; the reproduction command does: `bun test --parallel`, repeated.

## Trigger to revisit

A second sighting, or any move to raise the gate's worker count above 4 — that move should
first re-run the full suite at the proposed count enough times to say whether this recurs.
Related: [`bun-isolate-top-level-await-tdz.md`](./bun-isolate-top-level-await-tdz.md) (a
different, understood Bun defect from the same slice); the `--parallel=4` ruling and its
evidence live in
[`editor-test-harness-fragility.md`](../editor-and-tooling/editor-test-harness-fragility.md).
