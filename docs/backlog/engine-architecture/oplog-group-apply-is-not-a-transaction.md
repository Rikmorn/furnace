---
summary: a group apply's pass 2 does not roll the store back, so an applier throw mid-group leaves a partial write
---

# Pass 2 of a group apply does not roll the store back

> **The trigger FIRED at T4c Task 3 (2026-08-10). The entry stays OPEN and the residue
> stays DECLARED.** The surviving clause was "an op source that is not a fixed editor
> gesture reaches either function", and the note below predicted T4c would be it. It was:
> `FieldHost.applyOps` (`packages/editor/src/field-host/field-mutation.ts`) is the editor's
> first caller of `logApplyGroup`, and the ops it hands over are written by an MCP client
> rather than drawn. **`logApplyGroup` no longer has zero editor consumers** — the count
> re-verified through T4a is now one, and the grep in the retired-clause note below is
> stale as a RESULT while still correct as an instruction.
>
> **What T4c did NOT do is fix it, by ruling rather than by omission.** Pass-2 rollback was
> an explicit stop condition for that task: it is the design decision this entry has always
> said it is, and it does not get made inside a task that needed the seam. What T4c owed
> instead was the DECLARATION at the new layer, and that is paid — `applyOps`' TSDoc
> restates the residue in the editor's own terms, and states the two consequences a caller
> meets that core's own paragraph does not mention, because they are the editor's:
>
> 1. **The two cases ARE told apart, and the editor answers them differently.** An earlier
>    version of this note said the seam "cannot tell a pass-1 rejection from a pass-2 applier
>    throw" and classed both as the caller's fault. That was wrong, and this entry's own
>    reference disproves it: `logApplyGroup` wraps a pass-1 rejection with `cause` set
>    (its pass-1 `catch` in `ops.ts`) and that is the **only** `{ cause: … }` in the file, so a raw throw with
>    no cause is a pass-2 failure. The editor discriminates on that — pass 1 is
>    `refused(…, "input")` (nothing moved), pass 2 is **`failed`**, whose message carries the
>    residue explicitly. No message prefix is parsed, so `result.ts`'s "the message is not a
>    key" rule is respected. **This does not close the entry**: the store is still not rolled
>    back. What it closes is a caller being told the world is fine when it is not.
> 2. **Stranded writes are also UNMESHED.** The dirty set only exists on the success path,
>    so the cells a partial write left in the store are never marked — they sit in the field
>    and in no mesh until something else dirties them or the world is reloaded. That is a
>    strictly editor-side consequence and it is the one a human would actually notice.
>
> **Reachability has therefore risen exactly as predicted**, from "no editor gesture emits
> a shape that validates and cannot apply" to "an agent composes the op list". Nothing else
> below is re-measured; the numbers in this entry were taken at T4a and the mechanism has
> not moved.

> **Narrowed at T4a Task 5 (2026-08-09), not closed.** The entry used to cover the whole
> "a multi-op apply is one undo entry, not a transaction" surface. Validation atomicity —
> the half a tranche could close — is closed and pinned; what is left is the store
> rollback, and it is the same real design decision it always was. Everything below is
> re-measured at head, not inherited.

**Context.** `logApplyGroup` (`packages/core/src/field/ops.ts`) and `commitGenerator`
(`packages/core/src/field/generators.ts`) both run the same two-pass shape: validate the
whole list, then apply it, then push ONE `ops` entry. **Pass 1 is genuinely
all-or-nothing** — `assertOpValid` reads no store state, so a mid-list rejection mutates
nothing. **Pass 2 is not.** An op that clears validation and then throws out of the
applier strands every earlier op's store writes with no log entry describing them: the op
log no longer replays to the live store, and the user has no ⌘Z for what just happened.

**Measured at head (2026-08-09), a live repro rather than a remembered one.** The group
`[dig sphere r=1.0 centred [1,1,1], smooth sphere radius=1e12]`, default 0.25 m cell,
BUILTIN_TABLE, fresh store. Op 2 clears `assertOpValid` whole — finite and positive, so
nothing in pass 1 has an opinion — and dies at `applySmooth`'s scratch-buffer allocation
(`packages/core/src/field/ops.ts`, one `Int8Array` byte per sample of the bounds) with
`RangeError: length larger than (2 ** 53) - 1`, sub-millisecond (0.48–0.60 ms over six
runs on one machine — the point is that it fails FAST, unlike the `Infinity` case Task 3
closed, which hung past an 8 s cutoff). State after the throw:
`store chunks: 8, log.ops: 0, undoStack: 0, redoStack: 0, nextId: 1` — **eight chunks
written, nothing recorded.**

**The `8` is centre-dependent; the four log figures are not.** A chunk is 16 cells ×
0.25 m = 4 m, and the dig's sample bounds are its radius plus the applier's 1-sample
margin = 1.25 m, so it touches 8 chunks exactly when those bounds straddle a 4 m plane on
all three axes and 1 chunk when they fall inside one. Measured across centres: 8 at
`[0,0,0]`, `[1,1,1]`, `[3,3,3]`, `[4,4,4]`, `[8,8,8]`, `[16,16,16]`; **1** at `[2,2,2]`
(bounds 0.75–3.25, wholly inside the first chunk) and at `[6,2,2]`. `[2,2,2]` is the centre
of `ops.test.ts`'s own `sphere()` fixture, so a reader re-deriving this figure from the
nearest fixture to hand lands on 1 and concludes the entry is wrong — hence the centre is
named. Anything ≥ 1 makes the point; the exact count does not matter, only that it is
stated with the condition that produces it.

Of those five figures, `store chunks: 8`, `log.ops: 0` and `undoStack: 0` are the T3a
probe's own numbers reproduced against the current predicate rather than quoted from a
deleted probe; `redoStack: 0` and `nextId: 1` are measured here for the first time (T3a
recorded neither).

