---
summary: what `frame.*` cannot express yet: unexposed `GPURenderPipeline` state, a pass-target union, multi-camera frames, and a scalable clock
---

# Frame surface gaps

Tracker for **what `frame.*` cannot express yet** — the render-pass and clock surface the
module deliberately keeps narrow. Each section is one previously standalone entry, keeping
its Context, *Trigger to revisit* and *Reference*.

They are merged because each names a different axis of the same public surface: the
fixed-function `GPURenderPipeline` state that is not exposed, whether the on-screen and
render-to-texture forms should share one pass-target union, whether a frame may drive more
than one camera, and whether the clock a consumer drives can be scaled. Every one of them
is an API-shape question rather than a defect, and each is expected to be settled at the
code by the first consumer that needs it — `render-pass-target-union` already has one such
answer recorded against it (`docs/reference/api-posture.md` cites this section by name for
the R8-tier argument it weighed and rejected). Sections are ordered pipeline state → pass
targets → cameras → clock.

## Render-state completeness — the unexposed `GPURenderPipeline` fixed-function surface

`MaterialDescriptor` deliberately exposes a **subset** of WebGPU render-state — the knobs demos actually need: `primitive` (`cullMode`, `topology`), the `depth` union (`false | { write?, compare? }`), and `blend` (+ `material.blend.*` presets). The rest of the `GPURenderPipeline` fixed-function surface is hardcoded or omitted, by scope-to-current-need. This entry catalogs what's missing so it isn't re-discovered each time, each with its own trigger.

Surfaced in the D brainstorm (2026-05-30) when mapping the render-state layer (one of the three material layers: **code** = D-1 / **render-state** = D / **params** = E).

### Missing render-state (all additive when triggered)

| Field | WebGPU home | Today | Trigger to expose |
|---|---|---|---|
| **MSAA** (`multisample.count` + `alphaToCoverageEnabled`) | `multisample` | hardcoded `count: 1` | First want for edge anti-aliasing / visual quality (likely the first of these to fire). Note: MSAA `count` is **pass-coupled** — adding it must extend the attachment-agreement validation (see below) and the engine's render/offscreen attachments must be created multisampled too. |
| **stencil** (compare + fail/pass ops, masks) | `depthStencil.stencil*` | omitted | Masking effects: portals, outlines, decals-by-stencil, UI clipping. |
| **`depthBias`** (+ slopeScale, clamp) | `depthStencil` | omitted | Shadow-acne / z-fighting on coplanar geometry (decals, terrain layers). |
| **`frontFace`** (ccw/cw winding) | `primitive` | hardcoded `ccw` | A consumer with cw-wound geometry, or a flip for mirrored rendering. |
| **configurable depth format** | `depthStencil.format` | hardcoded `depth24plus` | A consumer needing `depth32float` (precision) or `depth24plus-stencil8` (with stencil). Couples to the engine's depth-texture allocation in `frame/render.ts`. |
| **configurable color-target format** | `fragment.targets[].format` | ~~hardcoded `ctx.format`~~ **RESOLVED mid-chain (T2 Stage 2b):** mid-chain post passes target `workingColorFormat` (`rgba16float` under HDR) or an explicit `PassDescriptor.output.format`; the final pass targets `ctx.format`. For `renderToTexture`, the consumer must supply a texture matching the working color format (validated at call time). The `materialDescriptor` still hardcodes the scene-pass target format to the working color format (correct, not a gap). | (none remaining for material pipelines; resolved for post chain) |
| **color `writeMask`** | `fragment.targets[]` | omitted (all) | Channel-selective writes (e.g. write alpha only). |

### Pass-coupled vs pipeline-internal (the organizing distinction)

