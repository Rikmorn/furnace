# `GenerationWorkerClient.cancel()` has no production caller — a wedged run traps the panel

`cancel()` (`packages/editor/src/frontend/lib/generation-client.ts`) terminates the worker
instantly, mid-attempt, and is well covered by `tests/generation-client.test.ts`. Nothing in
the chrome calls it: the only callers are tests. So if a generate or bake never reports back
(worker wedged, engine bundle hung, a spec the generator loops on), the session stays
`generating`/`baking` forever — the World panel keeps every control disabled behind `busy`,
and there is no escape short of reloading the page.

Pre-existing, not a W3 regression (the old Generation panel had the same hole). W3 raises the
stakes a little: a world realize is longer and has more ways to go wrong than the old
two-cave preview, and the panel's whole surface is gated on `busy`.

The fix is a Cancel button that appears while `busy`, calls `client.cancel()`, and resets the
status to `idle` — plus a decision on whether cancel should also clear the preview host.
Cheap, but it is UI surface the W3 plan did not spec.

**Trigger to revisit:** the first observed wedge, or the 3.4 panel pass — whichever comes
first.

**Reference:** `packages/editor/src/frontend/lib/generation-client.ts` (`cancel`),
`packages/editor/src/frontend/components/WorldPanel.tsx` (`busy`).
