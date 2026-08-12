---
summary: render- and material-path extract-on-next-touch hygiene: `frame/render.ts` length, duplication, dead machinery, over-long parameter lists
---

# Render-code hygiene — extract / refactor on next touch

Tracker for the render- and material-path code-hygiene items that are all
**extract-on-Nth-consumer / next-touch** deferrals: each is a duplication,
too-many-params, dead-machinery, or file-length finding that is deliberately
tolerated *today* and should be paid down the next time the relevant code is
touched, not before. They are merged so there is **one place to check whenever you
touch `frame/render.ts`, `material.ts`, the shader plumbing (`shader/`,
`builtins.ts`, `preamble.ts`), or the physics setters** — if your change adds the
Nth consumer / Nth param / fourth source named in a section below, do the extraction
in the same PR. None of these blocks anything; they are conscience-of-the-codebase
notes keyed to the "duplication until the third occurrence" / clean-code watch-line
posture. Sections keep their original order and content.

## `frame/render.ts` file length on the clean-code watch line

`packages/core/src/frame/render.ts` is **453 lines** as of Tranche A-4 Task 9 (commit `06701e3`). At filing it was 426 lines (Tranche B, commit `b962c45`). `.claude/rules/clean-code.md` flags ~400 lines as a cognitive-load signal worth watching, especially when a file mixes unrelated concerns.

The current contents mix three concerns:

1. **Engine-internal lifecycle for ctx-bound state** — `_ensureDepthTexture` + `_disposeDepth` (depth texture per ctx), `_ensureCameraBuffer` + `_disposeCameraBuffers` (camera uniform buffer per ctx-per-camera), the `group0Cache` builder `ensureGroup0`. These are the lazy-allocation paths the cascade now self-registers.
2. **Render-pass orchestration** — `beginRenderPass`, `recordScenePass`, `recordDraw`, `validateEffects`, `runEffectsPingPong`, `renderEffectPass`. The actual drawing of a frame.
3. **Public surface** — `RenderOptions`, `render()`, the `_frameRenderInternals` named-internal escape hatch used by `frame/render-to-texture.ts`.

Tranche B added ~28 lines (cascade registration + two new private `_dispose*` helpers). The file is now meaningfully over the watch line and likely to grow with every render-path feature.

**Two plausible extractions (recommendation: defer until next render-path addition forces it):**

- `frame/render-internals.ts` — move `_ensureDepthTexture`, `_disposeDepth`, `_ensureCameraBuffer`, `_disposeCameraBuffers`, `ensureGroup0`, the module-level WeakMaps, the cascade registrations, and `_frameRenderInternals`. ~150 lines extracted. Keeps `render.ts` focused on the public `render()` entry plus its pass-orchestration helpers.
- `frame/render-pass.ts` — move `beginRenderPass`, `recordScenePass`, `recordDraw`, `validateEffects`, `runEffectsPingPong`, `renderEffectPass`. ~140 lines extracted. Keeps `render.ts` focused on state lifecycle + the public entry.

Either split reduces `render.ts` to ~200-250 lines and gives the second concern its own home. The first option (extracting internals) maps more cleanly onto the cascade boundary surfaced in Tranche B, since the extracted file would be the natural home for the next ctx-bound allocation that joins the cascade.

**Trigger to revisit:** next non-trivial render-path addition (e.g. multi-camera passes) that adds lines to `render.ts`. If that PR would push the file past ~450 lines, extract one of the two concerns above as part of the same change.

**Trigger fired (2026-05-27):** Tranche A-4 Task 9 (`06701e3`, frame.render camera + draw input validation) added the `validateDraw` helper and pushed `render.ts` from 426 → 453 lines, crossing the ~450-line threshold. A-4 Task 9 itself was the trigger event but did not motivate an extraction — it added validation, not restructuring. The recommended extraction (preferred: `frame/render-internals.ts`) should be bundled with the **next** render-path PR that touches this file.

**Trigger fired (2026-05-30):** Tranche D (`depthEnabled` + depth/attachment agreement; commit `a490b19`) added `firstDepthDisagreement` helper and related validation, pushing `render.ts` from 453 → 540 lines. The extraction has not yet happened — it should be bundled with the next render-path PR that touches this file.

