# Shared `STANDARD_VERTEX_LAYOUT` constant — extract on the 3rd consumer

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

The standard pos / normal / uv vertex buffer layout (stride 32 bytes:
`vec3 position` + `vec3 normal` + `vec2 uv`) is now declared in **two** sites:

- `packages/core/src/material/material.ts` — `VERTEX_BUFFER_LAYOUT` (the main
  scene-pass pipeline).
- `packages/core/src/frame/shadow-map.ts` — the depth-only caster pipeline declares
  its own copy (`SHADOW_VERTEX_STRIDE` + inline attributes); the caster only reads
  position but must match the same buffer stride/layout the meshes are uploaded with.

This is the **2nd occurrence**, which is tolerable under the repo's "duplication
until the 3rd consumer" posture — extracting now would be premature. Both copies
must stay in sync (if the standard vertex layout's stride or attribute offsets ever
change, both pipelines break), but two sites is manageable.

**Trigger to revisit:** a **3rd** pipeline consumer of this layout lands — likely a
depth-prepass, GPU picking, or wireframe pass. At that point extract a shared
`STANDARD_VERTEX_LAYOUT` (e.g. in `material/` or a `gpu/` vertex-layout module) and
have all three import it.

**Reference:** `packages/core/src/material/material.ts` (`VERTEX_BUFFER_LAYOUT`);
`packages/core/src/frame/shadow-map.ts` (the caster pipeline's duplicate layout).
