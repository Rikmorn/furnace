# Render-state completeness — the unexposed `GPURenderPipeline` fixed-function surface

`MaterialDescriptor` deliberately exposes a **subset** of WebGPU render-state — the knobs demos actually need: `primitive` (`cullMode`, `topology`), the `depth` union (`false | { write?, compare? }`), and `blend` (+ `material.blend.*` presets). The rest of the `GPURenderPipeline` fixed-function surface is hardcoded or omitted, by scope-to-current-need. This entry catalogs what's missing so it isn't re-discovered each time, each with its own trigger.

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

The signature regrouping (grouping render-state the way WebGPU does — `primitive{}` plus a `depth?: false | {…}` union, with `multisample{}` etc. to follow) **landed in D-1's** breaking descriptor reshape (2026-05-31): `MaterialDescriptor` now uses `primitive{ topology, cullMode }` and the `depth` union. Future render-state fields (the rows above) slot into that grouping — add each once, in the WebGPU-shaped group it belongs to, rather than re-flattening.

**Trigger to revisit:** per-row above. MSAA is the most likely first mover (visual quality). None has fired as of 2026-05-30.

**Reference:** D brainstorm 2026-05-30. Render-state is immutable create-time data (baked into the pipeline) — all of these are descriptor *fields*, never setters. The D-1 signature regrouping (which landed the `primitive{}`/`depth` grouping these fields slot into, 2026-05-31) is recorded in the `_AUDIT-2026-05-26.md` D-1 row.
