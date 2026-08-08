# `resources/internal.ts` carries ~33 mechanical wrappers

Named at the foundations programme's disposition sweep (2026-08-04); never filed; filed
at the T3 objectives audit (2026-08-08). The programme's package sweep counted ~33
mechanical wrapper functions in `packages/core/src/resources/internal.ts` — pass-through
shapes whose value is the package-private seam, not logic. Count is spec-era (sweep
scope: the T1 core package audit) — re-derive at pickup.

## Trigger to revisit

- The next tranche that touches the resources module's surface (a deletion pass should
  ask each wrapper "does the seam still need you").
- The R8 surface-membership rule gaining an automated check that would make thin
  wrappers visible as surface.

## Reference

- `packages/core/src/resources/internal.ts`; `docs/reference/api-posture.md` §R8.
