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

**Trigger to revisit:** the next task that measures a render count on the session card or
adds a second consumer of `subscribeStamp` — F4.5b Task 11 lands in `SessionCard.tsx` and
upgrades the field renderers, which makes each of those 40 renders more expensive than it is
today.

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`notifyStamp` /
`subscribeStamp`), `packages/editor/src/frontend/hooks/useFieldHostState.tsx` (the stamp
mirror, and `sameEntities` beside it as the precedent), `packages/editor/src/frontend/
inspector/SchemaForm.tsx` (the `seed.current !== values` re-seed),
`packages/editor/src/frontend/components/shell/SessionCard.tsx` (`formValues`).
