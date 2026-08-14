---
status: in-flight
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

**Correction 2026-08-14 (pre-plan digest, five load-bearing claims verified in-session at
the isolate-hardening review):** "an agent that can dig cannot un-dig" is true of the
DOOR, not the engine. The undo engine exists and is byte-exact — `OpInverse` carries
materials, so core restores the destroyed material class, not just emptiness — and
`edit.undo`/`edit.redo` are FENCED actions whose fence message names this slice as its
lift condition. The slice is a fence-lift plus the wire-format/attribution design, not
building undo; the plan must not inherit the old pessimism. First design question, from
the same digest: **op-level vs entry-level attribution** — the undo/redo stacks are not
serialised (`serializeOps` writes `{version, ops}` only), so entry-level attribution dies
at save/reload; attribution that must survive reload leans op-level, but that is the
design session's ruling to make. The digest's compaction probe (`compactableOps: 0`) is
UNVERIFIED — re-run it before leaning on the synthetic-fixture argument. The migration
payload is one committed file (`worlds/default/oplog.json`, v3, 109 ops).
