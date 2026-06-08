# Transparent / alpha-tested shadow casters

Stage 4's shadow casters are **opaque only**. The depth-only caster pipeline
(`frame/shadow-map.ts` `_ensureShadowCasterPipeline`) writes solid depth with no
fragment-side alpha handling — there is **no alpha test** (no `discard` on a
sampled alpha threshold) and no alpha-to-coverage. Every caster contributes a
fully-opaque silhouette to the depth map regardless of its material's blend state
or texture alpha.

Consequences when this matters:

- An **alpha-tested** caster (cutout foliage, chain-link fence, a leaf texture)
  casts a solid rectangular shadow of its quad, not the cutout silhouette.
- A **blended / translucent** caster (glass, smoke) casts a fully-opaque shadow as
  if solid, with no attenuation.

Correct alpha-tested shadows need the caster pipeline to sample the albedo's alpha
and `discard` below a threshold (a fragment shader on the depth pass + the texture
binding, which the current depth-only caster intentionally omits). Translucent
shadows are a harder, separate problem (colored/attenuated shadow maps, deep
shadow maps) — out of scope of even the alpha-test fix.

**Trigger to revisit:** an alpha-tested caster (cutout textures) needs its true
silhouette in shadow, OR a blended caster needs attenuated/colored shadows.

**Reference:** `packages/core/src/frame/shadow-map.ts`
(`_ensureShadowCasterPipeline` — depth-only, no fragment alpha test);
`transparent-shadow-casters` is the alpha-test side; colored/translucent shadows
would be a further follow-on.
