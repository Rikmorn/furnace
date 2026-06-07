# Per-material specular on `texturedLit` — needs a `MaterialDescriptor` extension

`texturedLit` shades its sampled albedo with the same multi-light Blinn-Phong
model as `lit`, but its specular is a **fixed engine default** — `FR_TL_SPEC =
vec3(0.04)` (a neutral 4% dielectric grey) and `FR_TL_SHININESS = 32.0`, hard
constants in the shader (see `packages/core/src/shader/builtins.ts`,
`TEXTURED_LIT_SRC`). `lit` carries per-material specular because its `@group(1)`
is a uniform buffer `{ color, specular }`; `texturedLit` *cannot*, because its
`@group(1)` is **sampler + texture only**.

The blocker is the `texture ⊕ binding` exclusivity in `material.create`:
`MaterialDescriptor.texture` and `.binding`/`.bindings` are mutually exclusive
`@group(1)` sources — exactly one fires (see `packages/core/src/material/material.ts`,
the "mutually exclusive `@group(1)` sources" guard). A textured material's
`@group(1)` is consumed entirely by `sampler@0 + texture@1`, leaving no slot for
a specular uniform. So per-material textured specular is not a shader tweak — it
needs a **`MaterialDescriptor` extension that carries a texture AND a specular
uniform together** (e.g. a combined descriptor shape, or relaxing the exclusivity
to allow a texture + a small uniform in the same `@group(1)`), plus the matching
bind-group layout.

**Trigger to revisit:** art needs per-surface specular on textured materials
(varying glossiness across a textured surface, a spec map, etc.) — at which point
design the descriptor extension (texture + specular uniform in one `@group(1)`).

**Reference:** `packages/core/src/shader/builtins.ts` (`TEXTURED_LIT_SRC` —
`FR_TL_SPEC` / `FR_TL_SHININESS`); `packages/core/src/material/material.ts` (the
`texture ⊕ binding`/`bindings` mutual-exclusion guard).
