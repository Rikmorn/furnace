# A multi-op apply is one undo entry, not a transaction

**Context.** `logApplyGroup` (foundations T3a) and `commitGenerator` both run the same
two-pass shape: validate the whole list, then apply it, then push ONE `ops` entry. The
validation pass is genuinely all-or-nothing — `assertOpValid` reads no store state, so a
mid-list rejection mutates nothing. **Pass 2 is not.** An op that clears validation and
then throws out of the applier strands every earlier op's store writes with no log entry
describing them: the op log no longer replays to the live store, and the user has no ⌘Z
for what just happened.

Measured while reviewing T3a (a throwaway probe, since deleted): the group
`[dig sphere r=1.0, smooth sphere radius=Infinity]` clears `assertOpValid` whole — sphere
radius is unvalidated, see `field-brush-shape-numeric-validation.md` — and dies at
`applySmooth`'s scratch-buffer allocation (`ops.ts:503`). State after the throw was
`store chunks: 8, log.ops: 0, undoStack: 0` — eight chunks written, nothing recorded.

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
option is largely what `field-brush-shape-numeric-validation.md` proposes — closing that
entry shrinks this one's reachable surface without eliminating the class.

Reachability today is low: no editor gesture emits a shape that validates and cannot
apply. It rises when T3c's gesture machine starts routing arbitrary user-authored op
lists through `logApplyGroup`.

**Trigger to revisit:** T3c wires its first real caller to `logApplyGroup`; or an op
source that is not a fixed editor gesture (an LLM op stream, a plugin generator, an
imported oplog) reaches either function; or the first report of a world whose re-bake
from the log produces different bytes than the live store.

**Reference:** `logApplyGroup` and its residual paragraph in
`packages/core/src/field/ops.ts`; `commitGenerator`'s pass-1/pass-2 split in
`packages/core/src/field/generators.ts:1001-1047`;
`docs/backlog/engine-architecture/field-brush-shape-numeric-validation.md` (the
overlapping fix); the `assertPatchValid` setup-loud stance for the validation-first
posture this would extend.
