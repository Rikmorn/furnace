# The entity list displays in no legible order — "which is newest?" has no answer

Filed at the T4c gate walk (2026-08-11) — the user's own finding, live.

## Context

After the agent generated a cave into the claimed session, the user tried to find it via
the chrome's entity list and could not: the list does not display in creation order (or
any stated order), so "the newest entity" — the single most natural question after
watching a collaborator add something — is unanswerable from the UI. Entity ids ARE
monotonic (core invariant), so the fact exists; the presentation doesn't surface it.

## The fix

Smallest honest: sort by entity id (creation order), newest last or first — stated in
the header/tooltip so the order is a contract, not an accident. Larger (design pass):
creation-time grouping, "added since your last look" affordance — which is presence
territory and should ride the post-T4 attribution work if it grows past a sort.

## Trigger to revisit

First editor-UX pass after T4, or the attribution slice (whichever first).

## Reference

- The entity list component (chrome). `docs/learnings/seals/2026-08-11-foundations-t4c-verbs-eyes-gate.md`.
