# Re-export `camera.OrthographicBounds` type

`OrthographicBounds` is `export`ed from `packages/core/src/camera/orthographic.ts` but NOT re-exported from `packages/core/src/camera/index.ts`. Consumers calling `camera.setBounds(cam, bounds)` cannot type their `bounds` argument symbolically — they must redeclare the inline shape `{ left: number; right: number; bottom: number; top: number }` every time.

Surfaced during cookbook Task 8 (`docs/reference/core-modules.md`). The doc inlines the shape into `setBounds`'s signature and flags the asymmetry in the closing "Tier 1 surface NOT in the public API" section.

**Demos impacted today:** none. Cookbook's `hello-cube` (Task 10) uses orthographic but composes bounds inline. Any future demo that wants to build orthographic-bounds helpers (e.g. fit-to-content auto-bounds) would benefit.

**Ideal API shape:** Add `OrthographicBounds` to the type-export list in `camera/index.ts` (one line). Update `core-modules.md` to remove the asymmetry callout and add `OrthographicBounds` as a documented type export under the `camera` table.

**Trigger to revisit:** Next time a consumer composes a bounds helper. Or as part of a general "core public-surface audit" pass — naturally bundled with the `mesh.planeGeometry` re-export.

**Reference:** `docs/reference/core-modules.md` closing section.
