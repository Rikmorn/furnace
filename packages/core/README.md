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

`@furnace/core` ships TypeScript source and `.d.ts` declarations. Use any bundler that consumes ESM + TS (Vite, webpack, esbuild, Bun's own bundler, etc.). The public surface uses only web-platform APIs; the `no-bun-leakage` test enforces this.

The desktop runtime is provided by a separate package, `@furnace/tools`. Install it if you need the native launcher.
