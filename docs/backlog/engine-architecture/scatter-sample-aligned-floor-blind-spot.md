# Scatter misses a floor that lands exactly on a voxel sample

Surfaced building the F3b Task 8 placement integration test. `@furnace/core/field` scatter's floor projection (`scatter.ts` `columnSurface`, `hemisphere: "floor"`) detects a floor by scanning a column for a strict rock→air sample pair: `d0 < 0 && d1 > 0`. When a carved floor lands EXACTLY on a voxel sample its density there reads `0`, so neither the `(rock, 0)` pair below nor the `(0, air)` pair above satisfies the strict inequalities — the crossing is invisible and scatter returns no sites for that column. A box `dig` whose bottom face is sample-aligned (e.g. floor at world y = 0, a multiple of the 0.25 m cell) triggers this across the whole floor, so `commitGenerator` throws "empty result".

The Task 8 test worked around it by digging an OFF-lattice floor (y ≈ 0.1) so the crossing lands cleanly between samples. But the concern is whether REAL cave floors hit this: the cave carve quantises floors to `RISER = DEFAULT_CELL_SIZE` (0.25 m) — i.e. sample-aligned by construction. If cave floor samples read exactly 0 after skinning, scatter over a cave would silently drop sites on flat sample-aligned treads. (Not yet confirmed — surface-nets skinning may perturb the sample density off exact-zero; needs a probe on an actual carved cave before scattering onto it in anger.)

Fix candidates (a core/scatter change, out of the dungeon-only Task 8 scope):
- Treat `d == 0` as one side consistently (e.g. `d0 <= 0 && d1 > 0`) so a surface sitting on a sample is still detected.
- Or snap the scan to detect the sign change across a half-open interval.

**Trigger to revisit:** before relying on scatter over cave/generator floors (F3 "smart objects & the cave" / F4), or the first time a scatter run mysteriously under-populates a flat floor. Confirm with a probe first: does an actual carved cave floor read exact-zero at its samples?

**Reference:** `packages/core/src/field/scatter.ts` (`columnSurface`); `packages/core/tests/field-scatter.test.ts` (its `carveFloor` writes full-air values, so it never exercises the exact-zero-sample case).
