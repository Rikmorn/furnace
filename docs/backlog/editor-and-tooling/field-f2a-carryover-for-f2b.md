# F2a → F2b carry-over items (host size, load-vs-catalog ordering)

**Context.** Two executor flags from the F2a report (2026-07-16) that F2b's plan should
absorb rather than fix now:

1. **`field-host.ts` is ~1024 lines.** F2b restructures the host anyway (brush chassis,
   selection, ghost previews) — an early F2b task should extract the pure
   kit-instancing math (and likely the tool-application logic) into testable modules
   rather than growing the file further.
2. **Editor `loadWorld` doesn't auto-apply the manifest's embedded `materialTable`.**
   The panel applies the CATALOG table at engine-ready, so the intended flow works; but
   a v2 world loaded while the catalog fetch is unresolved/failed remeshes against the
   builtin rock-only table (graceful, wrong colors). Decision recorded at the F2a seal:
   keep **catalog-wins** semantics (the embedded table is the bake snapshot for the
   GAME; editing continues against live project truth) and have F2b add the one-line
   hardening: Load stays disabled until the catalog settles (success or 404-fallback).

**Trigger to revisit:** the F2b "the palette" plan — fold both in as tasks.

**Reference:** `packages/editor/src/viewport-host/field-host.ts`,
`packages/editor/src/frontend/components/FieldPanel.tsx` (catalog load + Load button),
executor flags #3/#4 in the F2a report.
