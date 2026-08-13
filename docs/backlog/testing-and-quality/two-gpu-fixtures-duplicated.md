---
summary: core and dungeon carry duplicate bun-webgpu fixtures; both are guarded since 2026-08-13, so what remains open is whether two fixtures should exist at all
---

# Two GPU fixtures, now two guards — the duplication is what is left

`packages/core/tests/_helpers/gpu-fixture.ts` and
`packages/dungeon/tests/_helpers/gpu-fixture.ts` are near-copies of each other — same
`trySetup` / `bunWebGpuAvailable` / `ensureBunWebGpu` / `makeOffscreenCanvas` surface, differing
only in core's extra `reattachGpuIfMissing` path. Dungeon's GPU tests import dungeon's copy; the
rest of the repo imports core's.

**The guard gap is CLOSED (2026-08-13, at the isolate-hardening review; owner-ruled).**
`packages/dungeon/tests/gpu-fixture-available.test.ts` now carries an un-gated
`expect(await ensureBunWebGpu()).toBe(true)` against dungeon's copy, mirroring the one
`gpu-fixture-survives-dom.test.ts` (in `packages/editor/tests/`) has always carried against
core's. Every other GPU case remains `test.skipIf(!bunWebGpuAvailable())`, which turns a broken
fixture into a silent skip rather than a failure — the un-gated pair is what makes either
fixture's failure loud.

**Why the gap was closed rather than left filed, when this entry originally argued the other
way.** The original reasoning — the realistic regression (a Bun upgrade, a `bun-webgpu` bump)
hits both copies at once, and core's assertion catches that — is still correct as far as it
goes. What changed is that the review MEASURED the uncovered case instead of reasoning about it:
neutralising `resolveBunWebGpuLib` in dungeon's copy alone left `bun run test` at **rc=0** while
20 dungeon cases converted to silent skips. Since the same slice made that command the
per-commit gate, a demonstrated rc=0 blind spot in it is a different proposition from a
hypothetical one. The fix met AGENTS.md's inline-fix threshold on all four conditions, so it was
taken. Derive the delta: neutralise `resolveBunWebGpuLib` in
`packages/dungeon/tests/_helpers/gpu-fixture.ts` and compare `bun test packages/dungeon` either
side.

**What is still open, and it is the part that always mattered.** Two near-identical fixtures now
have two near-identical guards. That is a strictly better failure mode, not a resolution —
deduplicating across two packages' test directories is a design call about test-helper
ownership, and the second guard is symptom treatment that buys time for it.

## Fix shape

Two options, in preference order:

1. **One fixture, one guard.** Give the shared helper a single home and have both packages
   import it, then the existing un-gated assertion covers everything. Needs a decision on where
   a cross-package TEST helper lives — the **editor** package already imports core's test
   helpers widely (`gpu-fixture-survives-dom.test.ts` and the `field-host-*.gpu.test.ts` family;
   derive: `grep -rl "core/tests/_helpers" packages/editor --include="*.ts" --include="*.tsx"`),
   so the cross-package precedent exists but has never been ruled on. **Dungeon** imports core's
   test tree nowhere — its fixture is a copy, not an import, which is the whole reason this
   entry exists.
2. ~~**Keep both, guard both.**~~ **TAKEN 2026-08-13** — a dungeon-side twin of the un-gated
   assertion. Cheap, and it left the duplication — and therefore this entry — in place, which is
   exactly what it was chosen to do. It is recorded here rather than deleted because it is why
   this entry is no longer urgent.

## Trigger to revisit

Whenever either fixture is edited again, or when the Bun-defect workaround inside them is
reverted (see
[`bun-isolate-top-level-await-tdz.md`](../infrastructure/bun-isolate-top-level-await-tdz.md)) —
that revert touches both copies and is the natural moment to ask whether there should be one.
