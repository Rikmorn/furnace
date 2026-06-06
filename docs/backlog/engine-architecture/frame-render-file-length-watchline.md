# `frame/render.ts` file length on the clean-code watch line

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
