---
summary: Isolate hardening — the whole suite under the fast gate, and one Bun defect under both classes — *injected; `bun run test` = 4-worker gate running the FULL population (~21 s vs 55 s serial); both broken classes one Bun TLA/TDZ defect, filed with repro; review sabotage closed a live gate hole; D1=D2 (worker count IS the budget policy)*
sealed: 2026-08-14
seq: 38
---

# Isolate hardening — the whole suite under the fast gate, and one Bun defect under both classes

- **Sealed** — 2026-08-14
- **Package(s)** — core, dungeon, editor (plus the gate itself: root `package.json`,
  AGENTS.md)
- **Gate** — headless: `bun run check` · `bun run typecheck` · `bun run test` (the slice's
  own new 4-worker gate) · `bun run test:serial` (the review standard); review verdict
  PASS-WITH-MINORS on independent re-derivation with a four-sabotage battery; Safari
  waived — no visual surface, and the one at-risk runtime path (frontend build with
  `FURNACE_FRONTEND_OUTDIR` unset) verified byte-identical
- **Suite** — 3,293 pass / 1 skip / 0 fail across 3,294 cases / 377 files, **identical in
  both modes** (`bun run test` · `bun run test:serial`), and the single skip is the same
  capability gate in each (`load.gpu.test.ts`, `!hasImageBitmap`)

Twelve commits, 16 files, +624/−67 (`git diff --stat 33ef7264..2af04ce5`); three of the
twelve are the review round's own (five minor corrections, the dungeon-guard close, the
review-outcome note).

## What sealed

**`bun run test` = `bun test --parallel=4` is the per-commit gate, and it runs the whole
suite.** The old headline — "8.25 s vs 67 s" — was never real: it was the cost of running
69% of one, with 487 GPU cases skipping and 532 editor DOM cases never executing.
Measured at the review (2026-08-14, machine idle; commands are the scripts themselves):
`bun run test` 21.2 s · `bun run test:serial` 55.0 s, same population, same passes, same
one skip. With build-speed's typecheck lane, the warm per-commit gate is now roughly
**25–29 s** (check ~1.4 + typecheck ~2 + test ~21–25) against ~96 s at the pair's take.
Serial remains the close/review standard; the two modes disagreeing is itself a bug.

**Both broken classes were ONE Bun defect, which neither input digest had.** Under
`--isolate`, an importer evaluates before an imported async module's top-level await
settles: hoisted function declarations are initialized while `const` bindings (including
a const-backed `export default`) sit in TDZ. That single mechanism produced the GPU
fixture's "bun-webgpu is not supported on darwin-arm64" lie (the platform package's
default export was in TDZ; dlopen was never reached) and the 31-file inspector-harness
kill (`Cannot access 'cleanup' before initialization`). Filed with a three-file repro:
`docs/backlog/infrastructure/bun-isolate-top-level-await-tdz.md`; both in-repo fixes —
the fixtures' explicit `libPath` and the harness's synchronous `require` — are
workarounds with a revert trigger on the upstream fix.

**What the probes bought.** P1 (log the swallowed error) turned "possibly blocked
upstream" into a one-argument fixture fix and killed D3 unfired. P2's plan spec was
single-file and would have shipped 455 failures — the executor's directory-scale
extension caught candidate A passing every single-file probe while breaking 454 cases in
company. Durable lesson, now in the harness header: shared-process mode structurally
cannot detect a per-file ordering break, and single-file isolate probing is insufficient
too — **directory scale is the honest probe for anything touching registration order**.

**D1 and D2 were one decision.** The worker count IS the budget policy: at bun's default
one-worker-per-core the budget cases blow the 5 s default per-test timeout on contention
alone; at the ruled `--parallel=4` they return to essentially serial timing. Nothing was
calibrated — the fragility entry's "a claim about the machine can never fail" objection
is recorded as the reason NOT to: contention was evidence the machine was the wrong
measurement condition, not that the ceilings were wrong. Ruling, evidence, and reopening
trigger live in the fragility entry's RULED block.

**The review earned its verdict.** Parity was re-derived three ways per mode (catching
that a naive junit parse inflates by 817 — file-level and describe-level suites both
carry each case); the reviewer's own broken grep (`-ci` with unescaped alternation) was
caught and re-run, which CORRECTED the RULED block's evidence (the default-width failures
are unstable assertion failures spanning non-budget files, not a fixed pair of timeouts —
the ruling survives, better supported). Sabotage 2b found a live hole in the gate this
slice had just made authoritative: neutralising dungeon's GPU fixture left `bun run test`
green while 20 cases went silently dark — closed by owner ruling with an un-gated claim
mirroring core's, pin proven (`f50f345c`). The dungeon fixture was itself unplanned scope,
taken because exit claim 1 fails without it: both input digests missed it because it hid
inside the undifferentiated 487-skip mass — a class that skips silently is a class you
cannot enumerate, which is the standing argument for the `trySetup()` reporting that also
landed.

**Two instability sightings at default worker width, both filed, neither understood:** a
Bun panic (SIGTRAP, worker teardown made ~226 collateral "failures" out of one event;
`infrastructure/bun-parallel-worker-panic.md`) and a hung worker killed at ~5 min. Both
are additional evidence for the 4-worker ruling; neither reproduces at 4 (0 of 9+ runs).
Also recorded durably: under `--parallel`, full stdout can report a red run with zero
attribution — the never-tail rule sharpens to "capture stdout AND take a junit run",
with the junit double-count trap and one self-resolving junit hang noted beside it.

## Cross-seal note

The build-speed seal (2026-08-13) carried a revisit trigger — "the scoped-gate script
gets re-priced if this slice walls and the suite stays serial." **That trigger is dead in
the favourable direction**: the slice landed, the suite is whole under the fast gate, and
no scoped-gate selection logic is wanted. Recorded here because seal prose is immutable —
this seal is the answer to that pointer.

## Orphans and growth

No exports orphaned. `test:serial` was added, not removed; no name lost its last
consumer. No file grew disproportionately — the largest growth is the fragility entry
(+~100 lines of dated rulings and corrections across the slice and its review), which is
that entry doing its job as the living tracker.
