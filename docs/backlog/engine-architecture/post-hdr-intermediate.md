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

**Demo evidence motivating this:** hello-world's normalColor cube top
face (`+Y` normal → `(0.5, 1.0, 0.5)`, linear luminance 0.857) blooms
identically to the intended emissive cube because single-pass
screen-space bloom can only threshold on luminance — it has no way to
distinguish "bright because emissive" from "bright because lit". A
proper emissive output channel on an `rgba16float` intermediate (where
emissive surfaces write > 1.0 and lit surfaces stay ≤ 1.0) is the only
clean separator. Until that lands, any lit material whose colour
crosses the bloom threshold will leak halo.

**Reference:** `docs/superpowers/specs/2026-05-24-core-tranche-6-post-process-design.md` §1 Out.
