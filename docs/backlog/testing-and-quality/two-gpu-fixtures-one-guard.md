---
summary: core and dungeon carry duplicate bun-webgpu fixtures but only core's has an un-gated availability assertion, so a dungeon-only fixture regression would silently skip that package's whole GPU tier
---

# Two GPU fixtures, one guard

`packages/core/tests/_helpers/gpu-fixture.ts` and
`packages/dungeon/tests/_helpers/gpu-fixture.ts` are near-copies of each other — same
`trySetup` / `bunWebGpuAvailable` / `ensureBunWebGpu` / `makeOffscreenCanvas` surface, differing
only in core's extra `reattachGpuIfMissing` path. Dungeon's GPU tests import dungeon's copy; the
rest of the repo imports core's.

**Only core's copy is guarded.** `gpu-fixture-survives-dom.test.ts` (in `packages/editor/tests/`)
carries the suite's one UN-GATED availability claim — `expect(await ensureBunWebGpu()).toBe(true)`
— against core's fixture. Every other GPU case is `test.skipIf(!bunWebGpuAvailable())`, which
turns a broken fixture into a silent skip rather than a failure. So a regression confined to
dungeon's copy would skip that package's entire GPU population and leave the gate green.

This is not hypothetical: it is exactly the failure the isolate-hardening slice fixed. Before
that slice, both fixtures returned false inside any isolate realm, 487 cases skipped, and the
only thing that reddened was core's un-gated assertion. Dungeon contributed nothing to the
signal.

**Why it is filed rather than fixed inline.** The realistic regression — a Bun upgrade, or a
`bun-webgpu` bump — hits both copies at once, and core's existing assertion catches that. The
uncovered case is a dungeon-only divergence, which the duplication itself makes unlikely today.
Adding a second un-gated assertion would close it, but it treats the symptom: the real question
is whether two fixtures should exist at all, and deduplicating across two packages' test
directories is a design call about test-helper ownership, not a drive-by.

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
2. **Keep both, guard both.** A dungeon-side twin of the un-gated assertion. Cheap, and leaves
   the duplication — and therefore this entry — in place.

## Trigger to revisit

Whenever either fixture is edited again, or when the Bun-defect workaround inside them is
reverted (see
[`bun-isolate-top-level-await-tdz.md`](../infrastructure/bun-isolate-top-level-await-tdz.md)) —
that revert touches both copies and is the natural moment to ask whether there should be one.
