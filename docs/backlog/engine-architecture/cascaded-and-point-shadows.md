---
summary: cascaded directional shadow maps and point-light cube shadows — the two coverage subsystems one shadow map per caster fences out, both extensions of the shipped depth pass rather than a different foundation
---

# Advanced shadows — cascaded (CSM) + point-light cube maps

Deferred out of the Visual Fidelity epic, whose Stage 4
ships **one shadow map per caster** covering spot + orthographic directional
lights (both single-map). Two genuine subsystems are fenced out:

- **Cascaded shadow maps (CSM)** — a single orthographic directional map has poor
  resolution over a large view frustum; quality at scene scale needs frustum
  splitting into multiple cascades with per-cascade maps and a selection in the
  shader. (Fine to skip while the demo scene is small, e.g. the bowling alley.)
- **Point-light cube-map shadows** — omnidirectional shadows need a cube map
  (6 depth renders) or a dual-paraboloid/distance variant. The most expensive
  shadow path; deferred because Stage 4's point lights simply won't cast shadows.

Both build on Stage 4's single-map plumbing (depth-only pass, compare sampler,
bias, PCF) — they are quality/coverage extensions, not a different foundation.

That holds for the whole shadow follow-on family, not just these two: every deferral filed
against the Stage-4 substrate — auto-fit, resolution/kernel knobs, the duplicated texel
literal, static-map caching, per-mesh opt-in, instanced casters, alpha-tested casters, the
lighting/shadow weld — is an additive extension or a hygiene finding on it, and **none of
them requires a different foundation.**

**Trigger to revisit:** a demo whose scene is large enough that single-map
directional shadows look low-res (→ CSM), OR a demo that needs a point light to
cast shadows (→ cube maps).

**Reference:** `shared-pipeline-cache-factory.md` (the depth-only shadow pipeline as the
third pipeline-building site).

**Update (Stage 4, 2026-06-08):** The single-map shadow substrate this entry builds on has now
LANDED — a depth-only caster pass (`frame/shadow-map.ts`), a comparison sampler, and a
`texture_depth_2d_array` indexed by light slot (engine-owned; `Light` stays plain per-frame data).
CSM (directional cascades) and point-light cube shadows are now true extensions of this foundation:
CSM splits the directional frustum into multiple layers of the same array + adds a per-cascade
selection in the shader; cube shadows add 6 depth renders per point light. Neither needs a different
foundation — both reuse the depth pass, the comparison sampler, and the `texture_depth_2d_array`
plumbing that shipped in Stage 4.
