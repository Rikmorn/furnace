# `gpu.requestWorkerContext` — OffscreenCanvas + Worker variant

A variant of `gpu.requestContext` that boots the WebGPU pipeline inside a Web Worker via `OffscreenCanvas`, freeing the main thread entirely for input handling, DOM, and orchestration. Same module shape as the main-thread `requestContext`; the consumer's render code runs in the Worker.

Pattern is supported by current browsers (Chrome and Firefox both ship `OffscreenCanvas` + WebGPU in workers as of 2026). The complexity isn't the WebGPU side — it's the API proxy layer: every module's call (`mesh.create`, `frame.render`, `material.create`, etc.) needs a worker-side equivalent and a thin proxy on the main side that posts messages. The consumer code should look the same regardless of which context type they requested.

Open design questions: how to handle data crossing the boundary (textures sourced from main-thread `ImageBitmap`s; `SharedArrayBuffer` for hot data); how `events` and `input` work when input lives on the main thread but the renderer is in a Worker (message forward? input lives in the Worker?); whether all modules must support both contexts uniformly or some are main-only.

**Trigger to revisit:** When main-thread time becomes the bottleneck — heavy ECS logic, large simulations, AAA-style game loops where DOM/input contention starves the renderer.

**Reference:** `docs/research/shallot.md` for prior art on running WebGPU in non-main-thread contexts (none specifically uses worker contexts but the substrate-offload thinking matches).
