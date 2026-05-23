# MeshInternal group-0 cache fields are dead state

Task 10 (`packages/core/src/mesh/types.ts`, `packages/core/src/mesh/mesh.ts`) declared `MeshInternal.group0: GPUBindGroup | null` and `MeshInternal.group0Pipeline: GPURenderPipeline | null` for an inline per-(mesh, pipeline) bind-group cache. `mesh.create` initialises them to `null`; `mesh.destroy` nulls them back.

Task 14's `frame.render` implementation introduced a module-scoped `WeakMap<Mesh, Map<GPURenderPipeline, GPUBindGroup>>` cache in `packages/core/src/frame/render.ts` and never touches the inline fields. The comment on `types.ts` ("Cached group-0 bind group per (pipeline, mesh). Rebuilt if material changes (out of scope).") is now misleading — the cache lives in render.ts, not on the mesh.

Cleanup options:
1. **Delete** the inline fields and the corresponding initialisation/destroy lines. Simplest. The WeakMap cache is the source of truth.
2. **Wire them up** as a hot-path one-element cache (e.g. if `mesh.material` is single-pipeline today, store the most-recent bind group inline and fall back to the WeakMap). Premature optimization; defer.
3. **Move the WeakMap cache state onto the mesh fields**, eliminating the WeakMap. Trade module-scope state for per-mesh state. Mostly cosmetic.

Option 1 is the right call until a measured perf concern argues otherwise.

**Trigger to revisit:** Next session that touches `mesh/types.ts` or `mesh/mesh.ts` (folding it into other mesh-module work avoids a one-line cleanup commit).

**Reference:** Tranche-4 Task 14 code-quality review observation.
