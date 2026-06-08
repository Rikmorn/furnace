# Shadow mapping: two silent no-shadow bugs (Stage 4)

During Visual Fidelity Stage 4 (shadows), the full feature shipped with **782 passing
tests, clean typecheck/lint, and a passing two-stage review on every task** — and yet
**no shadows rendered at all**. Two independent bugs were caught only by driving
Chrome/Dawn against the live demos and *looking at the pixels*. This note exists so the
next person doing GPU/render work budgets for the right kind of verification.

## The headline lesson

**A GPU test that asserts `popErrorScope() === null` ("the frame renders without a
validation error") does NOT catch a silent *wrong-output* bug.** Shadow mapping is a
data/logic pipeline: a wrong matrix or a wrong bias produces a perfectly *valid* frame
that simply has no shadows in it. Every unit test (matrix maps center → some point),
every GPU test (render runs clean), and every code review passed, because none of them
asserted *"a shadow actually appears."*

Render correctness needs a **visual / pixel** check. Concretely:

- The **Chrome/Dawn strict check** (Playwright vs the live dev servers) is *necessary*
  — it catches **validation-class** errors that permissive headless `bun-webgpu` skips
  (comparison samplers, depth-only array passes, `textureSampleCompareLevel`
  uniformity). All of those were clean here. But it is **not sufficient**: Dawn raised
  zero device errors while shadows were 100% broken.
- The **user's Safari/Chrome visual gate** is the real correctness test for anything
  whose bug mode is "valid frame, wrong pixels."
- You **cannot JS-pixel-sample a WebGPU canvas headless**: `ctx2d.drawImage(canvas)` +
  `getImageData` returns all-black (the `GPUCanvasContext` drawing buffer isn't exposed
  to 2D readback). Use the compositor screenshot (`browser_take_screenshot`) instead.
- The engine **`draws` stat does not count shadow-pass draws** (`_recordDraw` runs only
  on the main pass), so the draw count can't tell you whether the depth pass ran.

## Bug 1 — caster used the UV-remapped matrix as its clip-space output (engine)

The light view-projection baked a clip→UV remap into the stored matrix
(`CLIP_TO_UV · proj · view`), and that **same** matrix was fed to the depth-only caster
vertex shader as its `@builtin(position)`. But `@builtin(position)` must be **raw clip
space** (NDC `xy ∈ [-1,1]` after the perspective divide). Feeding it UV-space `[0,1]`
coordinates makes the rasterizer write the depth into the wrong texture quadrant, so the
receiver samples the *cleared* depth (1.0) everywhere → `textureSampleCompareLevel`
(compare `"less"`) returns "lit" everywhere → no shadows. No validation error, because
nothing is *invalid* — the geometry just lands in the wrong place.

**Fix:** store the **raw `proj · view`** (light clip space). The caster uses it directly
as its clip transform; the **receiver** does the NDC→UV remap *in-shader*
(`uv = ndc.xy * vec2(0.5, -0.5) + vec2(0.5, 0.5)`, y flipped). One matrix, correct for
both endpoints. Verified by checking that the caster's framebuffer texel
`(ndc.x*0.5+0.5, 0.5 - ndc.y*0.5)` equals the receiver's sampled `uv` for the same world
point — they must align exactly, including the y-flip.

## Bug 2 — `depthBias` in the wrong scale (demo config / API footgun)

`fr_shadowFactor` computes `refDepth = ndc.z - depthBias`, where `ndc.z ∈ [0,1]`
(normalized depth). The demos set `depthBias: 1.0` (copied from a plan example that used
`1`). Subtracting `1.0` pushes `refDepth ≤ 0`, so the compare always says the receiver is
in front of the stored depth → lit everywhere → no shadows. Either bug alone produces
zero shadows, which is why fixing only the matrix didn't reveal anything.

**Fix:** demo `depthBias → 0.005` (the WebGPU shadow sample uses `~0.007`), and the
`DirectionalShadow`/`SpotShadow` TSDoc now states the value is **normalized [0,1] depth,
use ~0.001–0.01; values near 1 disable shadows.** Exposing a raw normalized-depth knob is
a footgun — a consumer naturally reads "1" as "one unit."

## What would have caught these earlier

- A test that renders a known caster over a known receiver and **asserts a pixel in the
  expected shadow region is darker than a pixel outside it.** Hard headless (canvas
  readback is black), but feasible by rendering to an offscreen texture and copying it to
  a readback buffer (`copyTextureToBuffer` + `mapAsync`) — worth it for shadow/lighting
  features whose bug mode is "valid frame, wrong pixels."
- Driving the demos visually **before** declaring the feature done — which is exactly
  what the Stage-4 strict check did, and what turned a "green, shipped, broken" feature
  into a "green, shipped, working" one.

See also `webgpu-empty-intermediate-bind-group.md` and the
`project_furnace_primary_browser` memory (Safari/Chrome are stricter than headless
`bun-webgpu` — but even Chrome's *validation* doesn't catch wrong-output logic bugs).
