---
summary: three hand-rolled copies of "apply a list, build one `ops` log entry" — rule of three met, the helper's shape still a design question
---

# Three hand-rolled copies of "apply a list, build one `ops` entry"

**Context.** The same five-step block now appears three times in `@furnace/core/field`:
union the per-op dirty sets, merge the per-op inverses FIRST-image-wins, loop-push the
ops onto `log.ops` (never spread — the ~65k JSC argument-count ceiling), push one
`{ kind: "ops", ops, inverse }` entry, clear the redo stack.

- `reapplyOps` — `packages/core/src/field/ops.ts` (the redo replay path)
- `commitGenerator` — `packages/core/src/field/generators.ts` (its pass-2 block onward)
- `logApplyGroup` — `packages/core/src/field/ops.ts` (added in foundations T3a)

The rule-of-three threshold is met. It was NOT extracted in T3a deliberately: the
refactor reaches into `generators.ts`, which is outside a slice whose contract was "core
enablers only", and the helper's shape is a genuine design question rather than a
mechanical lift. The three call sites differ in ways a naive extraction would paper over:

- `reapplyOps` takes `FieldOp[]` and dispatches through `applyFieldOp` (patch and
  placement members included, entity ops returning null); the other two take a narrower
  list and call `applyOp`/`applyFieldOp` directly.
- `commitGenerator` appends an `EntityOp` to the span AFTER the apply pass and needs
  `firstId`/`nextId` visible to build the entity's `opSpan`; `logApplyGroup` has no
  entity member at all.
- `reapplyOps` does not push an entry or clear redo — `redo` owns the stack transfer, and
  the whole point of that split is that ONE place moves entries between stacks.

So the honest extraction is probably the inner accumulate-and-apply loop (dirty union +
first-wins inverse), not the entry assembly — which would leave each caller owning its
own entry push, and would shrink the duplication rather than remove it. Worth deciding
deliberately rather than by whoever adds the fourth copy.

**T3c's gesture machine did NOT add a fourth copy (verified 2026-08-07).** It landed as
`packages/editor/src/field-host/field-machine.ts`, and the two commit verbs that moved into it
(`commitStampSession`, `applyReconfigureSession`) each call a core COMPOSITE
(`commitGenerator` / `reconfigureGenerator`) exactly as they did from the host — the block is
not restated editor-side, and `logApplyGroup` still has zero editor callers. The three sites
are still three. **This entry is unchanged and its trigger is unmet.**

**Trigger to revisit:** a FOURTH site needs the block (T3c's gesture machine was the
named candidate and did not become one); or the first bug caused by the copies drifting —
e.g. one site merging inverses last-wins, which silently breaks undo across overlapping
ops and no existing test would catch at the other two sites.

**Reference:** the three sites above; the first-image-wins convention is documented on
`reapplyOps` and restated in `logApplyGroup`'s TSDoc; the loop-push rationale is spelled
out at `reapplyOps` and copied verbatim to the other two.
