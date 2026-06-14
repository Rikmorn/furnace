# Cross-context resource sharing

Two `gpu.Context` instances (two canvases on the same page, or main-thread + Worker contexts) sharing the same GPU resource — a mesh, texture, or pipeline used by both renderers without duplication.

WebGPU doesn't directly support sharing resources across `GPUDevice` instances; each device owns its own resources. Cross-device sharing would require either:
- One shared device, multiple swapchains (probably the right answer — same device drives multiple canvases).
- Resource cloning between devices (allocates twice; defeats the purpose).
- A `device.transfer(resource, otherDevice)` if WebGPU adds such an API in the future.

Practically, the common case ("two canvases, same engine") is solved by one device + multiple swapchains. The harder case ("main-thread context + Worker context") is partly covered by `worker-based-gpu-context.md`.

**Trigger to revisit:** When a real consumer demo needs two canvases sharing meshes/textures — likely never for a single-window app; possibly for a future editor with main view + thumbnail preview.

**Reference:** Core architecture design § "Deferred decisions".
