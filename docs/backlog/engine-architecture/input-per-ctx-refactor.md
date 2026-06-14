# Refactor `input.attach(canvas)` → `input.attach(ctx)`

`packages/core/src/input/attach.ts:28` takes a raw `HTMLCanvasElement` and operates against a module-level singleton `state: State` in `packages/core/src/input/state.ts`. Input emitters (`keyDown`, `keyUp`, `pointerDown/Move/Up`, `wheel`) are created at module-load time, before any ctx exists.

This means tranche 5's per-ctx `stats._recordEmission` instrumentation does NOT apply to input — input emissions don't surface in `snap.events.perEmitter`. Adding per-ctx tracking requires:

1. `input.attach(ctx)` instead of `input.attach(canvas)`. Canvas is read from `ctx.canvas`.
2. Per-ctx emitter creation (drop the module-singleton; store input state on ctx or in a `WeakMap<Context, InputState>`).
3. Multi-context input: each ctx has its own input state + emitters; supports HMR / SPA mounting and multi-canvas apps cleanly.
4. Update hello-world entry (one call site).

This is roughly tranche-3-scope worth of work — touches every file under `packages/core/src/input/`.

**Stage 4A update (2026-06-04) — the "input is a global singleton vs ctx-scoped" finding lands here.** Stage 4A's brainstorm surfaced (and the user agreed to defer) the broader observation that the input module is a global singleton while the rest of the engine is ctx-scoped — one input attachment vs N GPU contexts. That is exactly this refactor. Stage 4A added per-frame edge state to the SAME `State` singleton (`keysPressed`/`keysReleased` sets + `buttonsPressed`/`buttonsReleased` bitmasks, plus the `frame → input` per-frame reset coupling via `_inputEndFrame`). **This does NOT worsen the future migration**: all input state — held keys, pointer, emitters, listeners, AND the new edge fields — is one `State` object, uniformly movable onto `ctx._internal` (or a `WeakMap<Context, InputState>`) in one pass. The ctx-less `_inputEndFrame` reset stays ctx-less for the same reason it is today (the singleton), and would become ctx-scoped alongside everything else when this refactor happens.

**Trigger to revisit:** When per-emitter input event counts become diagnostically useful (debugging input event storms, event-handler perf), OR when multi-context / multi-viewport / split-screen input becomes a real requirement (multi-canvas apps, HMR / SPA mounting, per-viewport input routing), OR when `engine-cascade-teardown.md` lands (input would self-register via `gpu.onDispose`).

**Reference:** Core Tranche 5 (stats expansion) design, §1 — "Minor signature change to events".
