# Scene loader: partial-load cleanup on error path

`loadScene` builds resources in dependency order (geometries → shaders → materials) then
instantiates entities (meshes). It returns the `destroy` teardown only on success. If any
factory or `mesh.create` throws partway through — e.g. a shader compile error, a bad geometry
descriptor, a GPU OOM — the already-built GPU resources (geometries, shaders, materials, meshes
created before the throw) are leaked. The caller receives the error but has no teardown handle.

Found in the Task 4 code review of the editor-M1 scene-loader Slice 1.

## Proposed shape

Wrap the resource/entity build section in a try/catch. On throw, tear down everything built so
far in reverse order (meshes → materials → shaders → geometries) before rethrowing the original
error. A test should fault-inject `mesh.create` on the second entity to confirm the first
entity's mesh and all resources are freed before the error propagates.

```ts
// sketch — adapt to actual resource accumulation order
} catch (err) {
  for (const m of meshes) mesh.destroy(ctx, m);
  for (const mat of materials.values()) material.destroy(ctx, mat);
  for (const geo of geometries.values()) geometry.destroy(ctx, geo);
  throw err;
}
```

Note: shaders built by `buildShader` may be ctx-cached singletons — the teardown loop should
respect the same carve-out the success-path `destroy` already comments on.

## Trigger to revisit

When the loader gains fallible mid-load steps that can realistically fail on a valid document
(e.g. texture decode, async asset fetch in follow-on slices), OR when hardening the loader for
untrusted/malformed input that could cause a GPU factory to throw.

**Reference:**
- `packages/core/src/scene/loader.ts` — the current loader, showing the success-only teardown path.
- `docs/superpowers/plans/2026-06-09-editor-M1-scene-loader-slice1.md` — Slice 1 plan that scoped this out.
