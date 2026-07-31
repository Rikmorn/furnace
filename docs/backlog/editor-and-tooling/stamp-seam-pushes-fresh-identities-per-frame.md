# The stamp seam pushes fresh identities per frame, so no consumer memo can hold

**Context.** `FieldHost.subscribeStamp` publishes `structuredClone(stamp)` on every
`notifyStamp` — every param edit, every region nudge, every phase transition, at pointer
rate while a move drag runs. So `session.params` is a NEW object identity on every push even
when nothing in it changed, and every downstream memo keyed on that identity recomputes.

The concrete cost measured in F4.5b Task 10, through the real Shell + stub host, 20 distinct
session pushes, counting `SchemaForm` renders:

| | no `formValues` memo | with it |
|---|---|---|
| host clones params (production today) | 40 | **40** |
| params identity held stable (counterfactual) | 40 | **21** |

`SchemaForm` re-seeds its drafts whenever `values` is a new array, and that re-seed is a
state write during render — hence two renders per push, each rebuilding every field row. The
card's own `useMemo` is correct and is the half that belongs in the component; it simply
cannot reach the cause. The same shape will bite every future consumer of this seam.

**What the fix is not.** Not "stop cloning": the clone is what keeps the chrome from holding
host state, which is a rule worth more than the renders.

**The options**, all of which need a decision rather than an edit:
(a) a value-equality guard in `useFieldHostState`'s stamp mirror (the `sameEntities`
precedent — `setStamp(prev => sameSession(prev, s) ? prev : s)`), which needs a definition of
"same session" that is honest about `run`, `phase` and `region`;
(b) a narrower guard on `params` alone, since that is the field whose identity drives the
form — cheaper, and it leaves phase/region churn re-rendering the card as it should;
(c) push a stable `params` from the host by cloning only when the params actually change.

(b) looks cheapest and most targeted, but the comparison depth is the real question — the
entity comparator next door compares through `formatParam` because what must not go stale is
the STRING on screen, and the same argument may or may not apply to a live form.

**STATUS 2026-07-31 (F4.5b Task 11 — trigger fired, still NOT acted on).** Task 11 did land
in `SessionCard.tsx` and did upgrade the renderers (bounded numbers became a range + a
scrubby label + an exact input; small enums became segmented controls), so the premise above
— "which makes each of those 40 renders more expensive" — was due for a measurement. It was
taken, and it does not support acting:

| card form (4 params) | 20 session pushes | DOM nodes in the card |
|---|---|---|
| 4 plain `NumberField`s | 19.0 / 23.0 / 20.1 ms | 47 |
| slider + stepper + slider + segmented | 18.4 / 23.0 / 21.8 ms | 55 |

Three runs each through the real Shell + stub host, with a warmup mount before both (the
FIRST measurement pair was confounded: whichever form ran first looked ~30% slower, which
is module init and JIT, not the form). The two are indistinguishable at ~1 ms per push, and
the +17% DOM is not where the cost is — the re-seed-during-render is. So the extra renderers
did NOT raise the stake; the entry stands on its original argument, unchanged.

Two honest limits on that number: it is happy-dom, not a browser (no layout, no paint), and
it is a FOUR-param form. A scatter's ten params under a pointer-rate move drag is the case
that would actually hurt, and it is still unmeasured.

**Trigger to revisit:** a MEASURED render cost on a real browser under a pointer-rate drag
(a move, not a click), or a second consumer of `subscribeStamp`. The "a task upgrades the
renderers" half of this trigger has now fired once and paid nothing — do not re-fire it.

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`notifyStamp` /
`subscribeStamp`), `packages/editor/src/frontend/hooks/useFieldHostState.tsx` (the stamp
mirror, and `sameEntities` beside it as the precedent), `packages/editor/src/frontend/
inspector/SchemaForm.tsx` (the `seed.current !== values` re-seed),
`packages/editor/src/frontend/components/shell/SessionCard.tsx` (`formValues`).
