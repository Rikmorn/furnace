---
summary: `texture.create` records base-level bytes only even under `mipmaps: true`, so `memory.textureBytes` reads roughly 33% low; the record is symmetric across create and destroy, so leak detection is unaffected and only the absolute figure is wrong
---

# `memory.textureBytes` undercounts mipmapped textures by ~33%

*Adjacent finding. Surfaced during Visual Fidelity Stage 1, Task 9 (mipmap generation) code-quality review, 2026-06-05.*

`texture.create` records only the **base-level** byte size into stats
(`_recordAlloc(ctx, "texture", width*height*4)`), even when `mipmaps: true`. A full
mip chain adds the geometric-series tail (~1/3 of the base), so `memory.textureBytes`
undercounts every mipmapped texture by roughly 33%.

This is a deliberate, documented simplification in T9 (`texture.ts` has inline
comments: "mip memory accounting is out of scope"). It does **not** break leak
detection: the recorded `byteLength` is symmetric across create and teardown
(create `+X`, destroy `−X`), so the count and bytes still round-trip to baseline
regardless of whether `X` includes mips. The only impact is that the *absolute*
`memory.textureBytes` figure is lower than the real GPU footprint.

## Fix shape
- When `mipmaps` is on, compute the true footprint = `Σ over levels of (w_i * h_i * 4)`
  where `w_i = max(1, width >> i)`, `h_i = max(1, height >> i)` for `i in 0..levels-1`.
- Store that as the slot's `byteLength` so both the alloc record and the teardown
  destroy record use the same (full) value — keep it symmetric.
- Small, self-contained change in `texture.ts` (and only there). The reason it was
  deferred rather than inline-fixed in T9: it nudges the stats byte-accounting
  contract (what `memory.textureBytes` means for multi-level resources) and wasn't in
  T9's stated scope.

## Trigger to revisit
- When textured scenes ship and `memory.textureBytes` is actually used for VRAM
  budgeting / profiling (the bowling scene in Stage 1 T11 uses mipmapped textures, so
  the number is already slightly off there — but no Stage-1 gate depends on the
  absolute value). OR a stats-accuracy pass.

## Reference
- `packages/core/src/texture/texture.ts` (`createFromData`/`createFromSource`, the
  `byteLength` recording), `packages/core/src/texture/mipmap.ts` (`_mipLevelCount`).
- **Two live reference docs document the undercount and point HERE for the fix shape** —
  `docs/reference/core-modules.md` §stats and `docs/reference/engine-conventions.md`
  §Stats caveat. Any change to the accounting has to move all three together.
