# Static shadow-map caching — dirty-flag skip for unchanged casters

Stage 4 re-renders the **entire depth pass every frame**: all casters are drawn
into the shadow array on each frame (`frame/shadow-map.ts` `_recordShadowPasses`),
with no caching of the result and no dirty-flag skip for casters/lights that did
not move since last frame. A static scene under a static directional light
re-renders an identical depth map 60× a second.

The optimization is **static shadow-map caching**: skip the depth re-render when
neither the casters nor the casting light changed, reusing the previous frame's
shadow texture. This is the win that a *light-identity* concept would naturally
enable (a stable per-light handle whose shadow map persists across frames with a
dirty bit) — but it is **addable without changing the `Light` type**: the engine
already owns the shadow array, so it can keep a per-slot "last rendered hash"
(caster transforms + light view-projection) and skip the pass when unchanged, with
`Light` staying plain per-frame value data. The decision to keep `Light` as value
data (Stage 4) does **not** foreclose this optimization.

**Trigger to revisit:** the shadow depth pass shows up as a meaningful cost in a
profile (many casters, high-poly casters, or multiple shadow-casting lights) —
i.e. when re-rendering unchanged shadows is measurably wasteful.

**Reference:** `packages/core/src/frame/shadow-map.ts` (`_recordShadowPasses` —
unconditional per-frame depth render; the engine-owned shadow array that a
per-slot dirty cache would key on); the Stage-4 decision to keep `Light` as plain
per-frame value data (this optimization does not require reversing it).
