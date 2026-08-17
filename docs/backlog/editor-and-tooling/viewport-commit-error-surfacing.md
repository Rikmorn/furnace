---
summary: `onTransformCommit` calls the daemon with no `.catch` and no user notification, so a failed commit leaves the viewport showing a transform the document never took — the `commitComponents` and `commitSettings` paths have the same gap
---

# Surface errors from `onTransformCommit` daemon calls (toast/notification UX)

*(Fenced out of the M5B editor milestone, 2026-06-14 — the milestone that delivered the viewport manipulation loop on top of M5A: GPU-id picking, AABB highlight, translate gizmo, orbit camera, drag-scrub and the focused-input echo-guard.)*

**Context:** `App.tsx`'s `onTransformCommit` handler calls `api.setComponent` /
`api.setComponentMany` via `suppressEcho`, but does not surface errors (no `.catch`, no user
notification). This matches the existing `commitResource` precedent. A failed commit leaves the
viewport showing the transformed state while the document is unchanged — the SSE event
(or lack thereof) is the only signal that something went wrong.

**Trigger to revisit:** When adding editor error-toast or notification UX (the
`commitComponents`/`commitSettings` paths have the same gap).

**Reference:** M5B Task 14 review. The M5A/M5B as-built sections were deleted from `docs/reference/editor-architecture.md` when the surface was (F4.5a chrome, T2 daemon + core) and git history is the record; what stands today is §9 (the inspector module, which survived intact) and §16–§18 (the overlay cockpit that replaced the rest).
