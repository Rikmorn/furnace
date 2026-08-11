# Multi-context and worker GPU

Tracker for **more than one `gpu.Context`** — an off-main-thread context, and sharing
resources between devices. Each section is one previously standalone entry, keeping its
Context, *Trigger to revisit* and *Reference*.

They are merged because they are the two faces of the same unbuilt assumption: everything
in `@furnace/core` today is written for a single `Context` on the main thread, keyed by a
`ctxId`. One section asks what it would take to hand a context an `OffscreenCanvas` in a
worker; the other asks what a resource created against one device may legally do against
another. Neither has a consumer, and both would be decided together the day one arrives.

## Cross-context resource sharing

Two `gpu.Context` instances (two canvases on the same page, or main-thread + Worker contexts) sharing the same GPU resource — a mesh, texture, or pipeline used by both renderers without duplication.

WebGPU doesn't directly support sharing resources across `GPUDevice` instances; each device owns its own resources. Cross-device sharing would require either:
- One shared device, multiple swapchains (probably the right answer — same device drives multiple canvases).
- Resource cloning between devices (allocates twice; defeats the purpose).
- A `device.transfer(resource, otherDevice)` if WebGPU adds such an API in the future.

Practically, the common case ("two canvases, same engine") is solved by one device + multiple swapchains. The harder case ("main-thread context + Worker context") is partly covered by the *`gpu.requestWorkerContext`* section.

**Trigger to revisit:** When a real consumer demo needs two canvases sharing meshes/textures — likely never for a single-window app; possibly for a future editor with main view + thumbnail preview.

**Reference:** Core architecture design § "Deferred decisions".

## `gpu.requestWorkerContext` — OffscreenCanvas + Worker variant

A variant of `gpu.requestContext` that boots the WebGPU pipeline inside a Web Worker via `OffscreenCanvas`, freeing the main thread entirely for input handling, DOM, and orchestration. Same module shape as the main-thread `requestContext`; the consumer's render code runs in the Worker.

Pattern is supported by current browsers (Chrome and Firefox both ship `OffscreenCanvas` + WebGPU in workers as of 2026). The complexity isn't the WebGPU side — it's the API proxy layer: every module's call (`mesh.create`, `frame.render`, `material.create`, etc.) needs a worker-side equivalent and a thin proxy on the main side that posts messages. The consumer code should look the same regardless of which context type they requested.

Open design questions: how to handle data crossing the boundary (textures sourced from main-thread `ImageBitmap`s; `SharedArrayBuffer` for hot data); how `events` and `input` work when input lives on the main thread but the renderer is in a Worker (message forward? input lives in the Worker?); whether all modules must support both contexts uniformly or some are main-only.

**Trigger to revisit:** When main-thread time becomes the bottleneck — heavy ECS logic, large simulations, AAA-style game loops where DOM/input contention starves the renderer.

**Reference:** `docs/research/shallot.md` for prior art on running WebGPU in non-main-thread contexts (none specifically uses worker contexts but the substrate-offload thinking matches).
