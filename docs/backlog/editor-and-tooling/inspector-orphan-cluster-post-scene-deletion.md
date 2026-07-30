# The inspector orphan cluster left by the scene-surface deletion

**Context.** The scene-editing surface deletion (`ebd9dd6c`, "delete the scene-editing
surface (Viewport, Inspect, Entities, scene host) — field-only editor") took `InspectPanel`
with it but left roughly 370 lines under `packages/editor/src/frontend/inspector/` with no
live consumer, or a live consumer that can never actually render:

- `lib/common-components.ts` (`commonComponents`) — test-only: its one importer anywhere is
  `tests/inspector-helpers.test.ts`.
- `lib/resource-refs.ts` (`referencedResourceKeys`, `collectResourceRefs`) — test-only: its
  one importer is `tests/inspector/resource-refs.test.ts`.
- `options.ts` (`InspectorOptionsContext`, `useInspectorOptions`) — has **zero**
  `.Provider` mounts anywhere in `src/` at HEAD. Its two consumers,
  `fields/EntityRefField.tsx` and `fields/ResourceRefField.tsx`, therefore always read the
  context's default value (`{ resourceIds: () => [], entityIds: () => [] }`) rather than a
  real lookup table.

This branch is **unreachable, not latent-buggy**. `resource`/`ref` are `FieldKind`s the
registry maps to those two components (`registry.tsx:24-25` —
`resource: ResourceRefField, ref: EntityRefField`), and `resolveKind` (`kind.ts:14-24`)
only returns them from a schema node's `furnace.kind` annotation. The only schemas in the
whole engine carrying that annotation are four fields on two core SCENE builtins —
`meshRenderer.geometry` / `meshRenderer.material` and `materials.standard.shader` /
`materials.standard.texture.texture` (`packages/core/src/scene/builtins.ts:297,298,558,561`)
— and no generator param schema (the only schemas `SchemaForm` renders post-deletion, via
`StampInspector.tsx`) produces a `t.resource(...)` or `t.ref(...)` field; the one place a
generator schema gets augmented at runtime, `withArchetypeOptions`
(`viewport-host/field-placements.ts`), adds an `enum`, not a `resource`/`ref`. So
`ResourceRefField`/`EntityRefField` are registered but can never mount: nothing that reaches
the registry at HEAD ever resolves to their kind. `lib/ref-options.ts` and
`lib/resource-kind.ts` are private helpers with no consumer outside this same dead pair, so
they travel with it.

The keep side of the same subtree: `SchemaForm.tsx` + `types.ts`'s `JsonSchemaNode` are a
real donor for the F4.5b session card. `StampInspector.tsx:24-25` is the ONLY live import of
`SchemaForm`/`JsonSchemaNode` anywhere in the codebase — `BrushInspector.tsx` only mentions
`SchemaForm` in a comment explaining why it deliberately isn't used there.

**Precedent for pruning over keeping:** `lib/theme.ts` was kept on exactly this "a later
slice will want it" reasoning for a whole slice, was never wanted, and was deleted once its
last consumer died (F4.5a Task 13 — see `docs/reference/editor-architecture.md:614`). The
same shape applies here.

**Trigger to revisit:** F4.5b's session-card task, the first work to touch `inspector/`
again. At that point, decide: prune the cluster down to the `SchemaForm`/`JsonSchemaNode`
core the session card actually needs (deleting `common-components.ts`, `resource-refs.ts`,
`options.ts`, `fields/EntityRefField.tsx`, `fields/ResourceRefField.tsx`,
`lib/ref-options.ts`, `lib/resource-kind.ts` and their dedicated tests), or keep the whole
inspector surface pending the card's actual design. The theme.ts precedent argues for
pruning; this entry frames the decision rather than making it.

**Reference:** `packages/editor/src/frontend/inspector/lib/common-components.ts`,
`lib/resource-refs.ts`, `options.ts`, `lib/ref-options.ts`, `lib/resource-kind.ts`,
`fields/EntityRefField.tsx`, `fields/ResourceRefField.tsx`; `registry.tsx:24-25`;
`kind.ts:14-24`; `packages/core/src/scene/builtins.ts:297,298,558,561`;
`packages/editor/src/frontend/components/field/StampInspector.tsx:24-25`; the scene-surface
deletion commit `ebd9dd6c`; `docs/reference/editor-architecture.md:614` (the theme.ts
precedent).
