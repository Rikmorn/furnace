---
summary: this entry's trigger fired and was satisfied unnoticed when the cookbook demos moved to `@furnace/core/binding`; what survives is `MaterialDescriptor.bindings` as a public, untracked, consumer-owned escape hatch with zero demos behind it
---

# Consumer-owned uniform buffers: candidates for a managed-buffer primitive

*Tier-2 candidate. Surfaced during Resource Manager Stage 2 closeout (2026-05-28).*

> **THE PREMISE IS DEAD, and this is recorded rather than re-pointed — T5 branch review,
> 2026-08-11.** As written below, this section rests on named cookbook demos holding
> consumer-owned `GPUBuffer`s they destroy by hand. **They do not, and have not since
> 2026-05-31** — three days after this entry was filed. Commit `fcaa37a5`
> ("migrate material @group(1) params to the binding bridge (E-B)") moved both demos onto
> `@furnace/core/binding`. Today `grep -rn "createBuffer\|GPUBuffer" packages/cookbook/src`
> returns **one line, and it is a comment saying "Bindings own their GPUBuffers"**; the
> shader demo calls `binding.create` / `binding.setUniform` / `binding.destroy`, and the
> only raw `destroy()` calls left in `render-target/entry.ts` are on the PiP **textures**
> (`r.texture` / `r.depthTexture`), not uniform buffers.
>
> **So this entry's own trigger has already fired and been satisfied without anyone noticing.**
> It said "when a future tranche introduces a managed-buffer primitive… these sites become
> candidates for migration". `@furnace/core/binding` IS that primitive (Tranche E-B), and the
> sites DID migrate. What survives is narrower and still true: `MaterialDescriptor.bindings`
> still accepts raw `GPUBindGroupEntry[]` as a public, consumer-owned, untracked escape hatch
> (`packages/core/src/material/material.ts` — its TSDoc says "All three are consumer-owned"),
> and it now has **zero cookbook consumers**. Whether an escape hatch with no demo behind it
> should stay, be documented as unmanaged, or go, is a surface decision for the classification
> audit — **flagged for the review, deliberately not taken here.**
>
> The original text is kept below unchanged, because it is the record of why the migration was
> wanted.

Several cookbook demos pass consumer-owned `GPUBuffer` instances into `MaterialDescriptor.bindings` (`@group(1)` entries) and manage their lifecycle by hand via `buffer.destroy()`:

- `packages/cookbook/src/demos/shader/entry.ts` — consumer-owned uniform buffers backing the striped + plasma materials. *(Migrated to `binding` at `fcaa37a5`; the `:153-154,165-166` line citation this carried now lands on `binding.setUniform` calls and has been dropped rather than re-pointed.)*
- `packages/cookbook/src/demos/render-target/entry.ts` — similar consumer-owned uniform buffers in the PiP rebuild flow. *(Migrated at the same commit.)*

Stage 1's resource manager covers Mesh / Material / Geometry / Effect, but NOT the consumer-owned buffers passed into those resources via `MaterialDescriptor.bindings` / `EffectDescriptor.bindings`. Those stay consumer-owned by design — consumers create them, write to them per frame, and destroy them.

When a future tranche introduces a managed-buffer primitive (likely as part of Tier-2 asset / streaming work), these raw `GPUBuffer.destroy()` sites become candidates for migration to the managed shape.

## Trigger to revisit

- When Tier-2 asset loader work begins, OR
- When a managed-buffer primitive is introduced in any other tranche that these sites should adopt for consistency.

**Reference:** Surfaced 2026-05-28 during Stage-2 closeout adjacency check. Stage 1 spec §2 explicitly OUT'd asset-loader / streaming layer / LRU eviction as Tier-2 work; this entry tracks one consumer-side surface that will need migration when that work lands.
