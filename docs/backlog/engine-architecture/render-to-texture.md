# Render-to-texture / offscreen rendering

A `frame.renderToTexture(ctx, { texture, ... })` variant that renders into a consumer-owned texture instead of the swapchain. Foundational for: shadow maps, planar reflections, post-process chains beyond single-pass, GPU-side debug captures, mini-map cameras, picture-in-picture.

Internally similar to `frame.render` but targets a different color attachment (and optionally depth attachment). The convenience tier hides the texture lifecycle (transient render targets allocated from a pool?); the mechanical tier (`frame.encode`) already exposes this — consumer can use raw WebGPU to render to any texture they create.

Open design questions: pool vs explicit-create lifetime for render-target textures (pool means transparent reuse but couples to engine state; explicit means consumer-managed); format compatibility (MSAA targets need resolving; depth targets need separate handling); how multi-pass chains compose (manually link textures via consumer code vs declarative pass graph).

Likely the entry point for the `post` module's deeper effects too — a multi-pass bloom does several render-to-texture passes internally.

**Trigger to revisit:** First effect requiring an offscreen target — bloom (which we have in Tier 1 `post` but as a single-pass approximation initially) graduating to a "real" bloom, OR shadow maps, OR a UI element rendered to a texture.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Deferred decisions".
