---
summary: three per-ctx cache key-builders hand-enumerate the fields they hash, so a field added later silently collapses two distinct configs onto one key and the cache returns the wrong object
---

# Cache-key builders are not field-exhaustive by construction

*Adjacent finding. Surfaced during Visual Fidelity Stage 1, Task 5 (sampler cache) code-quality review, 2026-06-05.*

Several per-ctx cache key-builders hand-enumerate the fields they hash into a
`|`-joined string. If someone later adds a field to the keyed type but forgets to
add it to the key-builder body, two distinct configs silently collapse to the same
key and the cache returns the **wrong** object — a quiet correctness bug, not a
crash.

Known instances of the pattern (all the same shape):
- `packages/core/src/texture/sampler-cache.ts` — `keyOf(p: Required<SamplerParams>)`
  joins 6 fields. `Required<SamplerParams>` forces all fields to be *present* at the
  call, but does NOT force the body to *enumerate* them.
- `packages/core/src/material/material.ts` — `_blendSignature(blend)`.
- `packages/core/src/post/pipeline.ts` — `blendSignature(blend)`.

This is an accepted house pattern today (it predates Stage 1), so it was NOT changed
inline in Task 5 — closing it cleanly is a cross-cutting decision that should apply to
all three builders at once, not a one-off.

## Fix shape

Options to evaluate when this is picked up:
- **Compile-time exhaustiveness assert** — derive the key from `Object.keys` of a
  canonical ordered field list typed so that omitting a field is a type error, or a
  `satisfies`-style check that the enumerated tuple covers `keyof T`.
- **`Object.entries`-driven key** — sort entries and join, so new fields are included
  automatically (cost: must guarantee stable key ordering + that all values stringify
  collision-safely; the current `|` separator is safe because the GPU enum value sets
  contain no `|`).

Pick one and apply it uniformly to `keyOf`, `_blendSignature`, and `blendSignature`.

## What to verify when fixing
- Adding a field to `SamplerParams` / `GPUBlendState` usage without updating the
  key-builder becomes a compile error (or is auto-included), proven by a deliberate
  test/edit.
- No key collisions for the existing field sets (separator-safety preserved).
- All three builders share one approach.

## Trigger to revisit
- Next time a field is added to `SamplerParams`, the material blend signature, or the
  post blend signature — OR a dedicated cache/key-builder hygiene tranche. Until then,
  the risk is latent and matches long-standing existing helpers.

## Reference
- `packages/core/src/texture/sampler-cache.ts`, `packages/core/src/material/material.ts`,
  `packages/core/src/post/pipeline.ts`.
