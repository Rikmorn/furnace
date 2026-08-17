---
summary: a metallic-roughness Cook-Torrance path is a cohesive follow-on epic rather than a stage — the BRDF is small, but IBL and tangent-space normal mapping are two real subsystems behind it
---

# PBR material pipeline (metallic-roughness + IBL + normal mapping)

Deferred out of the Visual Fidelity epic, which ships a **Blinn-Phong**
reference shader instead. A physically-based
metallic-roughness pipeline is a cohesive follow-on epic, not a stage, because
"minimal PBR" is a misnomer: the Cook-Torrance BRDF itself (~30–50 lines WGSL) is
small, but to not look *worse* than Blinn-Phong it drags in two genuine subsystems:

- **IBL** — a prefiltered specular cubemap + irradiance map + a BRDF LUT
  (split-sum). PBR lit by analytic lights alone reads dark/flat with no ambient
  specular energy.
- **Normal mapping** — needs tangent-space, and furnace `GeometryData` carries
  only `positions/normals/uvs` (verified `geometry/types.ts`, 2026-06-05) — no
  tangent attribute. So this adds a vertex attribute (tangent generation across
  the primitive factories) + a TBN basis in the shader.

The lighting *enablement* built in the Visual Fidelity epic (light data resource,
multi-light buffer, shadow maps) is **BRDF-agnostic**, so swapping Blinn-Phong →
Cook-Torrance later is "a different reference shader against the same light
buffer," not a rewrite. This epic pairs naturally with — and should precede or
merge with — the glTF asset epic, since glTF **is** metallic-roughness PBR and
needs the same IBL + normal-map + tangent machinery.

**Trigger to revisit:** after the Visual Fidelity epic lands shadows, OR when the
glTF asset epic starts (whichever first) — glTF forces the same machinery.

**Reference:** `gltf-import-path.md` (the glTF asset epic this pairs with).
