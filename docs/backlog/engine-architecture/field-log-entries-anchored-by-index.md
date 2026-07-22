# field: undo/redo entries address `log.ops` by INDEX, which is why compaction refuses a live history

Two of the three `LogEntry` kinds store a POSITION into `log.ops`: `splice` keeps `at`,
`entity-update` keeps `opIndex`. The third, `ops`, is undone by tail arithmetic
(`log.ops.length -= entry.ops.length`). All three are correct by construction under the
strictly-LIFO rule, because every entry above one on the stack is undone first, restoring
the layout the position was taken in.

Compaction breaks that construction: it removes ops from the middle of the log, so every
position after a fold shifts. `compactRuns` therefore refuses to run while either stack
holds an entry (`assertQuiescentHistory`), which is provable in one line and costs the
caller its history. The natural call site already satisfies it — `serializeOps` persists
`log.ops` and never the stacks, so a freshly loaded project has no history to invalidate,
and compact-on-open is free. What the guard forecloses is compaction DURING a session,
which is what charter L9's "background under budgets" eventually wants.

The two ways out, neither settled:

- **Rewrite the stored positions** at each fold (shift by the removed count, refuse folds
  that overlap a `splice` entry's inserted span). Powerful and cheap at runtime, but the
  correctness argument has to hold for every interleaving of undo, redo and reconfigure —
  and the naive "compute a barrier below which folding is safe" is wrong in both
  directions: folding BELOW a stored index shifts it, folding INSIDE an `ops` entry's
  tail breaks the count, and a deeper entry's index is expressed in a log layout that no
  longer exists.
- **Anchor entries by op ID instead of index** — `splice` records the id it sat before,
  `entity-update` the entity op's own id (which it already effectively has, since
  `entityId` IS that op's log id). Positions then survive any edit that preserves the
  anchor op, and the "the guard checks bounds, not identity" hazard recorded during the
  patch-op review goes away with it. The cost is a resolve step on every undo/redo and a
  wire-format change for the entries — except the stacks are not persisted, so the wire
  format is untouched. This is the durable fix.

**Trigger to revisit:** the first requirement for compaction that runs while the user has
a live undo stack — a background daemon sweep, or an editor "reclaim space" button that
must not clear ⌘Z. Also revisit if a second producer starts splicing `log.ops` outside a
reconfigure, since it inherits exactly the same hazard.

**Reference:** `packages/core/src/field/types.ts` (`LogEntry`, `OpLog` — the LIFO rule);
`packages/core/src/field/ops.ts` (`undo`/`redo`, `spliceOps`, `assertEntityUpdateTarget`);
`packages/core/src/field/maintenance.ts` (`compactRuns` — the quiescent-history
precondition, and `CompactOptions` for why `keepIds` cannot substitute).
