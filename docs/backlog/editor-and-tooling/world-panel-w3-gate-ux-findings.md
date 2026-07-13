# World panel: W3 phase-gate UX findings (six, deferred to 3.5 as a set)

**Context.** The W3 phase gate (2026-07-13) was passed — assemble → bake → walk — but
the user hit real assembly friction. None are mechanism bugs; all were observed live
during the gate. Deferred as a SET to 3.5 Curating (user decision at the seal:
no post-gate fix round; 3.5 owns assembly/curation depth).

1. **"no portal 0" error is unactionable.** `realizeWorldSpec`'s "start region X has
   no portal 0 to spawn at" doesn't say WHY (doors come from connectors — attach a
   region) or what to do. One-line message fix in `world-build.ts`.
2. **The panel never says the empty draft IS a new world.** The user went hunting for
   a "new world" menu/file facility and read the scene picker (document session) as
   the world list. An empty-state line in the panel fixes the mental model.
3. **The Add form reads as a picker, not a creator.** "attach to" listing existing
   regions invites "I can only pick existing ones"; the Add button sits at the bottom
   of a long field row.
4. **Attachments aren't editable after add.** A wrong portal offset costs a leaf-first
   subtree teardown (remove N regions, re-add N). Minimum: pre-validate the parent
   door at Add time; better: editable portal fields on the region row.
5. **Form defaults produce a REFUSED world.** Parent offset default 2 + the default
   pillarHall preset = door lane dead on a colonnade row → stamp-time throw. Defaults
   that fail the happy path are a trap (offset 3 threads every preset's pillar rows).
6. **Generate on an unfinished draft reads as a dead end.** The red failure gives no
   hint that assembling more regions is the fix (same root as 1).

**Trigger to revisit:** the 3.5 Curating brainstorm (it owns the World panel's
curation/assembly depth; fold these into its spec as day-one requirements).

**Reference:** W3 seal (docs/learnings/seal-log.md), the W3 gate conversation;
related entries: `world-panel-add-disabled-without-reason.md`,
`world-panel-number-field-ux.md`, `world-panel-region-fieldset-a11y.md`.
