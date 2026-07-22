# field: undo/redo entries address `log.ops` by INDEX, which is why compaction refuses a live history

Two of the three `LogEntry` kinds store a POSITION into `log.ops`: `splice` keeps `at`,
`entity-update` keeps `opIndex`. The third, `ops`, is undone by tail arithmetic
(`log.ops.length -= entry.ops.length`). All three are correct by construction under the
strictly-LIFO rule, because every entry above one on the stack is undone first, restoring
the layout the position was taken in.

Compaction breaks that construction: it removes ops from the middle of the log, so every
position after a fold shifts. `compactRuns` refuses to run while either stack holds an
entry (`assertQuiescentHistory`), which is provable in one line and costs the caller its
history. That guard is **strictly conservative, not minimal** — it is the cheapest rule
that is obviously correct, not the largest rule that is correct. Two shapes it refuses
are in fact safe, and a future implementer should start from that rather than from the
guard:

- **A stack of only `ops` entries admits a real barrier.** Those entries carry no index at
  all — undo peels `entry.ops.length` off the tail — so folding a run that lies strictly
  BELOW the tail all live `ops` entries cover leaves every one of them correct: the tail
  ops keep their identity and their count, the fold is never inside a peeled region, and
  the store is untouched so the stored images still apply. Demonstrated during the Task 5
  spec review: 20 ops loaded from disk (no history, since `serializeOps` persists
  `log.ops` only), 5 in-session edits pushing 5 `ops` entries, the loaded 20-op prefix
  folded with the guard neutered — then 5 undos returned byte-identical to the pre-edit
  state and 5 redos byte-identical to the post-edit state. This is the *open a project,
  edit a little, compact the loaded history* shape, at least as natural as the
  compact-on-open shape the guard's TSDoc cites, and it reclaims the whole loaded prefix
  while preserving ⌘Z.
- **Anything strictly below every stored index** is likewise untouched by the entries that
  hold one — but see the next paragraph for why that is not the same as being usable.

What genuinely does not work is the LITERAL "refuse to fold at or below the highest
referenced index" rule, once a `splice` or `entity-update` entry is on the stack. Those
two constraints point in opposite directions: an `ops` entry is safe only if the fold sits
BELOW its tail, while a stored index is only left alone if the fold sits ABOVE it (folding
below shifts it). Since every op appended after a reconfigure carries its own `ops` entry,
the intersection is usually empty — which is what makes the index-bearing entries, not the
`ops` entries, the thing that has to be solved. And a barrier cannot simply be taken as the
minimum of the stored values: a deeper entry's index is expressed in a log layout that no
longer exists, reconstructed only by undoing the entries above it, so the numbers are not
in one coordinate system.

The two ways out, neither settled:

- **Rewrite the stored positions** at each fold (shift by the removed count, refuse folds
  that overlap a `splice` entry's inserted span). Cheap at runtime, but the correctness
  argument has to hold for every interleaving of undo, redo and reconfigure, including the
  coordinate-system problem above.
- **Anchor entries by op ID instead of index** — `splice` records the id it sat before,
  `entity-update` the entity op's own id (which it already effectively has, since
  `entityId` IS that op's log id). Positions then survive any edit that preserves the
  anchor op, and the "the guard checks bounds, not identity" hazard recorded during the
  patch-op review goes away with it. The cost is a resolve step on every undo/redo and a
  wire-format change for the entries — except the stacks are not persisted, so the wire
  format is untouched. This is the durable fix.

The cheap intermediate, if the pressure arrives before the durable fix: relax
`assertQuiescentHistory` to allow a stack whose entries are ALL `ops`, and cap folding at
the tail they cover. That is the demonstrated-safe subset above, it needs no index
rewriting, and it covers the edit-a-little-then-compact shape.

**Trigger to revisit:** the first requirement for compaction that runs while the user has
a live undo stack — a background daemon sweep, or an editor "reclaim space" button that
must not clear ⌘Z. Also revisit if a second producer starts splicing `log.ops` outside a
reconfigure, since it inherits exactly the same hazard.

**Reference:** `packages/core/src/field/types.ts` (`LogEntry`, `OpLog` — the LIFO rule);
`packages/core/src/field/ops.ts` (`undo`/`redo`, `spliceOps`, `assertEntityUpdateTarget`);
`packages/core/src/field/maintenance.ts` (`compactRuns` — the quiescent-history
precondition, and `CompactOptions` for why `keepIds` cannot substitute).
