# Post-effect first-frame pipeline-compile hitch

Stage 2b-2 moved post-effect pipeline compilation from **async-at-create** (`post.create` used to `await` the build off the render path) to **sync-on-first-render** (`_resolvePassPipeline` builds lazily, keyed by the pass's resolved target format, because `frame.render` is synchronous and called un-awaited — see `packages/core/src/post/effect.ts`). The pipeline is cached per `(effect, targetFormat)` after the first render, so this is a one-time cost per effect per format, amortised to zero in steady state.

The wart: `post.bloom` (2b-5) is ~12 passes, so the **first bloom frame compiles ~12 `GPURenderPipeline`s synchronously on the `frame.render` hot path** — a visible first-frame hitch the first time a bloom-bearing scene renders (and again after a resize only if the target format changes, which it doesn't — sizes change, formats don't, and the pipeline key is format-not-size, so resize does NOT recompile). For a long-lived effect created at scene setup this lands during scene load (acceptable). It would bite a consumer that creates bloom mid-interaction.

A fix would pre-warm the likely pipeline variants asynchronously at create time (e.g. `post.bloom` kicks off `createRenderPipelineAsync` for each pass at `workingColorFormat` during its already-async factory), keeping the sync `_resolvePassPipeline` as the cache-hit fast path / fallback. That reintroduces an async warm-up channel the 2b-2 reshape deliberately dropped, so it was deferred rather than bolted on.

**Trigger to revisit:** first user/Safari report of a first-bloom-frame hitch in the bowling or cookbook demo; OR when a consumer pattern creates built-in multi-pass effects mid-interaction (not at scene setup). Until then the amortised one-time cost is acceptable.

**Reference:** `packages/core/src/post/effect.ts` (`_resolvePassPipeline`, the sync get-or-build + the `// MIGRATION`-style comment on lazy compile), `packages/core/src/post/bloom.ts` (the ~12-pass effect once 2b-5 lands), the Stage 2b plan task 2b-2.
