# Reconfigure ghost previews against CURRENT field state, not the entity's pre-span state

**Context.** F3a Task 8 shipped `FieldHost.openEntity` — a stamp session seeded from a
committed entity's recorded provenance, previewed through the existing worker-v3
stamp-ghost machinery. That machinery snapshots the store **as it stands now** and
evaluates the generator against it. `reconfigureGenerator` does something different: it
rewinds the affected chunks to their pre-span state first, then applies the new span and
replays the culled downstream ops. So for `replace` the two agree in practice (the span
overwrites what it covers), but for `keep-existing-air` — and for any case where later
edits overlapped the entity's footprint — the ghost can show a merge against air/rock
that Apply will not reproduce. The ghost is honest about the new SHAPE; it is not a
promise about the merge. Named in `openEntity`'s TSDoc as a v0 limit, and repeated in
the reconfigure card in `StampInspector.tsx` so the user sees it where it bites.

The fix is worker-side restore: the preview job would have to carry (or reconstruct) the
pre-span images of the affected chunks — i.e. the worker gets the same rewind
`restorePreState` performs, or the host performs the rewind on a scratch store and sends
THAT snapshot. The second is cheaper to build (all the machinery is core-side and pure)
but replays the prefix on the main thread per preview, which is exactly the cost the
worker exists to avoid; snapshots (`captureDueSnapshots`) are the lever that makes it
affordable. That is a real design question, not a patch — hence deferred rather than
bodged.

**Trigger to revisit:** the first time a reconfigure under `keep-existing-air` surprises
someone at a gate, OR when snapshot capture is wired into the editor session (the same
records make the rewind cheap enough to run per preview).

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`openEntity`,
`sendPreviewJob`, `snapshotChunks`); `packages/core/src/field/reconfigure.ts`
(`restorePreState` — the two routes and when the culled one is taken);
`packages/core/src/field/snapshots.ts` (`captureDueSnapshots`). Note the sibling v0
divergence already documented on `previewStamp` (a ⌘Z or a stroke mid-session moves the
store under a live preview) — same class of staleness, same eventual fix.
