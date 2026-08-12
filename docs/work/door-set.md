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

**Membership: five, and the fifth is undecided — settle it at planning.** The queue was
carried in memory as *four* door items; the register carries **five**, because
`lattice-aligned-box-op-writes-nothing.md`'s own body says it was "scheduled into the
E0-equivalent set". `consumer:` was applied by the stated rule (the entry's body names a
future slice that reads it) rather than by the remembered count. **Put to the owner
2026-08-12 at the docs-system sitrep gate; the answer was "I really don't know", so the
call is deliberately deferred to this slice's planning session** — the fifth stays marked
until then, which keeps it protected from consolidation in the meantime.

Note when deciding: that entry's stated mechanism was corrected on 2026-08-12 and the
defect is **narrower** than its title suggests (a lattice-aligned fill into air does write;
only a fill against already-solid cells silently does nothing). That may change whether it
belongs in this set at all.

Explicitly NOT in the set:
`docs/backlog/engine-architecture/field-op-vocabulary-has-no-architectural-altitude.md` —
ruled out at cycle 2's close because it changes the editor's authoring model rather than
the door.
