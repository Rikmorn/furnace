# A multi-op apply is one undo entry, not a transaction

**Context.** `logApplyGroup` (foundations T3a) and `commitGenerator` both run the same
two-pass shape: validate the whole list, then apply it, then push ONE `ops` entry. The
validation pass is genuinely all-or-nothing — `assertOpValid` reads no store state, so a
mid-list rejection mutates nothing. **Pass 2 is not.** An op that clears validation and
then throws out of the applier strands every earlier op's store writes with no log entry
describing them: the op log no longer replays to the live store, and the user has no ⌘Z
for what just happened.

Measured while reviewing T3a (a throwaway probe, since deleted): the group
`[dig sphere r=1.0, smooth sphere radius=Infinity]` cleared `assertOpValid` whole — sphere
radius was unvalidated then — and died at `applySmooth`'s scratch-buffer allocation
(`ops.ts:543`). State after the throw was `store chunks: 8, log.ops: 0, undoStack: 0` —
eight chunks written, nothing recorded. **That exact op no longer clears pass 1** (T4a
widened `assertOpValid`'s shape leg to every member: finite numbers, positive lengths),
but the class does: a finite-but-absurd radius validates and dies at the same allocation.
The measurement is the shape of the failure, not a live repro.

The **id space** half of this is already closed: both functions stamp from a LOCAL
counter and commit `log.nextId` only once pass 2 finishes, so `log.ops` never acquires a
gap it cannot explain (`logApplyGroup` was fixed to match `commitGenerator` in T3a's
`fix(core): logApplyGroup burns no ids when the applier throws`). Both functions' TSDoc
now states the residual rather than letting "one gesture, one undo entry" imply
atomicity.

What is NOT closed is the store rollback, and it is a real design decision rather than a
fix to slot in: pass 2 would have to snapshot every touched chunk before writing (paying
the inverse-capture cost even on the success path, which is the hot path), or the
applier's own throw sites would have to become setup-loud validation moved into pass 1
(cheaper, but only closes the failure modes anyone thinks to enumerate). Note the second
option is what the shape-numerics entry proposed, and T4a took it: `assertShapeValid` now
rejects every non-finite and non-positive shape number setup-loud. That shrank this
entry's reachable surface (the enumerated failures moved to pass 1) without eliminating
the class — magnitude is still unchecked, and every other applier throw site remains.

Reachability today is low: no editor gesture emits a shape that validates and cannot
apply. It rises when T3c's gesture machine starts routing arbitrary user-authored op
lists through `logApplyGroup`.

**Trigger to revisit:** T3c wires its first real caller to `logApplyGroup`; or an op
source that is not a fixed editor gesture (an LLM op stream, a plugin generator, an
imported oplog) reaches either function; or the first report of a world whose re-bake
from the log produces different bytes than the live store.

> **The first clause did NOT fire at T3c (verified 2026-08-07): `logApplyGroup` still has
> ZERO occurrences anywhere under `packages/editor/`.** The gesture machine landed
> (`packages/editor/src/field-host/field-machine.ts`) and routes no op lists through it —
> the two commit verbs that moved into it each call a core COMPOSITE
> (`commitGenerator` / `reconfigureGenerator`), which is the same shape as before.
>
> What DID change is this entry's standing rather than its content. The foundations program's
> planned editor-side `TransactionManager` (`txn(label, fn)`) was **dropped** at T3c planning,
> and one consequence is that `logApplyGroup` is now named as the transaction story's grouping
> layer outright rather than as one input to a larger editor-side design. So this entry is the
> open question about that story, not a note beside a bigger one. The drop and its evidence
> are recorded in `docs/reference/editor-architecture.md` §23.5.

**Reference:** `logApplyGroup` and its residual paragraph in
`packages/core/src/field/ops.ts`; `commitGenerator`'s pass-1/pass-2 split in
`packages/core/src/field/generators.ts:1001-1047`; `assertShapeValid` in
`packages/core/src/field/ops.ts` (the overlapping fix, landed at T4a — its entry is
closed); the `assertPatchValid` setup-loud stance for the validation-first posture this
would extend.
