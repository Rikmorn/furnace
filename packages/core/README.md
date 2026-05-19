# @furnace/core

The furnace engine library. Headless. Web-platform APIs only. No framework dependencies.

## Install

```bash
npm install @furnace/core
```

## What you get

- `requestWebGpu` — WebGPU device acquisition with a uniform error shape.
- `runFrameLoop` — `requestAnimationFrame` loop with start/stop semantics.
- `createFpsSystem` / `computeFps` — frame-rate measurement with a subscribe API.

For a working end-to-end example, see the `@furnace/hello-world` package in this repository.

## Consumer portability

`@furnace/core` ships compiled ESM JavaScript and `.d.ts` declarations. Use any modern bundler (Vite, webpack, esbuild, Bun, Rollup) — its public surface uses only web-platform APIs (no Bun APIs, no Node APIs, no `process.*` reads), targeting the browser. The `no-bun-leakage` test is one static guardrail; the full consumer contract lives in `.claude/CLAUDE.md` "What we ship to consumers."

The desktop runtime is provided by a separate package, `@furnace/tools`. Install it if you need the native launcher.
