# Entity add / delete / duplicate UI in the editor chrome

The daemon exposes `scene.addEntity` / `scene.removeEntity` (editor-architecture §4 command
table) with full validation + undo, but the **chrome has no UI for them**: the Entities panel
is select-only, `Del`/`⌫` on a selection does nothing, and there is no "add entity"
affordance. You can mutate components/resources/settings of EXISTING entities, but you cannot
create or remove entities without hand-editing the scene JSON.

Surfaced at the Slice 3.2 `/impeccable` gate (Alex persona: "Del on selection → nothing;
entity add/delete doesn't exist in the chrome"). Deferred there as out of scope for the
foundation pass, whose goal was chrome finish, not new authoring verbs.

**Scope when picked up:**
- Add affordance (a "+" in the Entities-panel header / a context action) → `scene.addEntity`
  (id optional/generated), then select the new entity.
- Delete via `Del`/`⌫` on the selection + a context action → `scene.removeEntity`, guarded by
  the in-chrome confirm; multi-select = one undo entry (matching the gizmo/batch precedent).
- Duplicate (add + copy components) is the natural third verb.
- Reference integrity: removing an entity other entities reference — the loader's
  resolve-or-throw validates at load, but the UI should warn before a dangling ref commits.

**Couples to** the Entities-panel IA (the 3.2 gate's top P2 — a filter/search box + a
scene/room `role="tree"` across 200+ cryptic IDs; `editor-interaction-model-redesign.md`):
add/delete and findability are the same panel and likely one pass.

**Trigger to revisit:** when in-editor scene authoring (not just tuning existing entities) is
needed — the procedural-authoring editor pass (Slice 3.2.5 / the interaction-model redesign).

**Reference:** `packages/editor/src/daemon/handlers.ts` (`scene.addEntity`/`removeEntity`),
`packages/editor/src/frontend/components/EntitiesPanel.tsx`,
`docs/reference/editor-architecture.md` §4, sibling `editor-interaction-model-redesign.md`.
