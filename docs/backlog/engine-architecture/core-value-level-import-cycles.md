# Two value-level import cycles in core

Named at the foundations programme's disposition sweep (2026-08-04); never filed; filed
at the T3 objectives audit (2026-08-08). The programme's core sweep found two
value-level (not type-only) import cycles between core modules. Cycle membership is
spec-era — re-derive with madge or a hand trace at pickup; the architecture test
(`packages/core/tests/architecture.test.ts`) checks tier direction and surface
membership but not acyclicity, so nothing regresses loudly if a third appears.

## Trigger to revisit

- A build/bundler behaviour that smells like initialization order (cycles are the usual
  cause).
- The architecture test gaining clauses — acyclicity is a natural candidate row.

## Reference

- `packages/core/tests/architecture.test.ts`.
