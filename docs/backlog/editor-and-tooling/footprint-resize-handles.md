---
summary: the translate gizmo moves a committed entity's region but nothing RESIZES one in the viewport — size is changed through the generator's params, and a drag handle would have to map a box edge back onto whichever param governs that axis, per generator
---

# Footprint resize handles

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

The translate gizmo moves a committed entity's region; nothing resizes one in the viewport.
Today a region's SIZE is changed by editing the generator's params in the session card (a
hall's width/height/depth, a cave's radius), which is honest — the params are what actually
determine the shape, and a drag handle would have to map a box edge back onto whichever param
governs that axis, per generator.

**Trigger to revisit:** a generator whose size params are not obviously mappable to a box (or the second
time someone reaches for a corner and finds nothing there). Take it with the gizmo, not before
— `field-host/gizmo.ts` already owns handle picking and `field-move.ts` the anchored
arithmetic, and a resize is a third gesture through the same arbitration.

**Reference:** `packages/editor/src/field-host/gizmo.ts` (handle picking) and `field-move.ts` (the anchored arithmetic) — a resize is a third gesture through the same arbitration; `docs/reference/editor-architecture.md` §16–§18 for everything the same sweep put in the adopt column.
