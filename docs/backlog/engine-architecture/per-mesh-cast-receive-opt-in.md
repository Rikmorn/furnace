# Per-mesh cast / receive shadow opt-in

Stage 4's shadow policy is **uniform, not per-mesh**:

- **Casting** — every opaque mesh drawn in a frame is also drawn into the depth-only
  caster pass (`frame/shadow-map.ts` `_recordShadowPasses`). There is no per-mesh
  `castShadow` flag; you cannot exclude a specific mesh from casting.
- **Receiving** — a material receives shadows iff it `usesShadows` (the shader flag
  threaded through `_createShader` / `MaterialSlot.usesShadows`). Receiving is a
  *material* property, not a *mesh* property; there is no per-mesh `receiveShadow`.

This is intentionally simpler than three.js's per-`Object3D` `castShadow` /
`receiveShadow` booleans. For the Stage 4 bowling scene every solid object should
both cast and receive, so the uniform policy is correct and avoids per-mesh state.

Adding opt-out is additive: a per-mesh `castShadow` flag would gate inclusion in the
depth pass; per-mesh receive is murkier because receiving is currently a
material/shader-flag concern, so per-mesh receive would need either a material
variant or a per-draw uniform — a small design decision, not just a flag.

**Trigger to revisit:** a mesh that must be **excluded from casting** (e.g. a large
ground plane that should receive but not self-cast, a skybox, a debug gizmo), OR a
mesh that must not receive shadows while sharing a material with meshes that do.

**Reference:** `packages/core/src/frame/shadow-map.ts` (`_recordShadowPasses` —
all opaque meshes cast); `packages/core/src/shader/shader.ts` (`usesShadows` flag —
receiving is per-material, not per-mesh); `packages/core/src/material/material.ts`
(`MaterialSlot.usesShadows`).
