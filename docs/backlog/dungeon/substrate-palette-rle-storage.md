# Substrate grid storage: palette / RLE behind the accessors

**Context.** W2 ships the two-resolution voxel substrate with **dense per-region
`Uint8Array` storage** (D-W2-5): the region IS the chunk. `packages/dungeon/src/substrate/grid.ts`
holds coarse (0.5 m) and fine (0.25 m) grids as flat dense arrays, and every read/write goes
through accessors (`coarseGet`/`coarseSet`/`fineGet`/`fineSet`/`rasterize`) — **no raw array
appears in any public signature**. That accessor wall is deliberate: it is the seam a palette or
RLE encoding slots behind without touching a single caller.

Scaling napkin (D-W2-5): a spike-sized hall ≈ 5 KB coarse / 43 KB fine; a 100-region mega-world
≈ 5 MB — linear in content, because the region is the chunk (the research napkin's 77 MB figure
was a world-sized single array, avoided by construction). So dense is comfortably right at the
current and near-term scale, and compressing now would be speculative.

**Trigger to revisit.** The streaming era (Epic 4 — regions paged in/out at runtime), OR a
measured multi-MB world where grid memory shows up in a profile. Either makes the constant factor
matter; until then dense-behind-accessors is the cheaper, simpler thing.

**Reference.** `packages/dungeon/src/substrate/grid.ts` (the accessor wall + the dense
`cells: Uint8Array`); spec decision D-W2-5.
