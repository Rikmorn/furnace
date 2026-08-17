---
summary: the camera can frame a selection, frame the world and snap to six axis views, but has no concept of a REMEMBERED pose — nothing persists a camera anywhere, per-world persistence having been declined at the F4.5 gate
---

# Camera bookmarks

*(Adjudicated in the F4.5 charter's §7 capability sweep, 2026-07-29 — one sitting, every capability of the category weighed against the others; the stage that produced the sweep is sealed at `docs/learnings/seals/2026-08-03-epic3-f4.5-overlay-cockpit.md`.)*

The camera has `F` (frame selection), `view.frameWorld`, the six axis snap views, and
click-to-frame from a flag row or a drift finding. What it has no concept of is a REMEMBERED
pose. Nothing persists a camera anywhere — per-world camera persistence was explicitly
declined at the F4.5 gate when `frameWorld` was ruled, so this would be the first thing to
introduce it.

**Trigger to revisit:** a world big enough that returning to a place costs real time. That is F5's
territory, and this should be decided there rather than filed forward blind.

**Reference:** `view.frameWorld` and the axis snap views (what the camera does have); the F4.5 gate's ruling declining per-world camera persistence; `docs/reference/editor-architecture.md` §16–§18 for everything the same sweep put in the adopt column.
