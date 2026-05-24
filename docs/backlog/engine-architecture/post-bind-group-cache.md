# Post: bind-group caching across ping-pong directions

Today, `frame.render`'s effect-passes create a fresh `GPUBindGroup` per
effect per frame for `@group(0) = { sceneTexture, sampler }`. The input
texture alternates between sceneA and sceneB on a ping-pong pattern, so
only TWO possible bind groups are ever needed per effect.

Optimization: pre-create both flavors (`sceneA-as-input`, `sceneB-as-input`)
on first use of each effect, look up per pass instead of allocating per
frame.

Cost of current behaviour: N bind-group allocations per frame for N
effects. WebGPU bind-group creation is cheap (small CPU struct, no GPU
work), so at low effect counts this is negligible.

Cost of caching: hold 2 bind groups per Effect; tiny lookup in the
effect render hot path.

Likely shape:
- Effect handle gains `_inputBindGroupCache: WeakMap<GPUTextureView, GPUBindGroup>`
  (or two slots keyed by which intermediate is the input).
- `renderEffectPass` looks up before allocating.

**Trigger to revisit:** Profiling shows post bind-group allocation as a
hot spot, OR effect count routinely exceeds ~5 in a real consumer demo.

**Reference:** `docs/superpowers/specs/2026-05-24-core-tranche-6-post-process-design.md` §1 Out.
