---
status: queued
injected: true
after: undo-attribution
summary: the door items the agent world-building cycles priced — the E0-equivalent set
---

# The door set

The tool-surface gaps that the sculpting-worlds cycles surfaced and that the owner ruled
into one set. Formerly called "the cycle-3 E0-equivalent set"; that cycle was dissolved and
the work item carries the name now.

**Members** — the entries carrying `consumer: door-set`, which is the authority (find them
with `grep -rl '^consumer: door-set' docs/backlog/`):

- `docs/backlog/engine-architecture/field-read-surface-gaps.md` — the all-crossings ray,
  plus the read surface around it.
- `docs/backlog/engine-architecture/stamps-not-authored-to-connect.md` — door anchors.
- `docs/backlog/editor-and-tooling/advisor-answers-volume-not-questions.md` — advisor
  filtering and rollup.
- `docs/backlog/editor-and-tooling/edit-apply-reports-nothing-about-what-it-wrote.md` —
  `edit_apply` write-counts.
- `docs/backlog/engine-architecture/lattice-aligned-box-op-writes-nothing.md` — the
  lattice-aligned box defect.

**⚠️ Membership needs an owner ruling.** The queue was carried in memory as *four* door
items; the register carries **five**, because `lattice-aligned-box-op-writes-nothing.md`'s
own body says it was "scheduled into the E0-equivalent set". `consumer:` was applied by the
stated rule (the entry's body names a future slice that reads it) rather than by the
remembered count. Confirm the fifth belongs, or drop its `consumer:`.

Explicitly NOT in the set:
`docs/backlog/engine-architecture/field-op-vocabulary-has-no-architectural-altitude.md` —
ruled out at cycle 2's close because it changes the editor's authoring model rather than
the door.

Note that one member's stated mechanism is disputed —
`docs/backlog/engine-architecture/box-op-write-gate-attribution.md` argues the box entry
blames the wrong write gate. Read it before scoping that member.
