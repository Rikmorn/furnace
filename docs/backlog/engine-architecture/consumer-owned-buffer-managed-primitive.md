# Consumer-owned uniform buffers: candidates for a managed-buffer primitive

*Tier-2 candidate. Surfaced during Resource Manager Stage 2 closeout (2026-05-28).*

Several cookbook demos pass consumer-owned `GPUBuffer` instances into `MaterialDescriptor.bindings` (`@group(1)` entries) and manage their lifecycle by hand via `buffer.destroy()`:

- `packages/cookbook/src/demos/shader/entry.ts:153-154,165-166` — consumer-owned uniform buffers backing the striped + plasma materials.
- `packages/cookbook/src/demos/render-target/entry.ts` — similar consumer-owned uniform buffers in the PiP rebuild flow.

Stage 1's resource manager covers Mesh / Material / Geometry / Effect, but NOT the consumer-owned buffers passed into those resources via `MaterialDescriptor.bindings` / `EffectDescriptor.bindings`. Those stay consumer-owned by design — consumers create them, write to them per frame, and destroy them.

When a future tranche introduces a managed-buffer primitive (likely as part of Tier-2 asset / streaming work), these raw `GPUBuffer.destroy()` sites become candidates for migration to the managed shape.

## Trigger to revisit

- When Tier-2 asset loader work begins, OR
- When a managed-buffer primitive is introduced in any other tranche that these sites should adopt for consistency.

**Reference:** Surfaced 2026-05-28 during Stage-2 closeout adjacency check. Stage 1 spec §2 explicitly OUT'd asset-loader / streaming layer / LRU eviction as Tier-2 work; this entry tracks one consumer-side surface that will need migration when that work lands.
