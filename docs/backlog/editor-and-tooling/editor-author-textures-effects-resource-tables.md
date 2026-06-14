# Editor authoring of the `textures` + `effects` resource tables

The core scene format now has five resource tables — `geometries, textures, shaders, materials, effects` (`packages/core/src/scene/t.ts` `TABLE_ORDER`). The editor can **load, validate, render, and reflect** all five: a scene using textures/effects opens fine, renders in the viewport (lights/ambient; post deferred — see `editor-viewport-hdr-context-and-post-preview.md`), and the inspector's resources panel lists texture/effect resources with their fields.

But the editor's **command layer cannot mutate** the two new tables. `scene.setResource` and `scene.removeResource` (`packages/editor/src/daemon/handlers.ts:154`, `:175`) gate their `table` arg on:

```ts
// handlers.ts:23
const tableEnum = z.enum(["geometries", "shaders", "materials"]);
```

So a command targeting `table: "textures"` or `table: "effects"` is rejected before it reaches `mutations.setResource`. Consequence: you can author a textured/post scene by **hand-editing the JSON**, but you cannot **add, edit, or remove** a texture or effect resource through the editor (the inspector reflects them, but committing a change to one would be rejected by the command registry). This is the *authoring* path; the *render* path is covered separately by `editor-viewport-hdr-context-and-post-preview.md`.

This was an accepted, documented scope boundary of the M1-slices batch (the batch's goal was "core loader reproduces the bowling setup from data + headless render + lit editor viewport", not full editor authoring of the expanded set). Noted in `docs/reference/editor-architecture.md §12`.

**Context to weigh when picking this up:**
- Extend `tableEnum` to all five `TABLE_ORDER` tables (or derive it from `TABLE_ORDER` so it can't drift again — single source of truth).
- Verify `mutations.setResource` + the registry-validated mutation path handle a `textures`/`effects` entry correctly (kind params, build/destroy on live preview, leak-clean reconcile) the same way they do for materials.
- The M5A inspector's resource-edit → command dispatch for the new tables (does editing a checkerboard's `cells` or a bloom's `intensity` round-trip through `scene.setResource`?).
- Adding/removing a texture/effect resource and the reference integrity it implies (a material referencing a deleted texture; `settings.post` referencing a deleted effect — the loader's resolve-or-throw + the now-recursive `checkResourceRefs` already validate refs at the boundary).

**Trigger to revisit:** when in-editor authoring of textured / post-processed scenes is needed (likely the editor milestone after M1 — e.g. M5C/M6 editor work), i.e. when "open + render a hand-authored lit/textured scene" is no longer enough and users need to *create* texture/effect resources in the editor.

**Reference:** `packages/editor/src/daemon/handlers.ts` (`tableEnum`, `scene.setResource`, `scene.removeResource`), `packages/core/src/scene/t.ts` (`TABLE_ORDER`), `docs/reference/editor-architecture.md §12`, sibling entry `editor-viewport-hdr-context-and-post-preview.md`.
