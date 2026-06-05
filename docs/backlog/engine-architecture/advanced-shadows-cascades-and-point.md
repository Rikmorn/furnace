# Advanced shadows — cascaded (CSM) + point-light cube maps

Deferred out of the Visual Fidelity epic
(`docs/superpowers/specs/2026-06-05-visual-fidelity-epic-design.md`), whose Stage 4
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

**Trigger to revisit:** a demo whose scene is large enough that single-map
directional shadows look low-res (→ CSM), OR a demo that needs a point light to
cast shadows (→ cube maps).

**Reference:** `docs/superpowers/specs/2026-06-05-visual-fidelity-epic-design.md` §5.4;
`shared-pipeline-factory.md` (depth-only shadow pipeline).
