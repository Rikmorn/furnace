---
summary: nothing highlights under the cursor because the field pick is a CPU ray cast, affordable per click and not per pointermove — the MSAA blocker is gone since T4c, so this now rests on one reason: the pickable kinds have no meshes for an id pass
---

# Hover pre-highlight

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

Explicitly ruled out by the pick architecture rather than merely unbuilt. The field pick is a
**CPU ray cast**, which is affordable per CLICK and not per pointermove, so selection is
click-driven and nothing highlights under the cursor.

The CPU choice had two reasons and now has one. **The sample-count blocker is GONE** — the
host used to acquire its context at `sampleCount: 4` and core's `frame.renderToTexture`
throws on anything but 1, so an id pass could not be rendered at all; foundations T4c removed
MSAA from the editor and the context is now `sampleCount: 1`. What survives is that the two
things most worth picking (entity footprints, gizmo handles) have **no meshes at all**, so an
id pass would have to invent geometry for both before it beat the ray test.

**Trigger to revisit: a GPU pick path exists.** Half of what that once meant has happened. The remaining
half is id materials (or id geometry) for the mesh-less candidate kinds — which T4c's capture
work does NOT produce, since it draws the viewport's own pipelines rather than an id pass.
Until then this is still a consequence rather than a deferral, on one reason instead of two.

**Reference:** `frame.renderToTexture`'s `sampleCount` constraint (the blocker T4c removed by taking MSAA out of the editor) and the T4c capture path, which draws the viewport's own pipelines rather than an id pass; `docs/reference/editor/chrome.md`, `design-system.md` and `tools.md` for everything the same sweep put in the adopt column.
