# `field/ops.ts` wants a four-concern split

Named at the foundations programme's disposition sweep (2026-08-04) as one of eight
entries to file; never filed; filed at the T3 objectives audit (2026-08-08). The
programme-era reading: `packages/core/src/field/ops.ts` mixes four concerns (the op
vocabulary/validation, application, the OpLog with inverses, and group/composite
assembly) that would be four modules under the editor-side standard the T3 extractions
set. Concern boundaries are spec-era observations — re-derive the seams at pickup.

## Context

Three sibling entries each hold one corner of this file without proposing the split:
`oplog-group-apply-is-not-a-transaction.md` (group semantics),
`oplog-entry-assembly-duplicated-three-ways.md` (assembly),
`oplog-parse-numeric-interior-validation.md` (parse). A split would give each question a
module to land in. T3c's `txn` DROP (core's OpLog + `logApplyGroup` + derived labels ARE
the transaction story) makes this file the transaction story's whole home — one more
reason its concerns deserve walls.

## Trigger to revisit

- Any of the three sibling entries fires and its fix wants a home the mixed file blurs.
- T4's agent op-stream work touches op validation (the parse/validate corner becomes a
  security boundary — the sibling entries say so).

## Reference

- `packages/core/src/field/ops.ts`; the three sibling entries above.
