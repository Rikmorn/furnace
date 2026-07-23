# Post-chain follow-ons

Tracker for the post-processing follow-ons deferred out of the Visual Fidelity epic's
Stage 2 / 2b (which shipped the T2 managed linear multi-pass post chain — `createPasses`
+ transient target pool + linear evaluator — plus tonemap and bloom). The entries below
span the runtime render-graph tier fenced above T2, a consumer-facing node-graph editor,
a composability limitation in the current linear chain, and two profiling-gated hot-path
hygiene items. They are merged because they all live in `packages/core/src/post/` and
share the "a real post driver finally lands / profiling surfaces a cost" family of
triggers. Sections keep their original order: render-graph → multi-pass-effects status →
node-graph editor → effect-input composability → bind-group cache → first-frame compile hitch.

## Post: runtime render-graph / FrameGraph (T3)

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

**Relationship to the *Post: multi-pass effects* section below:** Stage 2's T2 **resolves** that entry's
"multi-input + different-sized intermediates *within the post chain*" cases. The remaining
items it lists (cross-frame history, compute passes, multi-input from scene buffers) move
here.

**Trigger to revisit:** the first real driver lands — depth-of-field, SSAO, SSR, TAA,
motion blur, or auto-exposure (compute) — **or** effect count + transient-target count
grows enough that VRAM aliasing is worth the FrameGraph's complexity. Designing it without
one of those risks the wrong abstraction (the same caution that kept the pre-T2 chain simple).

**Reference:** Prior art: Filament FrameGraph, Bevy render graph. Distinct from the
*Consumer-facing node-graph post editor* section below (a consumer-facing *tool*, not a runtime).

## Post: multi-pass effects

### Stage 2b status

**Resolved by Stage 2b (T2 / `createPasses` + pool + `bloom`):**

- Multi-pass effects — `post.createPasses({ passes: PassDescriptor[] })` lets each effect declare an arbitrary ordered list of fullscreen passes.
- Multi-input passes — `PassDescriptor.inputs: PassInput[]` supports N `@group(0)` texture inputs per pass (`"scene"`, `"prev"`, `{ intermediate: name }`). Used by `post.bloom`'s upsample passes (two inputs: smaller mip + same-level mip) and the composite pass (scene + bloom).
- Different-sized intermediates — `PassDescriptor.output.scale` multiplies the canvas size; the per-ctx transient pool (`post/pool.ts`) acquires the correctly-sized `GPUTexture` and reuses it across frames.
- Real bloom — built-in COD/Jimenez dual-filter (`post.bloom`) ships as a `createPasses`-authored effect: prefilter + downsample chain + tent-upsample accumulation + composite, all mid-chain pool-backed. Up to 6 mips.

### Remaining / deferred

What the T2 `createPasses` surface **cannot** express today:

- **Scene-side G-buffer inputs** — depth, normals, velocity from the scene pass itself. The scene pass's depth/normal buffers are not yet accessible to post effects (`PassInput` only covers scene-color + named post-chain intermediates). SSAO, SSR, motion blur, and depth-of-field all need this.
- **Cross-frame history** — TAA needs the previous frame's output retained across frames. The pool does not persist across frames; targets on the free list are available but not semantically guaranteed to be "last frame's output."
- **Compute passes** — luminance histogram (auto-exposure), GPU sort/scan, particle simulation. `createPasses` records fragment passes only; the chain evaluator has no compute-pass slot.
- **Separable blur** as a cross-effect building block — the T2 API composes this via two passes in one `createPasses` call; the abstraction gap is that the consumer must wire the intermediate by name, which is fine for now.

These deferred items form the seed of a render-graph entry point. They are tracked in the *Post: runtime render-graph / FrameGraph (T3)* section above.

**Trigger to revisit:** First of the remaining cases lands as a real consumer need:
- SSAO or SSR (scene-side G-buffer inputs).
- TAA (cross-frame history target).
- Auto-exposure (compute pass).

**Reference:** Stage 2b `createPasses` + `bloom` (packages/core/src/post/passes.ts, bloom.ts, pool.ts, evaluate.ts). Deferred remainder → the *Post: runtime render-graph / FrameGraph (T3)* section above.

