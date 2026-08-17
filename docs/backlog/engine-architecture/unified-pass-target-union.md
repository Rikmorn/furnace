---
summary: folding `frame.render` and `frame.renderToTexture` behind one `{ target }` union was weighed and rejected on R8 abstraction-tier grounds; revisit only at a higher-tier render-graph that wants a unified pass descriptor
---

# `render` / `renderToTexture` unified pass-target union

A-8's API-posture sweep considered unifying `frame.render(ctx, opts)` and `frame.renderToTexture(ctx, opts)` behind a single command taking a target union — e.g. `frame.render(ctx, { target: "swapchain" | { texture }, draw, camera, … })`. **Rejected for the current tier.**

**Why rejected:** `@furnace/core` is a low-level, unopinionated GPU-resource layer (`api-posture.md` R8 — the guiding "abstraction tier" principle). The two explicit functions keep each command's options honest: `render` carries the post-effects chain + swapchain semantics; `renderToTexture` carries a consumer-supplied `GPUTexture` + optional depth and *no* effects chain. A `{ target }` union forces a discriminated-options shape whose valid field-combinations vary by target — pushing branching + validation into the command and reducing the generality of each primitive. (The three.js precedent — stateful `setRenderTarget` + `render` — is *worse* than furnace's explicit split; the wgpu/sokol tier furnace sits at keeps separate explicit calls. See `docs/research/2026-05-29-api-posture-prior-art.md`.)

**Trigger to revisit:** A higher-tier render-graph / multi-pass module (`multi-camera-frames.md`, `multi-pass-post-effects.md`) that wants a unified pass descriptor. At that tier a unified `Pass`/target abstraction is appropriate — built *on top* of the two low-level commands, not replacing them (`api-posture.md` R8 consequence 1: higher abstractions build on top, not into).

**Reference:** A-8 API-posture tranche (2026-05-29). Canon: `docs/reference/api-posture.md` (R8 abstraction tier; Command function-kind). Prior art: `docs/research/2026-05-29-api-posture-prior-art.md`. Related: `multi-camera-frames.md`, `multi-pass-post-effects.md`.
