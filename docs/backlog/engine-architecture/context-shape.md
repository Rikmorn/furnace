# Exact `Context` shape

The `Context` object is passed to nearly every function in core (`gpu.Context`). Its exact fields, lifecycle methods, and whether it has any methods beyond data accessors are deliberately left for the tranche 1 implementation rather than pre-spec'd.

What we know it must carry:
- `device: GPUDevice` — the WebGPU device
- `queue: GPUQueue` — the command queue (could be a property on device but commonly extracted for convenience)
- `format: GPUTextureFormat` — the swapchain surface format
- `canvas: HTMLCanvasElement` — the canvas it's bound to
- `pixelRatio: number` — the active DPR (CSS / device / explicit numeric)
- Internal stats tracking (resource registry, frame counters, etc.) — needed by `stats._*` instrumentation hooks
- Internal pipeline cache state — for the implicit pipeline sharing across `mesh.create` / `material.create` calls

Open questions: whether `Context` is a frozen plain object or has methods like `ctx.getCurrentTextureView()`; whether multiple contexts share cache state or each has its own; whether `Context` can be serialized for transmission to a Worker (relates to `worker-based-gpu-context.md`).

**Trigger to revisit:** During tranche 1 implementation — this is settled by writing the actual `gpu` module, not by argument.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Open implementation questions".
