# The wing-session model in `generation.ts` has zero production consumers

`packages/editor/src/frontend/lib/generation.ts` still carries the pre-W3 **wing** flow:
`GenerationStatus`, `GenerationSession`, `initialSession`, `nextRerollSeed`,
`invalidateDonePreview`, `EnvelopeRow`, `envelopeRowFor`, `clampRooms`, `clampLoop`,
`MAX_LOOP`, `reliabilityText` — roughly 130 LOC. After W3 Task 13 retired
`GenerationPanel` in favour of the World panel, the ONLY importer of any of them is
`packages/editor/tests/generation-session.test.ts`: about ten tests that exist solely to
test code nothing ships. (The wing *bake* path in the daemon and the worker's `run`/`bake`
messages are a separate question — this entry is about the chrome-side session model.)

The W3 plan declares the keep deliberately ("the wing-flow block stays for W4"), so this is
**not** a delete-now item. It is recorded because it is a live gap against
`.claude/rules/working-standards.md` §Design ("deletion pass before addition pass" /
"single source of truth"): W4 will either adopt this model for whatever a wing becomes, or
it should die — git history is the backstop, and `COCKPIT_ENVELOPE` (the measured table the
clamps read) is engine-side and survives either way.

**Trigger to revisit:** the start of W4. Decide there: adopt (and give it a production
consumer) or delete the block plus its tests.

**Reference:** `docs/reference/editor-architecture.md` §13 (cockpit),
`packages/editor/src/frontend/lib/generation.ts`.
