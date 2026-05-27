# Opt-in runtime assertions for hot-path math primitives

*Filed during Tranche A-4 (2026-05-28). Not in A-4 scope; out of band.*

Hot-path math primitives (`vec3.*`, `quat.*`, `mat4.*`) trust the caller
and do not validate inputs (see `docs/reference/engine-conventions.md`
§Failure policy, "Hot-path trust"). The TSDoc documents preconditions
per export.

In production this is the correct stance — a `Number.isFinite` guard
per call at hot-path frequencies (1k–100k calls/frame) costs 3μs–300μs
per frame, eating 1–18% of a 16.67ms budget. The same argument holds
for the planned wasm-SIMD math kernels: a JS-side guard at the wasm
boundary would erase the SIMD gain.

But during development, a consumer hitting a NaN propagation in a
deeply-nested transform chain currently has no signal from the engine.
The bug surfaces visually (everything invisible, NaN positions) or
through GPU validation errors much later, with no stack-frame linking
back to the original bad input.

## Fix shape (research-grounded)

[`glam-rs`](https://docs.rs/glam) ships this exact problem as two
opt-in cargo features: `debug-glam-assert` (debug builds only) and
`glam-assert` (all builds). With either flag set, math primitives
panic on degenerate input with named messages. Without the flag,
they trust the caller — production stance.

A TS/JS analog: a module-level switch `assertions.enable()` / `.disable()`
that hot-path primitives consult once at module-load (so the branch
gets dead-code-eliminated in production builds). When on, math
primitives throw `FurnaceError` with descriptive messages on non-finite
input. When off (default), behaviour is unchanged.

Two open design questions:

1. **Where is "production" vs "development"?** Build-time `process.env`
   isn't visible to the browser. Options: (a) consumer explicitly calls
   `assertions.enable()` in their dev entry-point; (b) infer from the
   bundler's `import.meta.env.DEV` or similar; (c) tie to a custom
   environment variable the harness substitutes.
2. **What about per-call cost when assertions ARE on?** Even with the
   branch, the `Number.isFinite` checks themselves cost ~3 ns per
   component. For development that's irrelevant. For "all builds" mode
   (like `glam-assert`), it's the same trade we explicitly rejected
   in A-4 — so the dev-only flavour is probably the only useful one.

## Trigger to revisit

- When a consumer reports a NaN-propagation debugging session and asks
  for stronger engine-side signal during development, OR
- When the wasm-SIMD math kernels land and we need to decide whether
  the wasm path validates (and if so, under what flag).

## What to verify when fixing

- The "off" path remains genuinely allocation-free and branch-free at
  hot-path call sites (verify via the existing perf bench, or add one
  if missing).
- Throwing in dev mode produces a message naming the bad input and a
  stack trace pointing at the caller, not at the math primitive.
- `bun run check`, `bun run typecheck`, and `bun test` pass with the
  flag both enabled and disabled.

**Reference:** Filed during Tranche A-4 (failure-policy hygiene),
2026-05-28. Pattern reference: glam-rs `glam_assert` feature flag.
