---
summary: `deleteEntity` splices a span out and replays downstream ops but never clears the standing drift report, leaving verdicts measured against a store state the delete has moved — and clearing is half of a pair with whether a delete should PRODUCE findings
---

# An entity delete leaves the previous reconfigure's drift report standing

**Context.** `FieldHost.deleteEntity` (F4.5b Task 4) splices an entity's span out and
REPLAYS every downstream op that reaches the affected chunks — the same rewind-and-replay
`applyReconfigure` runs, minus the drift pass. It does not touch the standing drift report.

That leaves the report describing verdicts (`drifted` / `orphaned`) measured against a
store state the delete has since moved. Delete an entity UPSTREAM of a reported op and that
op has now replayed onto a different context again: its recorded verdict is a claim about a
world that no longer exists. `stepHistory` clears the report for exactly this reason
("stale in either direction" — an F3a gate finding), and `loadWorld` clears it too.

Deliberately NOT fixed inline: it is a behavioural decision the task plan did not carry
(the plan enumerates delete's effects precisely and a drift clear is not among them), and
the fix has a second half worth deciding at the same time — a delete's replay could equally
well PRODUCE findings (an `orphaned` downstream op that now writes nothing is precisely
what deleting the masonry it cut into makes), which core's `deleteGeneratorEntity` TSDoc
already names as an additive, non-breaking widening whenever a caller earns it. Clearing
and reporting are the same decision approached from two sides, and picking only the first
would foreclose the second badly.

**Cost of leaving it:** low and self-healing. The stale report survives until the next
apply, history step, dismiss or world load. Its rows still frame real chunks, and F4.5b
Task 4's Δ badges point at it from the rows it intersects — so the visible symptom is a
badge on a row whose named disturbance is one edit out of date, not a wrong action.

**Trigger to revisit:** whoever widens `deleteGeneratorEntity`'s return to carry findings
(core's own TSDoc invites it), OR a gate report of a drift row that outlived the edit it
described.

**Reference:** `packages/editor/src/field-host/field-entities.ts` (`remove`, which is
`FieldHost.deleteEntity`'s body since foundations T3d Task 6);
`packages/editor/src/field-host/field-host.ts` (`stepHistory`'s clear, which is the
precedent) and `field-machine.ts` (`applyReconfigureSession`'s
`drift = result.drift.length === 0 ? null : result.drift`);
`packages/core/src/field/reconfigure.ts` (`deleteGeneratorEntity`'s "No drift report" note
naming both findings it gives up).
