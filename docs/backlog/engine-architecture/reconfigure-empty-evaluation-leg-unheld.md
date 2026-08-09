# `reconfigureGenerator`'s empty-evaluation leg is documented but unheld

**Context.** `reconfigureGenerator`'s public `@throws`
(`packages/core/src/field/reconfigure.ts`) names two failure classes that live side by side
in `evaluateSpan`: the evaluation being EMPTY, and an evaluated op or placement failing
`assertOpValid`/`assertPatchValid`/`assertPlacementsValid`. T4a Task 5 pinned the second
(`reconfigure.test.ts`, "an evaluated op that fails validation throws with NOTHING
mutated") and left the first unheld.

Both legs are unreachable through the registry — every registered generator emits at least
its shell fill, so no params reach the empty branch — and both are reachable by the same
one-line fixture: swap the registered def's `evaluate` under `try/finally` to return
`{ ops: [], placements: [] }`, the pattern `generators.test.ts` already uses in
"reconfigureGenerator enforces the fact too". The pin that now exists for the validation
leg is the template; this is the same test with a different swapped body.

**The distinction originally argued for holding one and not the other does not survive
reading the source, and is withdrawn here rather than left in a comment.** The claim was
that the `@throws` names the validation clause as a guarantee callers may lean on. It
does — and it names the empty clause in the very same sentence ("...the evaluation is
empty, or an evaluated op or placement fails..."). So both are documented guarantees, and
the real reason only one is held is that Task 5 was closing the validation one. That is a
scope fact, not a principle.

`generators.test.ts` carries the mirror gap: `commitGenerator`'s own empty-result guard IS
pinned there ("an empty evaluated span throws setup-loud; store and log untouched"), using
a synthetic def — which `commitGenerator` accepts directly and `reconfigureGenerator`, which
re-resolves through the registry, does not. So the two committing paths are asymmetric
today for a reason that stopped being true once the `evaluate`-swap pattern was adopted.

**Trigger to revisit:** the next change to `evaluateSpan` or to either path's empty-result
handling; or a third generator-committing path arriving (T4c's MCP verbs would drive both
existing ones); or simply the next session that touches `reconfigure.test.ts`'s setup-loud
block, since the fixture is a copy of the pin directly above it.

**Reference:** `evaluateSpan`'s empty check and its `@throws` in
`packages/core/src/field/reconfigure.ts`; the validation-leg pin and the comment naming
this entry at the end of `reconfigure.test.ts`'s "reconfigureGenerator — setup-loud guards"
block; `commitGenerator`'s equivalent empty-result pin in
`packages/core/src/field/generators.test.ts`.
