---
summary: the conditional-origin spread appears at ~15 op-stamp sites across three core field files — rule of three cleared on its own terms; wants a deliberate helper decision
---

# The op-origin stamp idiom cleared the rule of three on its own terms

**Context.** The undo-attribution slice (sealed 2026-08-14) stamps `origin` onto authored
ops with a conditional spread (`origin === undefined ? { ...op, id } : { ...op, id,
origin }`) at roughly 15 sites across `ops.ts`, `generators.ts` and `reconfigure.ts`
(derive the current count: `grep -rn "origin === undefined ? {" packages/core/src/field
--include="*.ts" | grep -v test`). This is a DIFFERENT candidate from the still-blocked
entry-assembly extraction (`oplog-entry-assembly-duplicated-three-ways.md` — that
trigger, a fourth ENTRY site, remains unmet): a tiny `withOrigin(op, origin)` for the
op-level stamp has its own justification and its own risks (the spread must not
introduce an own-property `undefined` — deep-equality pins depend on absence).

**Trigger to revisit:** the next slice that touches two or more of the stamp sites; or
the first bug caused by one site's idiom drifting (e.g. an explicit `origin: undefined`
appearing in a serialized op).

**Reference:** the stamp sites in `logApply`/`logApplyGroup`/`logApplyPatch` (`ops.ts`),
`commitGenerator` (`generators.ts`), `reconfigureGenerator` (`reconfigure.ts`); the
surfaced-findings section of the archived undo-attribution execution report.
