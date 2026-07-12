# Kit pieces: material / UV atlas instead of flat per-piece materials

**Context.** W2's masonry kit ships **flat per-piece materials** — the charter minimum.
`packages/dungeon/src/substrate/pieces.ts` defines `KIT_MATERIALS` as four solid
`MaterialDescriptor`s (ashlar / floor-ceiling / trim / collar) and `skin.ts` buckets every emitted
piece into one InstanceGroup per material index. Per-piece variation today is a **seeded value
jitter on the instance tint** (`variantHash` → an FNV-1a hash of (seed, cell, face), replacing the
spike's banded `%5`), which reads as subtle tonal variety but carries no texture detail.

That is enough to gate the slice on silhouette + composition, but it is the ceiling on how good
masonry can look: no albedo/normal detail, no per-piece UV variation, no wear//damage maps.

**Trigger to revisit.** The 3.4 / 3.5 visual polish pass — the first time the dungeon's LOOK
(rather than its structure) is the thing being judged. At that point the work is a material/UV
atlas: one atlased material per kit family, per-piece UV rects selected by the same
`variantHash`, so the instanced path stays one draw per family.

**Reference.** `packages/dungeon/src/substrate/pieces.ts` (`KIT_MATERIALS`, `variantHash`,
`PIECE_BOX`); `packages/dungeon/src/substrate/skin.ts` (the per-material bucketing in `bucket`);
spec decision D-W2-1.
