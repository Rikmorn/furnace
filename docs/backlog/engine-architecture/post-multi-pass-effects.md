# Post: multi-pass effects

Tranche 6's post API is single-pass: each Effect runs one fullscreen-quad
pass, reading the previous output and writing to the next intermediate
(or swapchain). This is enough for: bloom-approximation, vignette,
color grading, sharpen, chromatic aberration, film grain, simple
tonemap (without auto-exposure), CRT/scanline filters, simple FXAA.

What it can't express:
- **Multi-input passes** — reading multiple textures (color + depth +
  normal + velocity), not just the previous effect's output.
- **Different-sized intermediates** — half/quarter-resolution targets
  for downsample chains.
- **Cross-frame history** — TAA needs the previous frame's output
  retained across frames.
- **Compute passes** between fragment passes — luminance histograms,
  particle simulation, sort/scan.

Concrete second cases that would trigger this work:
- **Real bloom** — bright-pass extract → downsample chain (5-6 mips)
  → upsample with blur at each level → composite. ~10 passes.
- **SSAO** — sample depth+normal, compute AO, separate blur to denoise.
- **Depth of field** — extract CoC → downsample → separable bokeh →
  composite. Multi-input + multi-resolution.
- **Screen-space reflections** — march rays against depth, blur, composite.
- **Temporal anti-aliasing** — needs persistent history target.
- **Motion blur** — needs velocity buffer from the scene pass.
- **Tonemapping with auto-exposure** — compute pass for luminance
  histogram → exposure value → tonemap.
- **Separable Gaussian blur** as a building block — horizontal +
  vertical = 2 passes.

Likely shape:
- Effect descriptor grows fields for intermediate declarations
  (`requests: [{ scale: 0.5, format: ..., persistFrames: 1 }]`) and
  for input bindings beyond "previous pass."
- Engine grows a target pool keyed by `(size, format)` with frame
  scoping rules.
- `frame.render` orchestration grows a small graph evaluator.

Design risk: doing this without a concrete second case to validate
against risks the wrong abstraction. Wait for a real driver.

**Trigger to revisit:** First of the above concrete cases lands as a
real consumer need, or a tier-2 effect (animation, scene module)
demands cross-frame state.

**Reference:** `docs/superpowers/specs/2026-05-24-core-tranche-6-post-process-design.md` §1 Out.
