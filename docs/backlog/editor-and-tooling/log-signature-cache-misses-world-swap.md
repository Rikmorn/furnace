---
summary: the op-cost meter's cache signs on three op-log lengths, which two different worlds can share after `resetWorld` — the sibling entity-footprint memo had the same bug, was reproduced, and was fixed by leading its signature with `worldEpoch`
---

# Log-signature caches can miss a world swap

*(A standalone entry until the F4.5 seal, 2026-08-03, which folded it into the field-tool register.)*

**Context.** `FieldHost` memoizes derived state on a *signature* built from the op log's
own numbers. The op-cost meter's cache — in `packages/editor/src/field-host/field-stats.ts`
since foundations T3b1, 2026-08-06 (`field-host.ts` before that), and module-private behind
`StatsMeter.publishIfWatched` since T3b2 trimmed the unused `currentLogStats` seam member —
uses `(ops.length, undoStack.length, redoStack.length)`. A world
swap goes through `resetWorld`, which empties `log.ops` and both stacks and resets
`log.nextId` — so two worlds whose logs agree on those numbers produce the SAME signature,
and the incoming world reads the outgoing world's cached values.

Found 2026-07-31 during F4.5b Task 3 review, on the sibling cache: the entity-footprint
memo showed world A's boxes after loading world B (reproduced — two 2-op worlds with ids
1 and 2 sign identically; a click on empty space in world B re-selected world A's entity
and drew its box where nothing was). **That one is FIXED** — its signature now leads with
`worldEpoch`, the counter `resetWorld` already bumps for the analyzer, and
`tests/field-host-pointer.gpu.test.ts` pins it.

The op-cost cache has the same shape of exposure and was left alone as out of scope. Its
consequence is milder — a stale op-cost READOUT (totalOps / undo depth / compactable) for
one frame — because it is recomputed every WATCHED rAF and the next tick after any log
mutation corrects it. It is only wrong in the window where the two worlds' three lengths
agree AND nothing has mutated the new log yet, which for a freshly loaded world with the
status bar mounted is the frame right after the load.

**T3b1 widened that window on an UNWATCHED host — in LIKELIHOOD, not in duration.** The
extraction moved the recompute inside the stats publish guard, so a host with no
`subscribeStats` subscriber does not scan the log at all (the point: an O(ops) scan per rAF
for a payload nobody receives). The mutations that can alias the signature now have that
whole span to net in rather than a single frame. What did NOT change is how long an alias
lasts once entered: nothing re-signs on a match — the trackers advance only inside the
recompute branch — so a stale reading is carried by every subsequent publish until a length
genuinely differs, under the old shape exactly as much as the new one. The paragraph above
saying it "corrects on the next tick" is loose in the same way: it corrects on the next tick
whose signature MOVED.

Two facts bound the whole thing, and both were missed on the first pass. Only
`liveGenerators` and `compactableOps` can be wrong — `totalOps`, `undoDepth` and `redoDepth`
ARE the three signature lengths, so a matched signature makes them correct by construction.
And in production the unwatched span is still effectively empty of editing — **but the
mechanism this entry first gave for that was falsified three commits later, inside the same
slice.** T3b1 Task 3 wrote "the chrome subscribes in a provider-level effect keyed
`[engineReady, host]`, not per status-bar mount"; T3b1 Task 7 then replaced that fan-out with
per-consumer `useSyncExternalStore` latches, and no such effect exists at HEAD. What is true
now: THREE surfaces read stats — `packages/editor/src/frontend/components/shell/StatusBar.tsx`,
`packages/editor/src/frontend/hooks/useActionContext.tsx` and
`packages/editor/src/frontend/hooks/useWorld.tsx` — and the last two are session-lifetime
providers mounted at the shell root (`components/shell/Shell.tsx`), so an unwatched production
host still exists only before `engineReady` and after chrome teardown. That conclusion now
holds by ACCIDENT rather than by design: it rests on two unrelated providers happening to
destructure `stats`, which is exactly the "correct-if-the-author-remembered" failure mode the
*Worth considering instead* paragraph below argues against. None of this changes the fix; it
is one more reason to prefer the explicit-signal option to a second hand-rolled signature.

**The fix, when it is worth doing:** the same one token — put `worldEpoch` at the front of
the op-cost cache's signature. Cheap; not done at the time only because the task's
boundary was the pick, and not done at T3b1 either because that task's boundary was the
extraction and a signature change is a behaviour change. **Since foundations T3d Task 6
`worldEpoch` is `field-world.ts`'s private state rather than a host `let`**, published as
`World.epoch()` and already read by two modules through it — so the fix now costs one thunk
on `StatsMeterDeps` (`worldEpoch: () => world.epoch()`, the spelling `createAnalyzer` and
`createEntities` already use) and no new host binding at all.

**Worth considering instead:** both caches invalidating on an explicit signal rather than
each inventing a signature. `resetWorld` — `field-world.ts`'s `reset` since T3d Task 6 — is
the ONE place a world goes away; a
`cacheEpoch`-style bump read by every memo in the host would make a new cache correct by
default rather than correct-if-the-author-remembered. Two hand-rolled signatures is the
point at which that starts paying.

**Trigger to revisit:** a third log-signature cache being added; the first report of a
stale meter reading after a world load; or **any of the three stats readers above dropping
its `useFieldHostState()` call** — that is now the event that turns the widened unwatched
window from theoretical into a real production editing span.

**Reference:** `packages/editor/src/field-host/field-stats.ts`
(`StatsMeter.publishIfWatched`, the private cache it reads, and the module header's note on
the widened window); `packages/editor/src/field-host/field-entities.ts`
(`entityFootprints`, exported as `footprints` — the fixed version + its comment, now
there);
`packages/editor/tests/field-host-pointer.gpu.test.ts` (the world-swap case).
