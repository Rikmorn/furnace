# 20 `biome-ignore`d non-null assertions survive the noNonNullAssertion error gate

**Context.** The 2026-07-25 hygiene pass cleared all 136 `lint/style/noNonNullAssertion`
warnings and escalated the rule to `error` in `biome.json` so the class "cannot creep back".
That claim has a documented hole: **20 sites across 9 files already carry an explicit
`// biome-ignore lint/style/noNonNullAssertion: …` suppression**, so they were never in the
warning count and the escalation does not flag them. Suppression beats severity in biome —
escalating warn→error changes nothing for an explicitly suppressed site.

The 9 files are all core scene GPU tests:
`packages/core/tests/scene/{effect-kinds,geometry-kinds,light,loader,material-texture,
shader-kinds,texture-kinds,set-entity-transform,entity-box-corners}.gpu.test.ts`.

Their stated reason is uniform — *"guarded by `expect().toBeDefined()` above"* — which is a
legitimate pattern (the `expect` does not narrow the TS type), and the same problem the pass's
new `expectDefined()` helper solves properly. So these are not wrong, just superseded: each is
a candidate for the `expectDefined(v, "label")` conversion, which would let the suppression
comment be deleted outright.

**The residual risk this leaves.** A future author who hits the now-`error` rule can silence it
with a one-line `biome-ignore` and no reviewer signal, exactly as these 20 did while the rule
was a warning. The error gate raises the cost of the *lazy* path but does not close it. If the
zero-`!` posture is meant to be absolute, the follow-up is to convert these 20 and then treat
any new `biome-ignore lint/style/noNonNullAssertion` as a review-blocking exception.

**Explicitly out of the hygiene pass's mandate.** That pass measured the warning set and swept
it; suppressed sites emit nothing to measure, so they were surfaced rather than fixed (the
plan's Task 3 Step 1 "STOP and report the residual rather than carving it out silently").

**Trigger to revisit:** the next tranche touching `packages/core/tests/scene/` (convert that
file's sites in passing), OR a decision that the zero-`!` posture should be absolute rather
than best-effort — at which point convert all 20 and add the review rule.

**Reference:** `biome.json` (`linter.rules.style.noNonNullAssertion: "error"`),
`packages/core/tests/_helpers/expect.ts` + `packages/dungeon/tests/_helpers/expect.ts` (the
`expectDefined`/`at` helpers), `.claude/rules/typescript.md` § intentional-bypass classes,
hygiene-pass commits `e7e77ca6`…`49087f57`.
