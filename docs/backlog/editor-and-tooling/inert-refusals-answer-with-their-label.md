# An inert refusal answers with its LABEL — "Move" tells an agent nothing

Filed at the T4c gate walk (2026-08-11) — demonstrated live, not predicted.

## Context

The walk's agent called `action_run {id:"edit.grab", input:{entityId:6040}}` and got
`{ok:false, kind:"refused", message:"Move", because:"inert"}`. "Move" is the verb's
LABEL — the T4a-declared residue (`refuseOrClaim`'s inert case returns
`refused(def.label(ctx))`, argued then as "no gate was consulted and the label genuinely
is the reason"). For a human whose control is greyed out, true. For an agent, "Move" is
a refusal that names neither the missing precondition (a selected entity? an unfrozen
one?) nor a remedy — the exact illegibility class every other refusal arm was cured of
across T4a→T4c.

## The fix

Inert refusals carry the ENABLING CONDITION, not the label: `enabled` predicates are
closed-form reads of ctx facts, so the refusal can say which fact failed ("needs a
selected entity"). Shape candidates: a `hint` beside `enabled` on the def (authored
prose, ~39 sites), or derive from a structured enabling declaration where one exists.
The `because:"inert"` class is right; only the message lies fallow.

## Trigger to revisit

Already fired once (the gate walk). Take at the first agent-facing polish pass — T5 or
the first post-T4 slice.

## Reference

- `packages/editor/src/frontend/lib/actions.ts` — `refuseOrClaim`'s inert arm.
- `docs/learnings/seals/2026-08-11-foundations-t4c-verbs-eyes-gate.md` — the walk.