Render-state splits two ways, and it matters for validation:
- **Pass-coupled** (must agree with the render pass's attachments or WebGPU silently fails validation): **color-target format, depth presence, depth format, MSAA sample count.**
- **Pipeline-internal** (no pass dependency): cull, topology, frontFace, depthWrite, depthCompare, blend, writeMask, depthBias, stencil ops.

**Tranche D (2026-05-30) made the currently-realizable pass-coupled agreement loud** in `frame.renderToTexture`: color format (`opts.texture.format === ctx.format`), depth presence (`material.depthEnabled === (depthTexture provided)`), depth format (`depthTexture.format === "depth24plus"`). `frame.render` only needs the depth-presence check (it controls both attachments). **Any future pass-coupled state (MSAA count, configurable formats) MUST extend that agreement check** — otherwise it reopens the silent-frozen-frame failure class D closed.

### Signature note

The signature regrouping (grouping render-state the way WebGPU does — `primitive{}` plus a `depth?: false | {…}` union, with `multisample{}` etc. to follow) **landed in D-1's** breaking descriptor reshape (2026-05-31): `MaterialDescriptor` now uses `primitive{ topology, cullMode }` and the `depth` union. Future render-state fields (the rows above) slot into that grouping — add each once, in the WebGPU-shaped group it belongs to, rather than re-flattening.

**Trigger to revisit:** per-row above. MSAA (`multisample.count` + `alphaToCoverageEnabled`) is the most likely first mover (visual quality). The configurable color-target-format row is resolved for the post chain (T2 Stage 2b); it was never an open gap for material pipelines (which correctly target the working color format). As of 2026-06-06: MSAA still deferred.

**Reference:** D brainstorm 2026-05-30. Render-state is immutable create-time data (baked into the pipeline) — all of these are descriptor *fields*, never setters. They slot into the `primitive{}`/`depth` grouping that the D-1 signature regrouping landed (2026-05-31); see `MaterialDescriptor` in `docs/reference/core-modules.md`.

**Update (Stage 4, 2026-06-08):** The `depthBias` / `depthBiasSlopeScale` row is now **realized** — not on `MaterialDescriptor`, but internally on the depth-only shadow caster pipeline (`frame/shadow-map.ts` `_ensureShadowCasterPipeline`), where slope-scaled depth bias fights shadow acne on the caster's depth render. It is not yet exposed as a consumer-facing descriptor field; the row stays open for the general "coplanar geometry z-fighting" trigger (decals, terrain layers), but the implementation precedent now exists. Separately, the pass-coupled validation distinction (above) now covers a new pass shape: the depth-only shadow pass has **no color target**, uses **`depth32float`**, and is **single-sample** — a concrete instance of the pass-coupled agreement (color-target presence, depth format, sample count) this entry organizes.

## `render` / `renderToTexture` unified pass-target union

A-8's API-posture sweep considered unifying `frame.render(ctx, opts)` and `frame.renderToTexture(ctx, opts)` behind a single command taking a target union — e.g. `frame.render(ctx, { target: "swapchain" | { texture }, draw, camera, … })`. **Rejected for the current tier.**

**Why rejected:** `@furnace/core` is a low-level, unopinionated GPU-resource layer (`api-posture.md` R8 — the guiding "abstraction tier" principle). The two explicit functions keep each command's options honest: `render` carries the post-effects chain + swapchain semantics; `renderToTexture` carries a consumer-supplied `GPUTexture` + optional depth and *no* effects chain. A `{ target }` union forces a discriminated-options shape whose valid field-combinations vary by target — pushing branching + validation into the command and reducing the generality of each primitive. (The three.js precedent — stateful `setRenderTarget` + `render` — is *worse* than furnace's explicit split; the wgpu/sokol tier furnace sits at keeps separate explicit calls. See `docs/research/2026-05-29-api-posture-prior-art.md`.)

**Trigger to revisit:** A higher-tier render-graph / multi-pass module (see the *Multi-camera / multi-pass scenes* section, `post-chain-follow-ons.md` *Post: multi-pass effects* section) that wants a unified pass descriptor. At that tier a unified `Pass`/target abstraction is appropriate — built *on top* of the two low-level commands, not replacing them (`api-posture.md` R8 consequence 1: higher abstractions build on top, not into).