**Partial extraction done (2026-06-06, Stage 2b-3):** the pool-backed multi-pass post-chain evaluator landed in `render.ts` (commit `46f9314`), pushing it to 784 lines and mixing a *fourth* concern — post-chain evaluation — into the file. As part of the 2b-3 code-review fixes, that concern was extracted to a new module `packages/core/src/post/evaluate.ts` (`_evaluateChain` + its private helpers `resolveInputViews`, `recordPassDraw`, `acquireMidChainTarget`). `render.ts` is now **625 lines**; it imports `_evaluateChain` from `post/evaluate.ts` and calls it from `render()`. The scene-target acquisition stays in `render()` (render orchestration). This addressed the post-chain tangle but **did not** resolve the original watch-line concern: `render.ts` is still ~625 lines because of the *first two* concerns the entry names — ctx-bound state lifecycle (`_ensureDepthTexture`/`_ensureCameraBuffer`/`_ensureSceneColorTarget` + their `_dispose*` partners + `ensureGroup0` + module WeakMaps) and scene-pass orchestration (`beginRenderPass`/`recordScenePass`/`recordDraw`/`validateDraw`/`validateEffects`). **Entry kept.** The preferred remaining extraction (`frame/render-internals.ts` for the ctx-bound state + cascade registrations, ~150 lines) is unchanged and should still be bundled with the next render-path PR that touches this file.

**Reference:** surfaced during Tranche B final review (2026-05-27). Tranche B itself contributed 28 lines but did not cause the threshold crossing — the file was already at the watch line.

## Shared `_recordGeometryDraw` helper — extract on the 3rd draw site

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

The indexed/non-indexed draw-dispatch branch is now duplicated in **two** sites:

```ts
if (indexBuffer && indexFormat) pass.drawIndexed(indexCount);
else pass.draw(vertexCount);
```

- `packages/core/src/frame/render.ts` — `recordDraw` (the main scene pass).
- `packages/core/src/frame/shadow-map.ts` — `_recordShadowPasses` (the depth-only
  caster pass).

Both bind the same geometry vertex/index buffers and choose `drawIndexed` vs `draw`
identically. This is the **2nd occurrence** — tolerable under "duplication until the
3rd consumer." The two copies are small but conceptually one operation ("dispatch a
draw for this geometry"), so they should converge once a third site exists.

**Trigger to revisit:** a **3rd** draw site lands (depth-prepass, picking pass,
wireframe, instanced batch). Extract `_recordGeometryDraw(pass, geometry)` that
takes the geometry's buffer/format/count and encapsulates the indexed/non-indexed
branch, and have all three sites call it.

**Reference:** `packages/core/src/frame/render.ts` (`recordDraw`);
`packages/core/src/frame/shadow-map.ts` (`_recordShadowPasses`).

## Shared `STANDARD_VERTEX_LAYOUT` constant — extract on the 3rd consumer

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

The standard pos / normal / uv vertex buffer layout (stride 32 bytes:
`vec3 position` + `vec3 normal` + `vec2 uv`) is now declared in **two** sites:

- `packages/core/src/material/material.ts` — `VERTEX_BUFFER_LAYOUT` (the main
  scene-pass pipeline).
- `packages/core/src/frame/shadow-map.ts` — the depth-only caster pipeline declares
  its own copy (`SHADOW_VERTEX_STRIDE` + inline attributes); the caster only reads
  position but must match the same buffer stride/layout the meshes are uploaded with.

This is the **2nd occurrence**, which is tolerable under the repo's "duplication
until the 3rd consumer" posture — extracting now would be premature. Both copies
must stay in sync (if the standard vertex layout's stride or attribute offsets ever
change, both pipelines break), but two sites is manageable.

**Trigger to revisit:** a **3rd** pipeline consumer of this layout lands — likely a
depth-prepass, GPU picking, or wireframe pass. At that point extract a shared
`STANDARD_VERTEX_LAYOUT` (e.g. in `material/` or a `gpu/` vertex-layout module) and
have all three import it.

