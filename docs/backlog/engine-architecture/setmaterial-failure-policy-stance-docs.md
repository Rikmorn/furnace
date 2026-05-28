# `mesh.setMaterial` missing from `engine-conventions.md` §Failure policy stance lists

*Hygiene fix — Stage 1 amend doc-coverage gap.*

`mesh.setMaterial(ctx, m, mat)` was added to `@furnace/core/mesh` in commit `a375c1b` as a Stage-1 amend so the cookbook's render-target PiP-rebuild flow had a public mutator for swapping a live mesh's material. The API shipped with TSDoc on the function itself (covering throws / silent-no-op / refcount semantics) and a one-line entry in `core-modules.md`.

What it did NOT get: a row in `docs/reference/engine-conventions.md` §"Failure policy" — the section that enumerates each engine mutator and tags its stance (hot-path-trust vs cold-path-validate, silent-no-op vs throw on stale handle, etc.). All other mesh setters (`setPosition`, `setRotation`, `setScale`) appear there; `setMaterial` is the one omission.

The function's actual stance differs from its hot-path siblings:
- `setMaterial` is **cold-path-validate**: throws on null material, throws on stale new-material handle, silent no-op on stale mesh handle.
- `setPosition`/`setRotation`/`setScale` are **hot-path-trust**: no input validation, silent no-op on stale mesh handle.

The asymmetry is intentional (refcount mutations need validation that pose mutations don't) but the stance section is the canonical place a reader expects to learn that — leaving setMaterial out forces them to read the implementation source.

Surfaced during render-target migration (commit `fb12208`) code-quality review.

## Fix

Add a row for `mesh.setMaterial` to the §"Failure policy" stance table/list in `docs/reference/engine-conventions.md` immediately after the other mesh mutator rows. Capture:
- Stance: cold-path-validate
- Null input: throws `FurnaceError`
- Stale new-material handle: throws `FurnaceError`
- Stale mesh handle: silent no-op
- Reference: link to `mesh.ts:setMaterial` TSDoc

Same shape as the surrounding mutator rows so the asymmetry vs the pose setters is visible at a glance.

## What to verify when fixing

- §Failure policy section enumerates all mesh mutators including setMaterial.
- The cold-path-validate vs hot-path-trust distinction is captured.
- `bun run check` passes (no new TSDoc violations).

**Trigger to revisit:** Next engine docs hygiene tranche, OR before adding another cold-path-validate mutator (whichever comes first).

**Reference:** Surfaced 2026-05-28 during Stage-2 render-target migration code-quality review. The setMaterial API itself shipped in `a375c1b`.
