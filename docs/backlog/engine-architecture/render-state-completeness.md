# Render-state completeness — the unexposed `GPURenderPipeline` fixed-function surface

`MaterialDescriptor` deliberately exposes a **subset** of WebGPU render-state — the knobs demos actually need: `cullMode`, `topology`, `depthWrite`, `depthCompare`, `blend` (+ `material.blend.*` presets), and (after Tranche D) `depthEnabled`. The rest of the `GPURenderPipeline` fixed-function surface is hardcoded or omitted, by scope-to-current-need. This entry catalogs what's missing so it isn't re-discovered each time, each with its own trigger.

Surfaced in the D brainstorm (2026-05-30) when mapping the render-state layer (one of the three material layers: **code** = D-1 / **render-state** = D / **params** = E).

## Missing render-state (all additive when triggered)

| Field | WebGPU home | Today | Trigger to expose |
|---|---|---|---|
| **MSAA** (`multisample.count` + `alphaToCoverageEnabled`) | `multisample` | hardcoded `count: 1` | First want for edge anti-aliasing / visual quality (likely the first of these to fire). Note: MSAA `count` is **pass-coupled** — adding it must extend the attachment-agreement validation (see below) and the engine's render/offscreen attachments must be created multisampled too. |
| **stencil** (compare + fail/pass ops, masks) | `depthStencil.stencil*` | omitted | Masking effects: portals, outlines, decals-by-stencil, UI clipping. |
| **`depthBias`** (+ slopeScale, clamp) | `depthStencil` | omitted | Shadow-acne / z-fighting on coplanar geometry (decals, terrain layers). |
| **`frontFace`** (ccw/cw winding) | `primitive` | hardcoded `ccw` | A consumer with cw-wound geometry, or a flip for mirrored rendering. |
| **configurable depth format** | `depthStencil.format` | hardcoded `depth24plus` | A consumer needing `depth32float` (precision) or `depth24plus-stencil8` (with stencil). Couples to the engine's depth-texture allocation in `frame/render.ts`. |
| **configurable color-target format** | `fragment.targets[].format` | hardcoded `ctx.format` | An HDR float offscreen target (e.g. real bloom rendering to `rgba16float`) via `renderToTexture`. |
| **color `writeMask`** | `fragment.targets[]` | omitted (all) | Channel-selective writes (e.g. write alpha only). |

## Pass-coupled vs pipeline-internal (the organizing distinction)

Render-state splits two ways, and it matters for validation:
- **Pass-coupled** (must agree with the render pass's attachments or WebGPU silently fails validation): **color-target format, depth presence, depth format, MSAA sample count.**
- **Pipeline-internal** (no pass dependency): cull, topology, frontFace, depthWrite, depthCompare, blend, writeMask, depthBias, stencil ops.

**Tranche D (2026-05-30) made the currently-realizable pass-coupled agreement loud** in `frame.renderToTexture`: color format (`opts.texture.format === ctx.format`), depth presence (`material.depthEnabled === (depthTexture provided)`), depth format (`depthTexture.format === "depth24plus"`). `frame.render` only needs the depth-presence check (it controls both attachments). **Any future pass-coupled state (MSAA count, configurable formats) MUST extend that agreement check** — otherwise it reopens the silent-frozen-frame failure class D closed.

## Signature note

When render-state grows, the flat `MaterialDescriptor` fields become a grab-bag. The signature regrouping (grouping render-state the way WebGPU does — `primitive{}`/`depthStencil{}`/`multisample{}` — and collapsing the conditional depth fields into a `depth?: false | {…}` union) is tracked as part of **D-1's** breaking descriptor reshape — see `shader-resource.md`. Don't regroup piecemeal; do it once in that reshape.

**Trigger to revisit:** per-row above. MSAA is the most likely first mover (visual quality). None has fired as of 2026-05-30.

**Reference:** D brainstorm 2026-05-30. Render-state is immutable create-time data (baked into the pipeline) — all of these are descriptor *fields*, never setters. Cross-refs `shader-resource.md` (D-1 signature regrouping), `docs/superpowers/specs/2026-05-30-d-depth-enabled-design.md` (the pass-coupled validation D shipped).
