# Post: HDR intermediate target (rgba16float)

Tranche 6 ships single-pass approximation bloom with intermediates matching
`ctx.format` (typically `bgra8unorm-srgb`). Values clamp to [0,1]; no HDR
headroom. For "real" bloom (multi-pass downsample chain) and tone mapping
with auto-exposure, intermediates need `rgba16float` so bright lights
can store at intensity > 1.0 and bloom can extract real highlights.

Likely shape:
- New option on `frame.render` / `frame.renderToTexture`, or a
  ctx-level override (`gpu.requestContext({ postFormat: "rgba16float" })`).
- `post/intermediate.ts` resolves the format from ctx + options.
- Cost: 2x memory bandwidth on intermediates, slightly slower sampling.
- Requires GPU feature support for storage-bindable float-target textures
  (most modern GPUs; needs a feature-flag check on the adapter).

**Trigger to revisit:** First effect needing values > 1.0 — real bloom
(downsample chain), tone mapping with auto-exposure, depth-of-field, or
any HDR rendering path.

**Reference:** `docs/superpowers/specs/2026-05-24-core-tranche-6-post-process-design.md` §1 Out.
