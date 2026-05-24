# Surface WebGPU uncaptured validation errors

**Status update (tranche 5, 2026-05-24):** Listener install + `snap.gpu.uncapturedErrors` cumulative counter shipped per `docs/superpowers/specs/2026-05-24-core-tranche-5-stats-expansion-design.md`. Remaining open: typed `gpu.onUncapturedError(ctx, fn)` emitter and `device.lost` listener with parallel routing. The original open design questions about always-on vs opt-in (and logger callback shape) defer to the formal-log session (`docs/backlog/engine-architecture/formal-log-helper-and-sink.md`).

The core gpu module currently has no listener on `device.uncapturederror`, so any WebGPU validation failure that doesn't throw synchronously is invisible. This bit us once already: `packages/core/src/gpu/context.ts` was passing a spec-invalid format to `GPUCanvasContext.configure()`, Chrome hard-rejected it (visible in console), but Safari silently accepted and then quietly failed to composite the swapchain — no error surfaced anywhere, the demo just "didn't render", and the misdirection ate a debug session before Playwright (real Chrome) was used to make the error visible.

Implementation sketch: in `gpu.requestContext`, add `device.addEventListener("uncapturederror", e => console.error("[furnace/gpu] uncaptured:", e.error.message))` once per device. Single-line cost. This is the WebGPU spec equivalent of `GL_DEBUG_OUTPUT` and should generally be on whenever the engine is in development mode.

Open design questions:
- Always-on or opt-in via a `requestContext({ debug: true })` flag? Production consumers may not want noisy console traffic, but the engine has no concept of "production mode" yet — and a silent-failure default has just demonstrated its cost.
- console.error directly, or a user-supplied logger callback on the Context (mirroring how `events` exposes typed emitters)? The latter integrates with future telemetry but has a heavier API surface than this needs today.
- Should the engine also wrap critical calls (configure, createPipeline, getCurrentTexture, queue.submit) in error scopes and report richer context (call site, resource label), instead of relying on the global event? Error scopes give per-operation attribution; the global event is a catch-all.
- Same problem exists for `device.lost` — worth pairing the work, since both are "the device told us something went wrong and we ignored it".

**Trigger to revisit:** Next time a WebGPU bug hides in Safari for more than a few minutes, OR when starting to write the first non-trivial consumer-facing API that depends on configure/createPipeline/createBuffer succeeding (right now hello-world is the only consumer, and we caught the bug there by accident).

**Reference:** Merge commit `b6bfc77` (tranche 2) and the preceding `fix(core): use spec-valid canvas format for context configure` — the bug was found via Playwright against real Chrome, not via any error path the engine itself owned.
