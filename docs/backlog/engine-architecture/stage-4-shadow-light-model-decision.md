# Stage-4 shadow light-model decision — atlas-by-slot vs. light-as-resource

Stage 3 Phase 2 keeps `Light` as **plain per-frame value data** — a discriminated
union (`directional | point | spot`) with no handle, no lifecycle, mirroring the
`Camera` posture (see `packages/core/src/frame/lights.ts`). That posture works
because a light owns no GPU resource: it is packed into the Scene UBO each frame
by `_packScene` and read by the lit shaders.

Shadows break that. A shadow-casting light needs a **depth map** associated with
it, which is a GPU resource with a lifetime. Two shapes resolve this, and the
choice is **driven by the shadow technique**, so committing now would pre-commit
the technique:

- **Engine-owned shadow atlas indexed by light *slot*** — keeps `Light` as plain
  data; the engine allocates a depth atlas and the shader indexes it by the
  light's position in the per-frame list. Natural for shadow maps / a fixed-size
  atlas; the light stays a value type.
- **Promote `Light` to a resource that owns its shadow map** — the light gains a
  handle + lifecycle (like a texture). Natural if each light's shadow data has an
  independent lifetime (RT / VSM with per-light filtered maps).

The technique (basic shadow maps / stencil shadows / ray-traced / variance VSM)
dictates which is cleaner. Light **cookies/gels/gobos** share the same
"per-light owns/references a GPU resource" question (see
`light-cookies-gels-gobos.md`) and should be decided together with shadows, since
both reuse the light-space-projection + per-light-texture machinery.

**Trigger to revisit:** Stage 4 (shadows) begins — make this decision before
building the shadow plumbing, alongside the cookie/gobo modelling question.

**Reference:** `packages/core/src/frame/lights.ts` (the current plain-data
`Light` union + `_packScene`); `light-cookies-gels-gobos.md` and
`advanced-shadows-cascades-and-point.md` (the shared per-light-resource question);
the Visual Fidelity epic Stage 4.
