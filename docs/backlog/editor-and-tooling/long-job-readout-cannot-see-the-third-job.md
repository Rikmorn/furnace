# The long-job readout has a third job it cannot show, and a stats shape that will need grouping

F4.5c Task 4 gave the status bar a long-job chip (D-19): `longJobs()` in
`shell/StatusBar.tsx` derives a LIST from the world job (`bake…`, `save…`) and
`FieldStats.voidCastPending`, so two simultaneous jobs both show. Two things about that are
unfinished, and they are the same event away from each other.

## `applyReconfigure` is a third long job and cannot render a chip at all

`FieldHost.applyReconfigure` blocks the main thread — its own TSDoc §COST records **~310 ms
at 2137 ops** (core's P-F3-2 bench, JSC), "a visible freeze on Enter, with no progress
signal". The stall grows with the LOG, not with the edit: the host passes no snapshot
records, so core replays every op below the entity's span into a scratch store first. Same
synchronous shape as the bake, and worse for this chip: nothing paints during it, so a chip
set before the call would not appear until after the freeze it was meant to explain.

That makes it a different problem from the other two rather than a missing wiring, and the
TSDoc already names the lever — `captureDueSnapshots` exists in core and is unwired here, so
shrinking the stall is available before surfacing it is. Filed rather than patched because
the alternatives (wire records; yield a frame before the work, which changes reconfigure's
timing contract; or accept the freeze and say so in the copy leading up to it) are a choice,
not a fix.

Recorded so the seal does not pretend the progress story is general: it covers the two jobs
that CAN report, and names the one that cannot.

## `FieldStats` at a third boolean wants a `jobs: {}` sub-object

`FieldStats` carries one job flag today (`voidCastPending`) beside eight numbers. It rides
the stats push deliberately — the seams are single-slot, and this fact has no consumer that
does not already read stats — and that reasoning holds for a second and third flag too. What
does NOT hold at three is the flat shape: `voidCastPending`, `<x>Pending`, `<y>Pending` as
siblings of `chunks` and `undoDepth` reads as a bag.

The change when it comes is `jobs: { voidCast: boolean; … }` — still ONE push, still no new
seam, and `statsEqual` (`lib/field-host-mirrors.ts:33`) grows one level rather than one
comparison. **A trigger, not a change**: doing it at one flag would be inventing structure
for a single member.

## Trigger to revisit

A third boolean arriving on `FieldStats` (do the grouping in that same commit), or a user
reporting the reconfigure freeze as a hang — whichever is first. The two are likely the same
commit if the reconfigure answer turns out to be "post progress from somewhere".

## Reference

- `packages/editor/src/frontend/components/shell/StatusBar.tsx:486-501` — `longJobs`, the
  one derivation feeding both the chips and the `aria-live` announcement.
- `packages/editor/src/viewport-host/field-host.ts` — `FieldStats` (`:331`) and
  `applyReconfigure`'s TSDoc §COST (`:870-878`), which carries the measurement and names
  `captureDueSnapshots` as the lever that exists and is unwired.
- `packages/editor/src/frontend/lib/field-host-mirrors.ts:33` — `statsEqual`, the
  never-check that a regrouping has to move with.
