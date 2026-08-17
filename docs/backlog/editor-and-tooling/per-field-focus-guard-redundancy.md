---
summary: SchemaForm's form-level `shouldReseed` echo-guard subsumes the per-field `focusedRef` guards in `NumberField`/`VecField` for the echo case — they remain as defence in depth and may be removable without behavioural change
---

# Audit per-field `focusedRef` guards vs form-level `shouldReseed` echo-guard

*(Fenced out of the M5B editor milestone, 2026-06-14 — the milestone that delivered the viewport manipulation loop on top of M5A: GPU-id picking, AABB highlight, translate gizmo, orbit camera, drag-scrub and the focused-input echo-guard.)*

**Context:** Task 16's form-level echo-guard (SchemaForm gates `setDrafts` on
`shouldReseed(focusWithin)`) subsumes the per-field `focusedRef` guards in
`NumberField`/`VecField` for the echo case: freezing `setDrafts` freezes the `values` prop,
so per-field `useEffect`s that re-seed from `values` never fire while focus is within the form.
The per-field guards remain as defense-in-depth but may be removable without behavioral
change.

**Trigger to revisit:** Post-M5B inspector audit or when a future inspector refactor changes
the SchemaForm/field architecture. Removable if the architecture doesn't change.

**Reference:** M5B Task 16 review. The M5A/M5B as-built sections were deleted from `docs/reference/editor-architecture.md` when the surface was (F4.5a chrome, T2 daemon + core) and git history is the record; what stands today is §9 (the inspector module, which survived intact) and §16–§18 (the overlay cockpit that replaced the rest). SOTA research on the form engine: `docs/research/2026-06-11-editor-m5-inspector-sota.md`.
