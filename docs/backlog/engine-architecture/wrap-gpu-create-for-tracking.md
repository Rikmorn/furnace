---
summary: engine-internal buffer/texture create sites register with the resource manager by hand at each site; `gpu.createBuffer`/`createTexture` wrappers would make tracking automatic, against the "ctx is a transparent data carrier" model
---

# Wrap `device.createBuffer` / `createTexture` for automatic resource tracking

Tranche 5 instruments six engine-internal buffer/texture create sites by hand (`_registerResource` + handle storage at each one). The pattern is fine for the current count, but if create sites grow significantly we want a single point of truth — `gpu.createBuffer(ctx, descriptor)` and `gpu.createTexture(ctx, descriptor)` wrappers that register automatically, plus matching `gpu.destroyBuffer(buffer)` / `gpu.destroyTexture(texture)` helpers.

Implementation sketch: a `WeakMap<GPUBuffer | GPUTexture, ResourceHandle>` inside `gpu/` keyed by the underlying GPU object. Engine modules call `gpu.createBuffer(ctx, desc)` instead of `ctx.device.createBuffer(desc)`; the wrapper handles registration and stashes the handle. `gpu.destroyBuffer(buffer)` looks up the handle and unregisters before calling `buffer.destroy()`. Consumers using raw `ctx.device.createBuffer` are still allowed — those just don't surface in the memory totals.

Open design questions: do we wrap or replace `ctx.device.createBuffer` access? Replacement is cleaner but breaks the "ctx is a transparent data carrier" model. Wrapping leaves both paths usable but means engine modules must remember to use the wrapped path.

**Trigger to revisit:** When engine-internal create sites exceed ~15, or when a new tranche adds resource types (e.g. compute pipelines, query sets) that should participate in tracking without each one re-implementing the register/unregister boilerplate.

**Reference:** Core Tranche 5 (stats expansion) — "Why explicit-at-site instead of wrapped `device.createBuffer/Texture`".
