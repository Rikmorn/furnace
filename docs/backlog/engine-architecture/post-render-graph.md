# Post: runtime render-graph / FrameGraph (T3)

Stage 2 (Visual Fidelity epic) ships **T2** — a managed, *linear*, declarative
multi-pass post chain: an effect/pass declares its inputs (`sceneHDR` / `prevOutput`
/ named intermediates) and output (resolution scale + format); the engine owns a
transient target pool keyed by `(size, format)` plus a linear evaluator; the whole
chain records into one command encoder / one submit. This is the three.js/Babylon
embeddable tier — enough to express tonemap + bloom (multi-resolution + multi-input
*within the post chain*).

This entry tracks the **T3** tier that Stage 2 deliberately fences out — the genuine
subsystem (Filament FrameGraph / Bevy render-graph class):

- **Pass culling** — drop passes whose outputs are unreferenced.
- **Transient-memory aliasing** — alias physical GPU memory across virtual resources
  with non-overlapping lifetimes (the AAA win; pure cost at a handful of effects).
- **Cross-frame history** — persistent targets retained across frames (TAA, temporal
  upsampling, motion blur accumulation).
- **Scene-side G-buffer inputs** — passes reading depth / normal / velocity buffers
  produced by the scene pass, not just the previous post output. (Today the scene pass
  produces one color attachment + an engine-private depth texture; exposing depth/normal/
  velocity to post is the prerequisite for DoF/SSAO/SSR/motion-blur.)
- **Compute passes between fragment passes** — luminance histograms (auto-exposure),
  particle sim, sort/scan.

**Relationship to `post-multi-pass-effects.md`:** Stage 2's T2 **resolves** that entry's
"multi-input + different-sized intermediates *within the post chain*" cases. The remaining
items it lists (cross-frame history, compute passes, multi-input from scene buffers) move
here.

**Trigger to revisit:** the first real driver lands — depth-of-field, SSAO, SSR, TAA,
motion blur, or auto-exposure (compute) — **or** effect count + transient-target count
grows enough that VRAM aliasing is worth the FrameGraph's complexity. Designing it without
one of those risks the wrong abstraction (the same caution that kept the pre-T2 chain simple).

**Reference:** Prior art: Filament FrameGraph, Bevy render graph. Distinct from `post-node-graph-editor.md`
(a consumer-facing *tool*, not a runtime).