## Consumer-facing node-graph post editor

Deferred out of the Visual Fidelity epic, whose Stage 2
builds the runtime **multi-pass post chain** (a linear, pluggable ping-pong chain
of fullscreen passes) and ships tonemap + bloom. That runtime engine is distinct
from a **consumer-facing node-graph editor** — an authoring surface where effects
are wired as a DAG with branches, named taps, and reusable sub-graphs.

The *Post: multi-pass effects* section above mentions a small internal "graph evaluator" for the
runtime; this entry is the *editor/authoring* concern on top, which is a separate
(and heavier) tooling problem. Keeping the runtime chain linear-and-pluggable in
Stage 2 means new effects are "one fragment shader + a chain entry" without this
editor — so this is a convenience/tooling layer, not a capability gap.

**Trigger to revisit:** when consumers need to compose post effects with branching
/ shared intermediates that a linear chain can't express, or when post authoring
moves into a visual editor (likely the editor-and-tooling track).

**Reference:** the *Post: multi-pass effects* section above.

## T2 post chain: effects that composite onto their own input can't be preceded

The T2 `"scene"` token is the **global original scene target**, preserved read-only across the *whole* chain (see `engine-conventions.md` §Post-chain model, `core-modules.md` `PassInput`). `"prev"` is the rolling output of the immediately preceding pass.

An effect that **composites onto its own input** — `post.bloom` does `input + glow(input)` — must read a *preserved* reference to its input for the composite base, because within a multi-pass effect `"prev"` rolls forward through the effect's own internal passes (by bloom's composite pass, `"prev"` is the last upsample mip, NOT the effect's input). bloom therefore reads `"scene"` for both its bright-extraction and its composite base (`bloom.ts`). But `"scene"` equals the effect's input **only when bloom is the first scene-reading effect**.

**Consequence:** an effect placed BEFORE bloom in `effects[]` is silently ignored by bloom — bloom re-reads the original scene, discarding the upstream output. Surfaced in `cookbook/post` (2026-06-06 Safari gate): the consumer 2-pass blur originally read `"scene"`, so with `[bloom, blur, tonemap]` the blur re-read the original and discarded bloom's output ("bloom doesn't work when blur is on"). **Worked around** by authoring chain-transforming effects (the blur) to read `"prev"` (the running image) and keeping bloom first — every cookbook toggle combination then composes. But a general reorderable chain, or any effect that must run BEFORE bloom (a pre-blur, a DoF pass, a pre-grade), is not supported.

**Fix direction — per-effect-input semantics.** The evaluator (`post/evaluate.ts`) currently flattens all effects into one pass list, losing effect boundaries. Instead, track effect boundaries and pin each effect's **input** (the running chain image at that effect's start); resolve `"scene"` (or a new `"input"`/`"self"` token, keeping `"scene"` as the global original if a use for it appears) to the effect's input rather than the global original. Then bloom blooms whatever is upstream, at any chain position. This redefines the documented `"scene"` semantics, so it touches the spec, `bloom.ts`, the conventions/core-modules docs, and the chain tests — out of Stage 2b scope, hence deferred.

**Trigger to revisit:** a consumer needs an effect to run before bloom; OR a general reorderable / user-orderable post chain (e.g. an effect-stack UI); OR a second built-in composite-onto-input effect (DoF, SSR) lands and hits the same wall.

**Reference:** `packages/core/src/post/evaluate.ts` (`_evaluateChain` — flatten + rolling `prev`, no per-effect input), `packages/core/src/post/bloom.ts` (reads `"scene"`), `packages/cookbook/src/demos/post/entry.ts` (`buildBlur` reads `"prev"` — the workaround), `docs/reference/engine-conventions.md` §Post-chain model.

## Post: bind-group caching (revised after T2 pool)

### Original concern (superseded)

The original entry described caching `@group(0)` bind groups for the old A/B ping-pong pattern — only two flavors (`sceneA-as-input`, `sceneB-as-input`) ever needed per effect. That pattern was replaced by Stage 2b-3's pool-backed linear chain evaluator (`post/evaluate.ts: _evaluateChain`), which acquires a fresh transient target per mid-chain pass. The two-flavor shape no longer applies.

