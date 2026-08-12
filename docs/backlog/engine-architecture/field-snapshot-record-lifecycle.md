---
summary: field snapshot records have no invalidation or pruning story, so a record staled by an edit is consumed silently
---

# field: snapshot records have no invalidation or pruning story

`captureDueSnapshots` (`packages/core/src/field/snapshots.ts`) captures a chunk's bytes as
of a log POSITION and returns the records; `reconfigureGenerator` accepts them and rebuilds
affected chunks from the newest usable one instead of replaying the whole prefix (measured:
83 ms → 8 ms on a 2850-op log, `packages/core/scripts/field-replay-bench.ts`). Core owns
capturing and consuming them. It owns nothing about their lifetime, and the TSDoc says so
rather than pretending otherwise.

Two gaps, both currently the caller's problem:

- **Invalidation.** A record's `position` indexes a log that has since been edited. Any
  undo, any reconfigure splice, any compaction fold below that position makes the record
  describe a state the log no longer produces — and a stale record is used SILENTLY,
  because nothing in it can detect the edit. (Records ABOVE the restore position are
  ignored, so a too-new record is safe; a wrongly-dated one is not.) The obvious shape is
  `invalidateSnapshots(records, fromPosition)` plus a rule about which verbs report their
  edit position; compaction would also want to SHIFT surviving records rather than drop
  them, since a fold preserves state and only renumbers positions.
- **Pruning.** The sweep only appends. A hot chunk collects one record per budget-worth of
  ops for the whole session, at ~4 KB of density plus the material record each. At the
  budget that actually pays (2 ops of tail, 767 records over 931 chunks) that is already
  most of the field, once per sweep — which is the real finding: at F3 log scale the
  useful configuration is close to "snapshot everything", and a keep-N-per-chunk or
  exponential-spacing policy is what makes it bounded.

Both are deferred deliberately: F3a has no persistent caller yet (D-F3-7 puts the sibling
files and the daemon transport in the editor task), and inventing a lifetime policy
without one would be guessing at the retention the editor actually needs.

**Trigger to revisit:** the first caller that KEEPS records across an edit — the editor
wiring snapshots to sibling files per D-F3-7, or a daemon that sweeps in the background.
Whichever lands first must bring the invalidation rule with it; the pruning policy can
follow, since unbounded growth degrades memory rather than correctness.

**Reference:** `packages/core/src/field/snapshots.ts` (`SnapshotRecord` — the binding to
a log, `captureDueSnapshots`, `restoreSeeds`); `packages/core/src/field/reconfigure.ts`
(`restorePreState` — the route decision); `packages/core/scripts/field-replay-bench.ts`
(the budget sweep); F3 spec D-F3-7.
