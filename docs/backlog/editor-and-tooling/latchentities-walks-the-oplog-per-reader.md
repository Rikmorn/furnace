# `latchEntities` walks the whole op log once per reader

An accepted cost with a "revisit if" that had no entry — filed at the T3 objectives
audit (2026-08-08), which flagged it as the one place the programme ADDED a whole-world
cost without applying its own huge-world lens.

## Context

`latchEntities` is the only chrome latch whose subscribe callback does work: it calls
`host.listEntities()`, which **walks the whole op log**, and after T3b1's
context→latch conversion it runs **once per reader — up to four times where the old
provider walked it once**. Accepted at the time with "revisit if the entity list gets
long or the tick gets chattier" (`editor-architecture.md` §21.3, final paragraph) —
this entry is that revisit trigger's home. Under the huge-world handoff's lens
(`engine-architecture.md` §16) this is a per-reader multiplication of an O(oplog) walk,
exactly the class the four named assumptions are watched for.

## Trigger to revisit

- Entity counts or op-log depth grow past toy scale (any F5 "scale" work).
- A public entity-record reader lands
  (`docs/backlog/engine-architecture/field-entity-record-reader.md`) — the fix likely
  rides it (snapshot or memoized entity list at the notify site).

## Reference

- `packages/editor/src/frontend/hooks/useFieldHostState.tsx` (`latchEntities`);
  `docs/reference/editor-architecture.md` §21.3; `engine-architecture.md` §16.
