# Native window: focus/activation triggers server respawn

When the native `wry` window loses or regains focus (e.g., clicking outside the window and back in), the native binary attempts to bind a new dev server or spawn another Bun child, conflicting with the existing one. Observed during the UI foundation milestone's Phase 1 manual verification (2026-05-17). Prevents reliably testing native HMR end-to-end (full page reload remains a documented fallback per spec risk #3).

**Trigger to revisit:** Next time work touches the native runtime (`packages/tools/native/`), or when reliable native HMR testing becomes a blocker.

**Reference:** Manual verification step of `docs/reference/ui-foundation.md`.
