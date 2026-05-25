# Re-export `mesh.planeGeometry` to match `cubeGeometry`

`mesh.cubeGeometry` is publicly re-exported from `packages/core/src/mesh/factories/index.ts`; `mesh.planeGeometry` is defined in `packages/core/src/mesh/factories/plane.ts` but is NOT re-exported. This is asymmetric — consumers wanting raw plane geometry (e.g. to share a single Geometry instance across many mesh.create calls) must reach into `mesh.plane()` which always creates a fresh Geometry + Mesh.

Surfaced during cookbook Task 8 (`docs/reference/core-modules.md`) authoring. The doc flags it in its closing "Tier 1 surface NOT in the public API" section so consumers know what's available; the underlying asymmetry should still be resolved.

**Demos impacted today:** none. Cookbook's `blend` demo (Task 15) uses `mesh.plane()` which handles geometry internally; no demo needs raw plane geometry. Future demos that share plane geometry across many meshes would benefit.

**Ideal API shape:** Add `planeGeometry` to `mesh/factories/index.ts`'s re-export list (one line, mirrors `cubeGeometry`'s pattern). Update `core-modules.md`'s closing section to remove the asymmetry callout once shipped.

**Trigger to revisit:** Next time a consumer (cookbook or otherwise) needs to instance many planes from a single shared Geometry. Or as part of a general "core public-surface audit" pass.

**Reference:** `docs/reference/core-modules.md` closing section.
