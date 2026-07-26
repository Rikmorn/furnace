# `analyzeWorld` re-validates the whole `extraSolid` map once per chunk

`analyzeChunk` validates every buffer in `AnalyzeOptions.extraSolid` on entry (`assertExtraSolidValid` walks the whole map, checking each length is `CHUNK_SAMPLES`). That check is correct and deliberately setup-loud — a packed bitset otherwise reads as a plausible partial flag subset — but `analyzeWorld` calls `analyzeChunk` once per allocated chunk, so validation is **O(chunks × extras entries)** rather than O(extras).

Harmless today and measured so: the F3b cave is 108 chunks, and `voxelizePlacements` over 6400 props emits 49 buffers → ~5.3k length checks, lost in the noise of a 3.9 ms `analyzeWorld` (`packages/core/tests/field-analyze-budget.test.ts`). It only bites where both factors grow together, which they do — a world with N chunks of field tends to have props spread over O(N) chunks, making the term quadratic in world size. A 10k-chunk world with a 10k-entry extras map is ~10⁸ checks (~hundreds of ms) spent proving the same buffers valid ten thousand times.

Not fixed inline because the fix is not the trivial one it looks like: hoisting the check into `analyzeWorld` does not stop `analyzeChunk` re-running it, so it needs an internal already-validated path (a module-private `analyzeChunkChecked` or a validated-view parameter). That is a small design decision about trusting an internal seam inside code reviewed and settled in F4 Task 2, not a mechanical edit.

**Trigger to revisit:** the first `analyzeWorld` run over a world large enough for the `[f4-budget]` line to show validation time — practically, when a bake exceeds ~1k chunks with placements spread across most of them, or when the analyzer worker (D-F4-9) starts running whole-world passes rather than dirty-chunk ones. Measure before changing: the per-chunk incremental path (the actual live-editing shape) passes a small extras slice and is unaffected either way.

**Reference:** `packages/core/src/field/analyze.ts` (`assertExtraSolidValid`, `viewFor`, `analyzeWorld`); producer `packages/core/src/field/placement-collision.ts`; budget numbers in `packages/core/tests/field-analyze-budget.test.ts`.
