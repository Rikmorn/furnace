# Three of the four daemon↔chrome contracts are still hand-mirrored

Foundations T4b Task 3 added `packages/editor/src/shared/wire.ts` — the **first** boundary type
both bundles import (`SessionRequest`, `SessionAnswer`). Three older ones stayed where they were,
each declared twice and kept in step by hand:

| Contract | Daemon side | Chrome side | Guarded by |
| --- | --- | --- | --- |
| `WorldRow` | `packages/editor/src/daemon/worlds.ts` | `packages/editor/src/frontend/lib/api.ts` | nothing — a comment saying "grep both when either changes" |
| `DaemonEvent` / `ServerEvent` | `packages/editor/src/daemon/events.ts` | `packages/editor/src/frontend/lib/events.ts` | `tests/events.test.ts`'s mutual-assignability pin (compile-time) |
| `EVENT_TYPES` | — (implied by the union) | `packages/editor/src/frontend/lib/events.ts` | `tests/events.test.ts`'s second pin, added in the same task |

They were **not** retrofitted, deliberately.

## Context

**The one that was shared is the one where drift is invisible.** A request the chrome cannot
parse produces no answer, and the daemon reports that as a `session-timeout` — a sentence about
how fast the session is, for what is actually a shape disagreement. The other three fail loudly
or are pinned: a `WorldRow` column that stopped arriving renders `undefined` in the world drawer
on the next open, and both event mirrors now fail `bun run typecheck` on any arm or subscription
row that exists on only one side.

**The retrofit is mechanical, not free.** `WorldRow` moving to `shared/` touches `worlds.ts`,
`api.ts` and every drawer consumer that imports the type from `api.ts`; the event unions moving
touches both event modules plus `tests/events.test.ts`, whose two pins would then be asserting
that a type mirrors itself — i.e. the retrofit *deletes* the pins rather than strengthening them,
and the case for it has to stand without them.

**One real asymmetry argues FOR eventually doing it.** `ServerEvent`'s `session-request` arm is
now composed from the shared type while its five siblings are hand-written, so one file holds two
spellings of the same idea. That is tolerable at one arm and gets worse per arm.

**And one argues against.** `shared/` is scanned by both leakage suites (React-free, engine-free,
zod-free) and the daemon is Node-portable; a type that moves there acquires both constraints
permanently. That is free for the two protocol types added in T4b and would want checking for
anything with a richer shape.

## Trigger to revisit

**The first drift that reaches a user, or the second shared arm — whichever comes first.**
Concretely, any of:

- a `WorldRow` field added on one side only (the unguarded one — most likely at the next
  `world.list` change),
- a third contract crossing this boundary that would otherwise be hand-written (T4b Task 4's
  `session.state` payload is a candidate: if its shape is declared in both bundles rather than in
  `wire.ts`, this entry is already collecting),
- `ServerEvent` reaching a second composed arm, at which point the mixed file should go one way
  or the other.

Not before then: the two event mirrors are the ones a drift would hurt most, and both are now
compile-time enforced, which is most of what the retrofit would buy.

## Reference

- `packages/editor/src/shared/wire.ts` — the shared contract, and the argument for why it alone
  is shared (its module docblock states this entry's case in short form).
- `packages/editor/src/frontend/lib/events.ts` — `ServerEvent` (five hand-written arms, one
  composed) and `EVENT_TYPES`.
- `packages/editor/src/daemon/events.ts` — `DaemonEvent`, the same shape from the other side.
- `packages/editor/src/frontend/lib/api.ts` — `WorldRow`, with the "grep both" comment that is
  currently the whole guard.
- `packages/editor/tests/events.test.ts` — both compile-time mirror pins, and what each cannot see.
