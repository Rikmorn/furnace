# field: empty scatter currently throws like a context-free generator

The scatter generator (`packages/core/src/field/scatter.ts`, F3b) is a
`contextFree: false` READER: it projects props onto carved surfaces and returns
`{ ops: [], placements }`. When it finds no surfaces — low `density`, a small
region, an all-solid field, or a `hemisphere` whose crossings all fail the normal
filter — it returns `{ ops: [], placements: [] }`, and `commitGenerator` /
`reconfigureGenerator` reject that with the shared "evaluated to an empty result"
throw (`evaluateSpan`, `commitGenerator`). The throw is atomic (validate-all-then-
apply, no mutation), and consistent with the two-pass posture.

That throw is the RIGHT default for hall / maze / cave, where an empty result
means a degenerate/misconfigured stamp. For scatter it is arguably WRONG: zero
props is a legitimate outcome of a reader generator over a field with no matching
surfaces, not a caller error. A user who lowers density until nothing lands, or
reconfigures a scatter whose upstream cave was re-carved away from under it (the
re-cook re-rolls to zero props), hits a hard throw for a well-formed request.

The decision is unsettled and its UX consequence lands in the editor, not core:
should a zero-prop scatter (a) keep throwing (current — simplest, pins the
invariant "a commit mutates something"); (b) commit an empty placement op (needs
`commitGenerator` to accept an all-empty result FOR PLACEMENT-EMITTING generators
only, plus a rule for what a zero-record placement op means on replay/undo); or
(c) be caught at the editor layer and surfaced as "0 props, nothing placed"
without reaching core? Option (c) keeps core strict and is the least invasive.
`field-scatter.test.ts` pins the current (a) contract so a change here is a
conscious edit, not drift.

**Trigger to revisit:** the F3b editor scatter UX task (Task 10) — the first place
a human dials scatter params and can drive it to zero; or the first report of a
user reconfiguring a scatter to zero props and hitting the throw.

**Reference:** F3b D-F3-8 (the evaluate widening + placement records); this review
(code-quality pass on the scatter task, 2026-07-24);
`docs/reference/core-modules.md` §`@furnace/core/field` (Staged generators — the
empty-result rejection; The scatter generator);
`packages/core/src/field/generators.ts` (`commitGenerator` empty-result throw),
`packages/core/src/field/reconfigure.ts` (`evaluateSpan` empty-result throw),
`packages/core/tests/field-scatter.test.ts` (the pin test).
