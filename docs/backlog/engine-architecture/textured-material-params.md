---
summary: `texturedLit` bakes specular as an engine constant because its `@group(1)` is sampler-plus-texture only; lifting the texture-or-binding exclusivity is step one of textured-material params, so decide the general shape rather than a specular one-off
---

# Per-material params on textured materials — specular now, PBR params later

`texturedLit` shades its sampled albedo with the same multi-light Blinn-Phong
model as `lit`, but its specular is a **fixed engine constant** — `FR_TL_SPEC =
vec3(0.04)` / `FR_TL_SHININESS = 32.0` baked into `TEXTURED_LIT_SRC`
(`packages/core/src/shader/builtins.ts`). `lit` carries per-material specular
because its `@group(1)` is a `{ color, specular }` uniform; `texturedLit` cannot,
because its `@group(1)` is **sampler + texture only**.

## The framing (decide this first — the shape follows)

The concrete trigger is "let a textured surface choose its own specular," but the
*real* question is broader and worth deciding deliberately:

> **Can a textured material carry an optional typed *material-params* uniform —
> of which `specular` is just the first field?**

Framed that way, this is **step one of "textured material + material params,"
i.e. the PBR direction** (albedo map alongside roughness / metallic / specular —
as uniforms now, maps later). The cheap version (a specular-only uniform) and the
general version (a params block) are the **same plumbing** — only the layout
schema differs. So the decision that matters isn't "add a specular uniform to
`texturedLit`"; it's whether to design the general "texture + params uniform"
capability so it **generalises to PBR** (see `pbr-material-pipeline.md`) instead
of being a one-off that gets reworked. Decide the framing when picked up; the
exact descriptor / API shape is deliberately left open until then.

## What's technically blocked (context, not a prescribed shape)

The blocker is the `texture ⊕ binding` exclusivity in `material.create`:
`MaterialDescriptor.texture` and `.binding`/`.bindings` are mutually-exclusive
`@group(1)` sources — exactly one fires (the "mutually exclusive `@group(1)`
sources" guard in `packages/core/src/material/material.ts`). A textured material's
`@group(1)` is consumed by `sampler@0 + texture@1`, leaving no slot for a params
uniform. Lifting it means letting `@group(1)` carry a texture AND a typed uniform
together (a `@binding(2)` uniform after sampler+texture). One wrinkle to remember
so it isn't mistaken for a one-liner: the typed `binding` path today assumes its
uniform sits at `@binding(0)`, so it needs a base-offset when a texture precedes
it — that offset coupling is what makes it a deliberate `material.create` change.
(`texturedLit` would also gain a real `layout` — it's `null` today.)

**Independent of Stage 4** (shadows don't touch material params) — a standalone
tranche that can land before or after shadows with no interaction.

**Trigger to revisit:** art needs per-surface specular / glossiness on textured
materials, OR the PBR material work begins — at which point design the *general*
texture + params-uniform capability, not a specular one-off.

**Reference:** `packages/core/src/shader/builtins.ts` (`TEXTURED_LIT_SRC` —
`FR_TL_SPEC` / `FR_TL_SHININESS`); `packages/core/src/material/material.ts` (the
`texture ⊕ binding`/`bindings` guard); `pbr-material-pipeline.md` (the
generalisation target this should feed, not pre-empt).
