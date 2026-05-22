# @furnace/core

The furnace engine library. Headless. Web-platform APIs only. No framework dependencies.

## Install

```bash
npm install @furnace/core
```

## What you get

Five sub-path modules under `@furnace/core`:

- `@furnace/core/gpu` — `requestContext`, `dispose`, `isDisposed`, `getCurrentTextureView`, `onResize` (WebGPU device + canvas lifecycle, with `FurnaceGpuError` for failures).
- `@furnace/core/frame` — `loop` (variable-timestep RAF wrapper), `fixedLoop` (Fix-Your-Timestep accumulator), `encode` (command-encoder helper with auto-submit).
- `@furnace/core/transform` — `vec3`, `vec4`, `quat`, `mat4` math namespaces with out-parameter API; `Float32Array`-backed and column-major.
- `@furnace/core/events` — `createEmitter` typed emitter primitive (snapshot semantics; removed-mid-emit listeners don't fire).
- `@furnace/core/stats` — `createFpsSystem`, `computeFps` (frame-rate measurement with a subscribe API).

Engine-wide conventions (coordinate system, color space, time, disposal) live in `docs/reference/engine-conventions.md`.

For a working end-to-end example, see the `@furnace/hello-world` package in this repository.

## Consumer portability

`@furnace/core` ships compiled ESM JavaScript and `.d.ts` declarations. Use any modern bundler (Vite, webpack, esbuild, Bun, Rollup) — its public surface uses only web-platform APIs (no Bun APIs, no Node APIs, no `process.*` reads), targeting the browser. The `no-bun-leakage` test is one static guardrail; the full consumer contract lives in `.claude/CLAUDE.md` "What we ship to consumers."

The desktop runtime is provided by a separate package, `@furnace/tools`. Install it if you need the native launcher.