**Reference:** A-8 API-posture tranche (2026-05-29). Canon: `docs/reference/api-posture.md` (R8 abstraction tier; Command function-kind). Prior art: `docs/research/2026-05-29-api-posture-prior-art.md`. Related: the *Multi-camera / multi-pass scenes* section, `post-chain-follow-ons.md` (*Post: multi-pass effects* section).

## Multi-camera / multi-pass scenes

`frame.render(ctx, { ... camera: cam, ... })` takes one camera. Multi-camera setups (split-screen multiplayer, picture-in-picture, mini-map overlay, security-camera view rendered to a texture) need API extension.

Likely shape: `frame.render(ctx, { passes: [{ camera: cam1, draw: [...], viewport: { x, y, w, h } }, { camera: cam2, draw: [...], viewport: { ... } }], effects: [...] })`. Or a `multiRender` variant that takes an array of camera+draw pairings.

Rendering one camera's view into a texture (for the mini-map case) uses `frame.renderToTexture` (shipped in tranche 6); a multi-camera API would need to compose those offscreen passes with the swapchain pass.

Open design questions: how do post-effects compose across multiple cameras (per-pass effects? final composite after all passes?); how are depth buffers shared or separated; whether multi-camera implies multi-uniform-buffer or one giant frame uniform with per-pass slices.

**Trigger to revisit:** First demo needing more than one camera — typically split-screen co-op or a mini-map.

**Reference:** Core architecture design § "Deferred decisions".

## Time scaling (slow-mo, fast-forward, pause-via-scale)

> **Shipped as a demo-side recipe (Stage 4B, 2026-06-04):** slow-mo / pause /
> single-step all compose on the existing `frame.fixedClock` with ZERO engine
> surface — `advance(deltaMs * timeScale)`, `timeScale = 0`, and
> `advance(fixedDtMs)` (exactly one tick, by the accumulator-`< fixedDtMs`
> invariant). Documented in `engine-conventions.md §Time`; the bowling demo wires
> the controls. STILL DEFERRED: a discoverable `clock.tick()` and/or
> `setTimeScale` convenience on `FixedClock`. **Revisit trigger:** the
> `advance(fixedDtMs)` single-step idiom proves unergonomic across multiple
> demos/consumers.

Time-scaling layered on `frame.fixedClock` via a `timeScale` multiplier on the simulation clock. `timeScale = 0.5` runs simulation at half speed (slow-mo); `timeScale = 2.0` runs at double speed; `timeScale = 0` pauses simulation entirely while still allowing render to update. Render-side `alpha` interpolation continues to work correctly because it's based on the simulation clock (the `alpha` that `clock.advance` returns), not real time.

API sketch: the cheap path needs no new engine surface — the consumer scales the delta it feeds the clock: `clock.advance(deltaMs * timeScale, onTick)` (`timeScale = 0` → feed `0` → render still runs, sim freezes). What scaling *can't* express is single-tick debug stepping ("run exactly one tick"), which wants a dedicated `clock.tick()` / `clock.step()` primitive on `FixedClock`. Decide at brainstorm whether to ship just the consumer-scaled-delta recipe (documented, zero new surface), a `setTimeScale` convenience on the clock, or the `tick()` primitive.

Useful for: bullet-time gameplay effects, debug stepping ("run 1 tick at a time"), demos that want to replay events at slower speed, performance debugging (run at 0.1x to inspect rapid events).

Doesn't affect input handlers or `frame.loop` (the variable-timestep render loop, unchanged); only the `frame.fixedClock` simulation clock.

**Trigger to revisit:** When a demo or game needs any of the above effects. Specifically when debug stepping becomes useful for inspecting physics behavior (likely concurrent with `physics` arriving).

**Reference:** Core architecture design § "Rendering API".
