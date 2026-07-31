# Log-signature caches can miss a world swap

**Context.** `FieldHost` memoizes derived state on a *signature* built from the op log's
own numbers. `currentLogStats` (`packages/editor/src/viewport-host/field-host.ts`, the
op-cost meter's cache) uses `(ops.length, undoStack.length, redoStack.length)`. A world
swap goes through `resetWorld`, which empties `log.ops` and both stacks and resets
`log.nextId` — so two worlds whose logs agree on those numbers produce the SAME signature,
and the incoming world reads the outgoing world's cached values.

Found 2026-07-31 during F4.5b Task 3 review, on the sibling cache: the entity-footprint
memo showed world A's boxes after loading world B (reproduced — two 2-op worlds with ids
1 and 2 sign identically; a click on empty space in world B re-selected world A's entity
and drew its box where nothing was). **That one is FIXED** — its signature now leads with
`worldEpoch`, the counter `resetWorld` already bumps for the analyzer, and
`tests/field-host-pointer.gpu.test.ts` pins it.

`currentLogStats` has the same shape of exposure and was left alone as out of scope. Its
consequence is milder — a stale op-cost READOUT (totalOps / undo depth / compactable) for
one frame — because it is recomputed every rAF and the next tick after any log mutation
corrects it. It is only wrong in the window where the two worlds' three lengths agree AND
nothing has mutated the new log yet, which for a freshly loaded world is the frame right
after the load.

**The fix, when it is worth doing:** the same one token — put `worldEpoch` at the front of
the `currentLogStats` signature. Cheap; not done at the time only because the task's
boundary was the pick.

**Worth considering instead:** both caches invalidating on an explicit signal rather than
each inventing a signature. `resetWorld` is the ONE place a world goes away; a
`cacheEpoch`-style bump read by every memo in the host would make a new cache correct by
default rather than correct-if-the-author-remembered. Two hand-rolled signatures is the
point at which that starts paying.

**Trigger to revisit:** a third log-signature cache being added, or the first report of a
stale meter reading after a world load.

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`currentLogStats`, and
`entityFootprints` for the fixed version + its comment);
`packages/editor/tests/field-host-pointer.gpu.test.ts` (the world-swap case).
