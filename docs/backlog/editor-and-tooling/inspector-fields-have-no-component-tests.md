---
summary: the inspector fields have no component-level tests, which is how the ⑫ colour regression shipped through 974 tests, two review stages and a browser gate — the existing inspector tests only cover extracted pure helpers and never render a field
---

# Add a component-render test harness for inspector fields

*(Fenced out of the M5B editor milestone, 2026-06-14 — the milestone that delivered the viewport manipulation loop on top of M5A: GPU-id picking, AABB highlight, translate gizmo, orbit camera, drag-scrub and the focused-input echo-guard.)*

**Context:** The ⑫ regression above shipped through all 974 tests, the two-stage spec/quality
review, the final holistic review, AND the Chrome visual gate — because the inspector fields
(`packages/editor/src/frontend/inspector/fields/*`) have **no component-level tests**. The
existing inspector tests (`tests/inspector/*.test.ts`) only cover extracted pure helpers
(`fanComponent`, `shouldReseed`, scrub math) — they never render a field and exercise the
`onChange → onPreview → setDrafts → onBlur → onCommit` chain that the bug lived in. The Chrome
gate missed it too: it never opened a scene and edited the material color (the resource path
with no-op preview + full reload). A `happy-dom` (or `@testing-library/react`) harness that
renders `SchemaForm` + a field and asserts the commit/preview callbacks fire with the right
values would have caught this directly. This is the same class of gap as the Stage-4 shadow
bug — "renders clean / all green" does not prove correct *output/behavior*.

**Trigger to revisit:** Next editor test-infra investment, or before the next inspector feature
tranche (a future editor-redesign pass). Worth doing before more field types are added.

**Reference:** M5B Safari-pass regression triage 2026-06-14. The M5A/M5B as-built sections were deleted from `docs/reference/editor-architecture.md` when the surface was (F4.5a chrome, T2 daemon + core) and git history is the record; what stands today is §9 (the inspector module, which survived intact) and §16–§18 (the overlay cockpit that replaced the rest). SOTA research on the form engine: `docs/research/2026-06-11-editor-m5-inspector-sota.md`.
