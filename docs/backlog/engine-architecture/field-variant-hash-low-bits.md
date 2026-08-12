---
summary: `variantHash` mixes only the low 16 bits of each int input, so kit variant tints alias beyond ~32 km
---

# field/skin variantHash mixes only the low 16 bits of its int inputs

**Context.** `variantHash` in `packages/core/src/field/skin.ts` (FNV-1a, ported
verbatim from the W2 substrate donor) mixes only the low 16 bits of each integer input
(two 8-bit mix steps per int). World coarse coordinates alias beyond ~32 km — kit piece
variant tints would repeat in distant regions. Irrelevant at F2 scale; latent for the
mega-world era.

Fix is trivial when needed: mix all 4 bytes per int (two more mix steps).

**Trigger to revisit:** F5 "scale" (the mega-world proof slice), or any complaint about
repeating kit variation patterns.

**Reference:** `packages/core/src/field/skin.ts` (`variantHash`), executor flag #5 in
the F2a report (2026-07-16).
