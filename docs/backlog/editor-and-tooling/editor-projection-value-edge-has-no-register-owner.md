---
summary: the field host's one standing seam→seam VALUE edge (`EDITOR_PROJECTION`) was kept at T5 as a measured residual whose fix a register entry supposedly owns, but three pointers name two different owners and no backlog entry has ever named the symbol
status: open
---

# The one standing value edge between field-host seams has no register owner

**Context.** `packages/editor/src/field-host/field-capture.ts` value-imports
`EDITOR_PROJECTION` from `packages/editor/src/field-host/field-camera-rig.ts` — a frozen
`as const` of three numbers (`fovYRad`, `near`, `far`), exported so the off-screen capture
camera is the viewport's, because a capture with its own near plane would clip geometry the
human can see. It is the **only** seam→seam value edge that stands; the other seam→seam
edges are type-only and erased at runtime.

The edge is guarded, not hidden. `packages/editor/tests/field-host-boundaries.test.ts`
asserts `STANDING_VALUE_EDGES` as an **exact set** rather than as a boolean, on
`no-chrome-leakage.test.ts`'s precedent, so a second edge is a deliberate edit to that line
rather than a silent arrival. The edge count and its type-only/value split are derivable —
the test carries the regenerating `bun -e` one-liner in its own docblock, and
`docs/reference/field-host-clusters.md` §5 tabulates the result.

**What is missing is the OWNER of the eventual fix, and three live pointers disagree about
who it is.**

- `docs/learnings/seals/2026-08-11-foundations-t5-polish-guidance-register.md` records the
  owner's ruling that the edge is KEPT as the measured residual, and says "the parked
  `field-host-internals.md` deferral owns the eventual fix".
- `docs/reference/field-host-clusters.md` §5 and the `STANDING_VALUE_EDGES` docblock both
  name a **different** owner — `docs/backlog/editor-and-tooling/field-host-prune-tranche.md`
  — for the same decision.
- `docs/backlog/editor-and-tooling/field-host-internals.md` (gone) was un-merged
  2026-08-18 into `remeshone-swallows-gpu-setup-failures.md`,
  `field-host-prune-tranche.md` and `analyzer-halo-assumes-sub-chunk-reach.md`.

**None of the four ever named the symbol.** Evidence, and the commands that produce it:

```sh
# no backlog entry, at any commit in any branch, has ever contained the symbol
git log -S "EDITOR_PROJECTION" --all --oneline -- docs/backlog/     # empty

# the same instrument on the same (deleted) path with a token that file DID hold, as a
# positive control — a non-empty result here is what makes the empty result above
# meaningful. The pathspec is a glob so this entry carries no dead path of its own.
git log -S "remeshOne" --all --oneline -- '**/field-host-internals.md'

# and nothing in the register names it at head
grep -rl "EDITOR_PROJECTION" docs/backlog/                          # empty
```

So the seal's ownership claim was never true of `field-host-internals.md`, and it is not
true of its three successors either.

**The prune tranche carries the CLASS but not this INSTANCE, and the distinction is the
whole point.** `field-host-prune-tranche.md` owns "choosing an owner for a shared constant"
for the three accent constants (`SELECTION_COLOR`, `SELECTED_COLOR`,
`ANCHOR_CROSS_HALF_M`) — which are declared in `field-host.ts` with no host reader
*specifically so that* two sibling modules would not value-import a third for a literal.
`EDITOR_PROJECTION` is that same shape where the avoidance did **not** happen: it is the one
place the pattern actually crossed a seam line. The general question is filed; its single
live instance is not, in any entry.

Resolving it means moving the record to a shared point, not weakening the check — the
boundaries test's docblock states that explicitly, and the exact-set assertion is what makes
the residual honest in the meantime.

**Trigger to revisit:** whichever fires first — (a) the prune tranche executes its
accent-constant ownership item, since that decision fixes the spelling this instance must
follow and doing them apart would settle the same question twice; or (b) a **second** value
edge arrives, which cannot happen silently because it requires a deliberate edit to
`STANDING_VALUE_EDGES` — the edit itself is the moment to decide whether the standing set is
a residual or a licence.

**Reference:** `packages/editor/src/field-host/field-camera-rig.ts` (`EDITOR_PROJECTION`,
its declaration and the near-plane rationale beside it);
`packages/editor/src/field-host/field-capture.ts` (the importing seam);
`packages/editor/tests/field-host-boundaries.test.ts` (`STANDING_VALUE_EDGES` and its
docblock — the regenerating command and the "measured residual, not a licence" statement);
`docs/reference/field-host-clusters.md` §5 (the six-edge table) and §2.10 (the accent
constants kept in the host to avoid this shape);
`docs/reference/editor/field-host.md` (the four properties the boundaries test pins);
`docs/backlog/editor-and-tooling/field-host-prune-tranche.md` (the owner-among-peers
question for the accent constants — the class this is the uncovered instance of);
`docs/learnings/seals/2026-08-11-foundations-t5-polish-guidance-register.md` (the T5 owner
ruling that kept the edge, and the ownership claim this entry corrects).