The entry's ORIGINAL repro no longer works, exactly as T4a Task 3 predicted: a
`radius = Infinity` smooth is rejected in pass 1. Through the group path it now arrives as
`field op group: ops[1] — field op: sphere radius must be a finite positive length
(metres)` — the bare predicate message is what `assertOpValid` alone produces; the prefix
is T4a Task 5's locator (verified today, both halves). The class survived the fix; that
instance did not. **Magnitude is the hole** — `assertShapeValid` checks that a length is
finite and positive, never that it is BUILDABLE — and every other applier throw site
remains behind it.

**What T4a closed, so this entry does not re-litigate it:**

- The **id space** — both functions stamp from a LOCAL counter and commit `log.nextId`
  only once pass 2 finishes, so `log.ops` never acquires a gap it cannot explain (T3a's
  `fix(core): logApplyGroup burns no ids when the applier throws`).
- The **enumerated shape failures** — `assertShapeValid` (T4a Task 3) rejects every
  non-finite and non-positive shape number setup-loud. That is the cheap half of option 2
  below, taken; it shrank this entry's reachable surface without eliminating the class.
- The **declaration**. This entry previously claimed both functions' TSDoc stated the
  residual. That was true of `logApplyGroup` and **false of `commitGenerator`**, which
  declared its validation atomicity and stopped — corrected in Task 5's commit, which
  gave `commitGenerator` the same residual paragraph.
- The **pins**, one per path, because a declared contract gets held on every function that
  declares it. Each is a test whose NAME states the tripwire, so a rollback landing reds
  something self-describing rather than a tail assertion inside a test about something
  else: `ops.test.ts`'s "an applier throw STRANDS the earlier ops' writes — the declared
  residue, pinned so a rollback reds it" for the group path, and `generators.test.ts`'s
  "an op that VALIDATES and then throws in the applier strands the span ops before it" for
  the generator path. Both sit beside the id-space pin they were split from.
  The generator pin strands a dig AND a paint deliberately: on a fresh store the density is
  already SOLID everywhere, so a fill or paint changes only the MATERIAL channel and
  allocates no density chunk (measured: dig → chunks 1 / materials 0; paint → chunks 0 /
  materials 1). A single-op fixture pins one channel and reads as a false negative on the
  other — which it did, on the first attempt at this pin.
- The **locators**, so a rejected batch is legible before the residue matters. Pass 1 now
  names its rejection on all THREE committing paths, in the form each one can honestly
  carry: `logApplyGroup` names the op's list INDEX (the caller wrote that list), while
  `commitGenerator` and `reconfigureGenerator` name the DEF (nobody wrote those spans, so a
  position inside one addresses nothing openable). All three carry the predicate's own
  error on `cause`. The split is by who AUTHORED the ops, not by which function ran them.

**What is NOT closed: the store rollback.** It is a real design decision rather than a fix
to slot in. Pass 2 would have to snapshot every touched chunk before writing (paying the
inverse-capture cost even on the success path, which is the hot path), or the applier's own
throw sites would have to become setup-loud validation moved into pass 1 (cheaper, but
only closes the failure modes anyone thinks to enumerate — magnitude, above, is the one
currently unenumerated). Neither is a code change to make inside a task; both want their
own brainstorm.

Reachability today is still low: no editor gesture emits a shape that validates and cannot
apply, and both functions' only producers are in-repo. It rises the moment an op source
that is not a fixed editor gesture reaches either one.

**Trigger to revisit:** an op source that is not a fixed editor gesture (an LLM op stream,
a plugin generator, an imported oplog) reaches either function; or the first report of a
world whose re-bake from the log produces different bytes than the live store.

> **Clause 1 of the original trigger is retired, not carried forward.** It read "T3c wires
> its first real caller to `logApplyGroup`". It did NOT fire at T3c (verified 2026-08-07)
> and has still NOT fired: `logApplyGroup` had **zero occurrences** under
> `packages/editor/src` and `packages/editor/tests` when this note was written
> (re-verified 2026-08-09). ***That figure is superseded — see the T4c note at the top of
> this entry: the count is now one, and the caller is `FieldHost.applyOps`.*** The grep is
> kept because it is still the right instruction; only its result moved. T3c is
> closed, so the clause can no longer fire at all and naming a closed tranche as a trigger
> is dead weight.
>
> **The surviving clause is SCHEDULED to fire.** T4c's plan is "batched typed-op mutation
> verbs" over MCP — an agent-authored op list is precisely the non-gesture source the
> clause names, and `logApplyGroup` is the grouping layer it would land on. Expect this
> entry to become live work at T4c, with the T4a locator (`field op group: ops[2] — …`)
> as the thing that makes a rejected batch legible and this residue as the thing that
> still is not.
>
> The T3c `TransactionManager` (`txn(label, fn)`) DROP still stands: core's OpLog plus
> `logApplyGroup` plus derived history labels ARE the transaction story, so this is the
> open question about that story rather than a note beside a bigger one. Recorded in
> `docs/reference/editor-architecture.md` §23.5.

**Reference:** `logApplyGroup` and its residual paragraph in
`packages/core/src/field/ops.ts`; `commitGenerator`'s pass-1/pass-2 split in
`packages/core/src/field/generators.ts`; the strand pins in
`packages/core/src/field/ops.test.ts` ("an applier throw STRANDS the earlier ops' writes")
and
`packages/core/src/field/generators.test.ts` ("an op that VALIDATES and then throws in the
applier strands the span ops before it"); the
`assertPatchValid` setup-loud stance for the validation-first posture a rollback-avoiding
fix would extend.
