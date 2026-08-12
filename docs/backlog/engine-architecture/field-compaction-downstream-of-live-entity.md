---
summary: compacting ops downstream of a live generator entity silently changes what a later reconfigure of that entity produces
---

# field: compaction downstream of a LIVE entity freezes what a reconfigure could change

`compactRuns` (`packages/core/src/field/maintenance.ts`) refuses to fold the ops INSIDE a
live generator entity's span — folding those would dissolve the contiguous-span layout
`reconfigureGenerator` requires. It does not refuse to fold ops that sit AFTER one, and
that is a quieter loss.

A `PatchOp` writes ABSOLUTE cell values. Before a fold, a downstream `dig` re-applied
during a reconfigure adapts to whatever the new span left behind — it opens air where
there is rock and does nothing where there is already air. After the fold, the patch
replays the outcome the dig happened to produce the first time, over whatever the new
span wrote. So reconfiguring an UPSTREAM entity after its downstream history has been
compacted gives a different field than reconfiguring it before. Nothing throws, and the
drift report does not distinguish the case (it reports chunks that changed, which these
are, without attributing cause).

This is inherent to semantic compaction, not a bug in the fold: spec D-F3-6 accepts the
absolute-write trade to get a compact log, and the discard guard proves only that the
patch reproduces the run ON THE STATE THE RUN SAW. The `compactRuns` TSDoc says so, and
the mitigation is available today — `bakeGeneratorEntity` severs the recipe, after which
there is no reconfigure whose fidelity could be lost.

What is NOT settled is whether core should protect the user from the choice, and how. The
options are all defensible and all have costs: exclude every op downstream of a live
entity (kills compaction in any log with a stamp near the start — the common shape);
exclude only downstream ops whose chunks intersect a live span's chunks, transitively
(the reconfigure affected-set computation, run speculatively against an evaluation that
has not happened); or keep the current rule and surface the count in the meter so the
caller decides. The third needs a `logStats` field and an editor affordance, not a core
rule change.

**Trigger to revisit:** the first caller that runs compaction automatically rather than
on an explicit user action — a daemon background sweep, or compact-on-open in the editor
— since that is the point at which the user stops choosing per fold. Also revisit if a
drift report ever needs to say WHY a chunk moved.

**Reference:** `packages/core/src/field/maintenance.ts` (`compactRuns` — "What a fold
gives up"; `eligibleRuns` — the live-span exclusion); `docs/reference/core-modules.md`
§`@furnace/core/field` (Log hygiene); F3 spec D-F3-6.