**Reference:** `packages/core/src/material/material.ts` (`VERTEX_BUFFER_LAYOUT`);
`packages/core/src/frame/shadow-map.ts` (the caster pipeline's duplicate layout).

## Extract a shared world-transform vertex `shader.source` fragment

The world-transform vertex prologue —

```wgsl
let world = object.model * vec4<f32>(v.position, 1.0);
out.pos = camera.viewProjection * world;
out.worldPos = world.xyz;
out.worldNormal = (object.normalMatrix * vec4<f32>(v.normal, 0.0)).xyz;
```

is now duplicated across **three** engine built-ins (see
`packages/core/src/shader/builtins.ts`):

- `LIT_SRC` — the full `{ worldPos, worldNormal }` prologue (verbatim above).
- `TEXTURED_LIT_SRC` — the same prologue plus `out.uv = v.uv`.
- `NORMAL_COLOR_SRC` — a **partial / near-miss**: it fuses
  `camera.viewProjection * object.model` into one expression (no intermediate
  `world`), has **no `worldPos` varying** at all, and emits only
  `out.normal = (object.normalMatrix * vec4(v.normal, 0)).xyz`.

That third occurrence fires the clean-code "extract on the third" trigger. The
Phase-1 precedent already exists: `packages/core/src/shader/preamble.ts` centralises
the binding structs (`_cameraBinding`, `_objectBinding`, `_vsIn`) as composable
`shader.source` fragments, and `lighting.ts` does the same for the *fragment*-side
`fr_shade` toolkit. A shared **vertex** fragment emitting `world` / `worldPos` /
`worldNormal` would close the gap on the vertex side.

This is **not an inline fix** — it needs a deliberate design decision, because
`NORMAL_COLOR_SRC` is a near-miss, not an identical match:

- Where does the fragment boundary sit — does it own the `VsOut` struct, or just
  the body lines (each shader keeps its own struct so it can add `uv`)?
- How does `normalColor` opt into a *subset* (it wants `worldNormal` but not
  `worldPos`, and currently fuses the matrices)? Either it conforms to the shared
  prologue (gaining an unused `worldPos`) or the fragment is parameterised.

So it's a backlog item, not a same-commit extraction.

**Trigger to revisit:** a deliberate shader-fragment hygiene pass, OR when adding
a 4th lit built-in (which would make the duplication a 4-way copy).

**Reference:** `packages/core/src/shader/builtins.ts` (`LIT_SRC`,
`TEXTURED_LIT_SRC`, `NORMAL_COLOR_SRC`); the Phase-1 precedent in
`packages/core/src/shader/preamble.ts` (binding-struct fragments) and
`packages/core/src/shader/lighting.ts` (the fragment-side `fr_shade` toolkit).

## Shared pipeline factory + unified cache

Tranche 6 ships post with its own pipeline cache (`post/pipeline-cache.ts`)
structurally identical to material's (`material/pipeline.ts`). Two
singletons. The duplication is deliberate — master spec §3 forbids
cross-module imports of internals (stats is the documented exception),
so post can't reach into material's cache directly.

When a third pipeline-building module lands, that duplication becomes
costly and the abstraction's joints become visible. Likely candidates:
- **Compute pipelines** — entirely different (`GPUComputePipelineDescriptor`,
  no vertex/fragment/depth).
- **Shadow map pipelines** — depth-only target, no color attachment.
- **Debug drawing** — lines/points, different vertex layouts.
- **ECS instanced batches** — instance buffer in addition to vertex.

Likely shape:
- `gpu/pipeline-cache.ts` (or new internal module) holds the refcounted
  cache primitive, exported as `_pipelineCache`.
- Material, post, and the third module all import it; keys are namespaced
  (`"material:..."`, `"post:..."`, `"compute:..."`).
- Optionally extract a shared `_buildPipeline(ctx, opts)` that wraps
  shader-module creation + cache lookup + error-scope handling, with
  per-module descriptor builders feeding it.

**Trigger to revisit:** Third pipeline-building module lands.

**Reference:** Core Tranche 6 (post-process) design §1 Out.

**Update (Stage 4, 2026-06-08):** The shadow-map work landed the **depth-only caster pipeline** —
the THIRD pipeline-building site this entry anticipated. It is built inline in `frame/shadow-map.ts`
`_ensureShadowCasterPipeline` (depth-only target, no color attachment, `depth32float`, single-sample,
own vertex layout), with its own ad-hoc once-cache rather than the shared refcounted primitive. The
trigger has now technically fired (three sites: material, post, shadow caster), but extraction stays
**deferred** for Stage 4 — the caster pipeline is a singleton built once, so the duplication cost is
small today. Re-evaluate when a fourth site (compute / debug-draw / instanced) makes the shared
factory pay for itself.

## `_createShader` — collapse 7 positional params into an internal options object

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

Stage 4 added `usesShadows` as a third trailing boolean to `_createShader`
(`packages/core/src/shader/shader.ts`), which now reads:

```ts
_createShader(ctx, wgsl, engineOwned, layout, textureBinding, usesScene, usesShadows)
```

— **7 positional params, the last three of them booleans** (`textureBinding`,
`usesScene`, `usesShadows`). This is the classic clean-code "too many params /
boolean-flag arguments" smell: call sites are positional `…, false, true, true)`
runs that are unreadable without checking the signature, and each new shader
capability adds another trailing flag.

The fix is an **internal** options object — `_createShader` is engine-private (the
`_` prefix), so this is a pure refactor with no public-API impact:

```ts
_createShader(ctx, wgsl, { engineOwned, layout, textureBinding, usesScene, usesShadows })
```

Deferred for Stage 4 to keep the shadow change minimal and reviewable; the smell is
real but the three-boolean tail is just barely tolerable today.

**Trigger to revisit:** a 4th flag (or any new param) lands on `_createShader` —
refactor to the options object at that point rather than adding a 4th boolean.

**Reference:** `packages/core/src/shader/shader.ts` (`_createShader`).

## `ensurePerFrameGroup0` — fold per-frame bindings into a `FrameBindings` value object

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

Stage 4 grew `ensurePerFrameGroup0` (`packages/core/src/frame/render.ts`) to **6
params** as the shadow array + sampler bindings were threaded through:

```ts
ensurePerFrameGroup0(ctx, pipeline, cameraBuffer, sceneBuffer, usesScene, usesShadows)
```

The `sceneBuffer` / `usesScene` / `usesShadows` triple is per-frame Scene-side
binding state that has accreted onto the signature one capability at a time
(Scene UBO in Stage 3, shadows in Stage 4). Each new `@group(0)` binding capability
adds another param, and the boolean tail has the same flag-argument smell as
`_createShader`.

The fix is a `FrameBindings` value object grouping the Scene-side per-frame state
(`sceneBuffer`, `usesScene`, `usesShadows`, and the future shadow/cookie bindings),
passed as one argument alongside `ctx` / `pipeline` / `cameraBuffer`. `ensurePerFrameGroup0`
is module-internal, so this is a non-breaking refactor.

**Trigger to revisit:** any further per-frame binding param lands on
`ensurePerFrameGroup0` (e.g. a cookie/projected-texture binding, a per-frame env
map) — introduce the `FrameBindings` object at that point.

**Reference:** `packages/core/src/frame/render.ts` (`ensurePerFrameGroup0`).

## Extract `resolveGroup1` from `material.create`

*Adjacent finding. Surfaced during Visual Fidelity Stage 1, Task 8 (material texture path) code-quality review, 2026-06-05.*

`material.create` (`packages/core/src/material/material.ts`) now resolves the
`@group(1)` bind group via a three-branch dispatch — `texture` | `binding` |
`bindings`, "exactly one" enforced by a mutual-exclusion guard earlier in the
function. Today this reads cleanly as a linear if/else-if and the invariant is
cross-referenced by comments, so it was NOT extracted in Task 8.

The "exactly one `@group(1)` source" invariant currently lives in two places: the
setup-loud guards (mutual-exclusion + the two completeness checks) and the group1
dispatch block. A `resolveGroup1(ctx, descriptor, pipeline, pipelineKey)` helper
would give that invariant a single named home and shrink `create` by ~33 lines.

Not done now because: the block is a clean linear dispatch (not interleaved
concerns); the helper would carry the `pipelineKey`-release ownership coupling,
which is currently explicit and easy to audit; and clean-code says tolerate until
it actually hurts.

### Fix shape
- Extract `resolveGroup1(...)` owning the texture|binding|bindings dispatch,
  returning `GPUBindGroup | null` and preserving the pipeline-cache-release-on-error
  discipline (the stale-handle and `buildGroup1` failure paths must still release the
  acquired pipeline slot).
- Consider also naming the "one `@group(1)` source" invariant once (a small typed
  helper that classifies the descriptor into `none | uniform | raw | texture`).

### Trigger to revisit
- A **fourth** `@group(1)` source is added (e.g. multi-texture / PBR maps in the
  PBR epic, or a storage-buffer bind path from the compute/storage tranche). At that
  point the dispatch stops being trivially linear and the extraction earns its place.

### Related (do not duplicate)
- A second, lower-value note from the same review: passing `texture` to a
  non-`textureBinding` shader (layout null, textureBinding false) currently falls
  through to `buildGroup1`'s generic "shader declares no @group(1) bindings" error
  rather than a dedicated message. Correct + setup-loud, just less specific. Fold a
  dedicated guard in only if this extraction is done.

### Reference
- `packages/core/src/material/material.ts` (`create`, group1 resolution).

## Cache-key builders are not field-exhaustive by construction

*Adjacent finding. Surfaced during Visual Fidelity Stage 1, Task 5 (sampler cache) code-quality review, 2026-06-05.*

Several per-ctx cache key-builders hand-enumerate the fields they hash into a
`|`-joined string. If someone later adds a field to the keyed type but forgets to
add it to the key-builder body, two distinct configs silently collapse to the same
key and the cache returns the **wrong** object — a quiet correctness bug, not a
crash.

Known instances of the pattern (all the same shape):
- `packages/core/src/texture/sampler-cache.ts` — `keyOf(p: Required<SamplerParams>)`
  joins 6 fields. `Required<SamplerParams>` forces all fields to be *present* at the
  call, but does NOT force the body to *enumerate* them.
- `packages/core/src/material/material.ts` — `_blendSignature(blend)`.
- `packages/core/src/post/pipeline.ts` — `blendSignature(blend)`.

This is an accepted house pattern today (it predates Stage 1), so it was NOT changed
inline in Task 5 — closing it cleanly is a cross-cutting decision that should apply to
all three builders at once, not a one-off.

### Fix shape

Options to evaluate when this is picked up:
- **Compile-time exhaustiveness assert** — derive the key from `Object.keys` of a
  canonical ordered field list typed so that omitting a field is a type error, or a
  `satisfies`-style check that the enumerated tuple covers `keyof T`.
- **`Object.entries`-driven key** — sort entries and join, so new fields are included
  automatically (cost: must guarantee stable key ordering + that all values stringify
  collision-safely; the current `|` separator is safe because the GPU enum value sets
  contain no `|`).

Pick one and apply it uniformly to `keyOf`, `_blendSignature`, and `blendSignature`.

### What to verify when fixing
- Adding a field to `SamplerParams` / `GPUBlendState` usage without updating the
  key-builder becomes a compile error (or is auto-included), proven by a deliberate
  test/edit.
- No key collisions for the existing field sets (separator-safety preserved).
- All three builders share one approach.

### Trigger to revisit
- Next time a field is added to `SamplerParams`, the material blend signature, or the
  post blend signature — OR a dedicated cache/key-builder hygiene tranche. Until then,
  the risk is latent and matches long-standing existing helpers.

### Reference
- `packages/core/src/texture/sampler-cache.ts`, `packages/core/src/material/material.ts`,
  `packages/core/src/post/pipeline.ts`.

## Remove the now-dead `MaterialSlot.ownedBuffers` machinery

**Surfaced 2026-05-31 during Tranche E-B Task 7** (retire `material.unlit`). Captured per the AGENTS.md bulk-work rule (engine-side finding outside the task's literal scope; needs a design call, so backlog rather than silently expand the atomic commit).

### Context

`MaterialSlot` carries `ownedBuffers: GPUBuffer[]` + `ownedBufferBytes: number[]`, and `materialTeardown` (`packages/core/src/material/material.ts`) loops them to `buffer.destroy()` + `_recordDestroy(ctx, "buffer", bytes)`. This existed for **factory-allocated uniform buffers freed by the slot's teardown** — its only writer was `material.unlit`, which pushed its 16-byte colour buffer onto the slot.

E-B retired `material.unlit` (Task 7, commit `7be9e46`). Now **no factory pushes to `ownedBuffers`** — every material slot is constructed with `ownedBuffers: []`, the teardown loop never iterates a non-empty array, and the typed `Binding` path (the binding owns its `GPUBuffer`, `material.destroy` does not free it) permanently obsoletes the mechanism. The raw `bindings: GPUBindGroupEntry[]` path is consumer-owned too — material never owns those buffers either.

The TSDoc on `material.create` was updated in Task 7 to say the machinery is currently unused; the machinery itself was left in place.

### Why deferred (not done inline)

Removing `ownedBuffers`/`ownedBufferBytes` + the teardown loop touches `material.ts` internals + `material/types.ts` (the `MaterialSlot` shape) and may touch material-stats tests that assert the slot shape. That is a structural change with a design question — "is any future material factory ever going to own a buffer the slot must free, or is binding-ownership the permanent model?" — so it warranted a deliberate call rather than expanding the Task 7 atomic commit.

### The design question

Is binding-ownership (`Binding` owns the `@group(1)` buffer; consumer owns raw `bindings` resources) the **permanent** model for material-owned GPU memory, such that a material slot will *never* own a buffer it must free? If yes (likely — the bridge is the SSOT for `@group(1)` data), delete the machinery. If a future built-in factory might allocate+own a buffer, keep it.

### Trigger to revisit

- Next tranche that touches `material/material.ts` or `material/types.ts` internals (fold the removal in), **or**
- A design pass on `MaterialSlot` shape / a `material-stats` test refactor, **or**
- A "dead-code sweep" hygiene tranche.

If kept long-term, the "currently unused" TSDoc note must not rot — re-confirm it each time material.ts is touched.

### Reference

- `packages/core/src/material/material.ts` — `materialTeardown`, the `ownedBuffers`/`ownedBufferBytes` fields, the `create` TSDoc note.
- `packages/core/src/material/types.ts` — `MaterialSlot` shape.
- Tranche E-B Task 7 (commit `7be9e46`) — the deletion that orphaned this.
- `resource-lifetime-ownership-and-tracking.md` §Consumer-owned uniform buffers (sibling — the broader ownership-model question).

## Unify the finite-vec3 check across physics setters

`packages/core/src/physics/body.ts` now has three sites that validate a `Vec3Tuple` is all-finite: `createBody` (via the module-private `isFiniteVec3`), `setBodyLinearVelocity`, and `setBodyNextKinematicTranslation` (the last two inline `pos.every((c) => Number.isFinite(c))`). That's the "extract on the third occurrence" threshold from `.claude/rules/clean-code.md`.

It is **not** a pure mechanical swap, which is why it's deferred rather than inline-fixed: `isFiniteVec3` also runs `Array.isArray(v)` + `v.length === VEC3_LEN` defensive checks, but the hot-path setters intentionally skip those (the failure policy trusts the caller and the type system already guarantees a 3-tuple). Folding the setters onto `isFiniteVec3` would add per-call work the hot path deliberately avoids. The real design question: introduce a lighter `everyFinite(v)` predicate for the trust-the-type hot-path setters (and keep `isFiniteVec3`'s structural checks for the descriptor-validation path), or accept the duplication. Decide the helper shape, then unify both setters onto it.

Surfaced during Epic 2 Slice 2.0 Task 3 code review (the new setter added the third inlining site).

**Trigger to revisit:** next time a fourth physics setter needs the same finite-vec3 guard, or during a physics-module hygiene pass.

**Reference:** `.claude/rules/clean-code.md` §"Tolerate duplication until the third occurrence"; `docs/reference/engine-conventions.md` §Failure policy (hot-path trust-the-caller stance).
