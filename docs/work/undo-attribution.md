---
status: queued
injected: true
summary: op-log undo designed WITH attribution — one wire-format pass, before any further world runs
---

# Undo + attribution

Agent-side undo and op attribution are **one design, not two** — ruled 2026-08-09.

The reason is the wire format: both change what an op-log entry carries, and doing them
separately means two migrations of the same format, with the second one re-opening the
first. Designing them together costs one pass.

**Before further world runs.** Every agent world-building cycle so far has hit the missing
undo — an agent that can `dig` cannot un-`dig`, so a wrong op is permanent and the run
routes around it. Running another cycle before this lands buys findings that are already
known.

Related backlog: `docs/backlog/engine-architecture/oplog-group-apply-is-not-a-transaction.md`
and `docs/backlog/engine-architecture/oplog-entry-assembly-duplicated-three-ways.md` — both
touch the same entry-assembly path this slice has to change.