### Revised concern (live)

The chain evaluator (`recordPassDraw` in `post/evaluate.ts`) creates a **new `GPUBindGroup` for `@group(0)` on every frame per pass**. Each call constructs a fresh bind group over the pipeline's auto-derived layout from N input texture views + one sampler.

WebGPU bind-group creation is cheap (CPU-only struct; no GPU work), so at low-effect-count / low-pass-count depths this is negligible. As pass counts grow (e.g. a 12-pass bloom + multi-effect chain), the per-frame allocation count grows linearly.

The `@group(1)` bind group is built lazily (once per pipeline variant, per resolved target format) and cached in `PassSlot.byFormat` — that path is already cached.

### What would a fix look like?

Cache `@group(0)` keyed by the tuple of input texture view objects. Because pool targets are reused across frames (same `GPUTexture` → same `GPUTextureView` object for any given `(w, h, format)` key), a `WeakMap<GPUTextureView, GPUBindGroup>` (or a composite key over N views) per pass-slot could give ~100% hit rate once the pool's free list stabilises.

A simpler but partial approach: cache on first frame per input-set; invalidate on resize (which invalidates the pool anyway). This is less correct than a WeakMap key but simpler.

### Current live concern

The per-frame `@group(0)` bind-group rebuild in `evaluate.ts:recordPassDraw` is the cacheable hot-path item. At typical effect depths (1–3 effects, 1–15 passes for bloom) the cost is buried in `queue.submit` overhead. Revisit when profiling surfaces it.

**Trigger to revisit:** Profiling shows post bind-group allocation as a measurable hot spot, OR effect / pass counts routinely exceed ~10–20 passes per frame in a real consumer scene.

**Reference:** `packages/core/src/post/evaluate.ts` (`recordPassDraw`), `packages/core/src/post/pool.ts` (pool reuse), `packages/core/src/post/effect.ts` (`_resolvePassPipeline`, which already caches `@group(1)` per format).

## Post-effect first-frame pipeline-compile hitch

Stage 2b-2 moved post-effect pipeline compilation from **async-at-create** (`post.create` used to `await` the build off the render path) to **sync-on-first-render** (`_resolvePassPipeline` builds lazily, keyed by the pass's resolved target format, because `frame.render` is synchronous and called un-awaited — see `packages/core/src/post/effect.ts`). The pipeline is cached per `(effect, targetFormat)` after the first render, so this is a one-time cost per effect per format, amortised to zero in steady state.

The wart: `post.bloom` (2b-5) is ~12 passes, so the **first bloom frame compiles ~12 `GPURenderPipeline`s synchronously on the `frame.render` hot path** — a visible first-frame hitch the first time a bloom-bearing scene renders (and again after a resize only if the target format changes, which it doesn't — sizes change, formats don't, and the pipeline key is format-not-size, so resize does NOT recompile). For a long-lived effect created at scene setup this lands during scene load (acceptable). It would bite a consumer that creates bloom mid-interaction.

A fix would pre-warm the likely pipeline variants asynchronously at create time (e.g. `post.bloom` kicks off `createRenderPipelineAsync` for each pass at `workingColorFormat` during its already-async factory), keeping the sync `_resolvePassPipeline` as the cache-hit fast path / fallback. That reintroduces an async warm-up channel the 2b-2 reshape deliberately dropped, so it was deferred rather than bolted on.

**Trigger to revisit:** first user/Safari report of a first-bloom-frame hitch in the bowling or cookbook demo; OR when a consumer pattern creates built-in multi-pass effects mid-interaction (not at scene setup). Until then the amortised one-time cost is acceptable.

**Reference:** `packages/core/src/post/effect.ts` (`_resolvePassPipeline`, the sync get-or-build + the `// MIGRATION`-style comment on lazy compile), `packages/core/src/post/bloom.ts` (the ~12-pass effect once 2b-5 lands), the Stage 2b plan task 2b-2.
