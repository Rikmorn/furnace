# Per-demo ctx lifecycle in the hello-world harness

`packages/hello-world/src/entry.ts` creates **one shared `gpu.Context`** in `main()` and threads it to every scene via `SceneFactory.load(ctx)`; `frame.loop`, `input.attach`, and the FPS overlay all bind to that single ctx, and the scene switcher only swaps the active `SceneController`.

Stage 2 made MSAA (`sampleCount`) and HDR (`hdr`) **ctx-level, fixed at `requestContext`**. So a demo can't pick its own render config — and an off↔4× MSAA toggle needs ctx *recreation*, not a runtime flag. Giving the bowling demo `{ sampleCount: 4, hdr: true }` + a tonemap chain without forcing the same config on the (LDR, no-tonemap) triangle demo requires moving ctx creation/disposal **into each scene's load/unload** (per-demo ctx), and rebinding `frame.loop` / `input` / overlay across a switch. This is a clean refactor — each demo owning its render config is the right shape — but it's scope beyond "wire one demo," so it was deferred out of Stage 2a (which shipped as engine + docs only).

**Trigger to revisit:** Stage 2b session (bowling demo: MSAA + HDR + `post.tonemap` + emissive ball + MSAA off/4× toggle). Do the per-demo-ctx refactor first, then wire the demo, then the batched Safari gate (bowling + enhanced `cookbook/post`).

**Reference:** `packages/hello-world/src/entry.ts` (shared-ctx + switcher); `docs/reference/engine-conventions.md` §MSAA / §HDR (ctx-level config); the Stage 2 plan/spec 2a-9 step 2.
