---
summary: `currentTransform` fills omitted rotation and scale with schema defaults so it always produces a complete record, which writes them explicitly into the document where they were previously absent — cosmetic bloat, fixed by committing only the changed field
---

# Gizmo commit writes explicit rotation/scale even when they were previously omitted

*(Fenced out of the M5B editor milestone, 2026-06-14 — the milestone that delivered the viewport manipulation loop on top of M5A: GPU-id picking, AABB highlight, translate gizmo, orbit camera, drag-scrub and the focused-input echo-guard.)*

**Context:** `currentTransform` in `field-host/index.ts` fills omitted rotation/scale with
schema defaults (`[0,0,0,1]` / `[1,1,1]`) so it always produces a complete transform record.
This means a gizmo commit writes `{ position, rotation: [0,0,0,1], scale: [1,1,1] }` into the
document even when the entity's transform only had `position` before the drag. The fields have
the correct values (same as engine defaults), but they are now explicit in the document JSON
where they were previously omitted — a cosmetic bloat. The right fix is to commit only the
changed field (position) and preserve omission of unchanged ones.

**Trigger to revisit:** rotate/scale gizmo work (a future editor-redesign pass) or a dedicated transform-mutation
cleanup session.

**Reference:** M5B Task 13 holistic review #4. The M5A/M5B as-built sections were deleted from `docs/reference/editor-architecture.md` when the surface was (F4.5a chrome, T2 daemon + core) and git history is the record; what stands today is §9 (the inspector module, which survived intact) and §16–§18 (the overlay cockpit that replaced the rest). SOTA research on gizmo math: `docs/research/2026-06-11-editor-m5-inspector-sota.md`.
