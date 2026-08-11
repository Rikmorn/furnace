# The entity list has no "what changed since I looked away" affordance

Filed at the T4c gate walk (2026-08-11) — the user's own finding, live. **Narrowed at
foundations T5 (2026-08-11): the ORDER half shipped; what is left is the presence half.**

## What shipped

`packages/editor/src/frontend/components/field/EntitiesList.tsx` sorts its rows **newest
first** (descending `entityId`, which core mints from the op log's monotonic counter) and
states that order in the section header's tooltip, so it is a contract rather than an
accident of how the host walks its log. Pinned over a deliberately shuffled fixture in
`packages/editor/tests/chrome/entities-palette.test.tsx`. The gate walk's own question —
"which of these is the one that just landed?" — now has an answer at the top of the list.

## What is left

Creation-time GROUPING, and an "added since your last look" affordance. Both are about
**who did what, when** rather than about ordering: the list would have to hold a notion of
the reader's last look and of which stamps arrived from the agent rather than from the
human. That is presence/attribution state the chrome does not have today.

Note the honest limit the shipped order carries: entity ids are monotonic in COMMIT order
but come from a counter SHARED with the ops, so they say "this is newer" and never "this is
the Nth stamp". Any grouping built on top has to respect that — timestamps are not in the
record either.

## Trigger to revisit

The post-T4 attribution slice, which is where the "who added this, and when" state arrives.

## Reference

- `packages/editor/src/frontend/components/field/EntitiesList.tsx` (`newestFirst`,
  `ORDER_HINT`). `docs/learnings/seals/2026-08-11-foundations-t4c-verbs-eyes-gate.md`.
