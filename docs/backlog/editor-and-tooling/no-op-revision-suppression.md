---
summary: a focus+blur or Enter with no edit still bumps the revision on non-color fields; colour itself is resolved, and the fix belongs in a layer holding both the live draft and the committed baseline — `SchemaForm.onCommit` or the daemon's mutation layer
---

# Suppress no-op-revision bumps where both draft and committed baseline are known

*(Fenced out of the M5B editor milestone, 2026-06-14 — the milestone that delivered the viewport manipulation loop on top of M5A: GPU-id picking, AABB highlight, translate gizmo, orbit camera, drag-scrub and the focused-input echo-guard.)*

**Context:** M5B's ⑫ put a draft-equality guard inside `ColorField` to skip the revision bump
on a focus+blur with no edit. It was a regression: `ColorField`'s `rgba` comes from
`SchemaForm`'s working draft, which `onChange → onPreview` advances to the picked value *before*
blur — so the guard's `eq(next, rgba)` was always true and it suppressed **every** real commit
(colors silently failed to stick). **Color is now fully resolved (2026-06-14):** `ColorField`
commits on the native `change` event, which fires only when the value actually changed — so no
no-op color commits are possible and no guard is needed. What remains is the general case for
**other** fields (`NumberField` on Enter/blur, etc.), where a focus+blur or Enter with no edit
can still bump the revision. If that becomes an annoyance, the correct home is a layer that holds
both the live draft **and** the committed baseline:
- **`SchemaForm.onCommit`** — compare the about-to-commit `updated` against the committed
  `values` prop (deep-equal on the small params object); skip the parent `onCommit` if equal.
  Frontend-local, covers every field uniformly (not just color).
- **Document-session mutation layer (daemon)** — skip the revision bump when a
  `setComponent`/`setResource`/`setSettings` produces a document structurally identical to the
  current one. Truest single-source-of-truth fix; covers all clients (MCP, file-watch echoes),
  not just the inspector. Bigger change; needs an equality/canonical-form decision and undo
  interaction review.

Recommend the document-session approach (single source of truth) but it is a design decision,
not a regression — hence deferred.

**Trigger to revisit:** Next inspector/command-layer cleanup tranche, or when no-op undo entries
become an actual annoyance in practice.

**Reference:** M5B Safari-pass regression triage 2026-06-14; `docs/reference/editor/inspector.md` §"`<SchemaForm>` — drafts, validation, the echo guard". The M5A/M5B as-built sections were deleted from the editor as-built when the surface was (F4.5a chrome, T2 daemon + core) and git history is the record; what stands today is `docs/reference/editor/inspector.md` (the inspector module, which survived intact) and `docs/reference/editor/chrome.md` with its siblings (the overlay cockpit that replaced the rest). SOTA research on the form engine: `docs/research/2026-06-11-editor-m5-inspector-sota.md`.
