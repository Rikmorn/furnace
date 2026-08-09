# `RefusalClass` has no arm for "your ARGUMENT was wrong"

Foundations T4b Task 1 gave every `refused` result a `because: RefusalClass` — seven classes,
five raised by the gate (`modal`, `typing`, `looking`, `menuOnly`, `session`) and two past it
(`inert`, `member`). The union is deliberately small: it was written for a caller that does
not exist yet, and a set of names invented ahead of its first reader is a set nobody has had
to be right about.

Two refusals carry `inert` that are not really about STATE at all — they are about the
argument the caller passed:

- a world write handed a `name` that is not a valid world name — `useWorld`'s `write`, reached
  by `world.save` / `world.saveAs` / `world.bake`.
- `edit.delete` handed an `entityId` that is not the selected stamp's.

They read as `inert` because one class meaning *"the verb cannot act on what it has"* is truer
than a class per shape while nothing branches on the difference. The distinction that would
justify a split is what a caller DOES next: `inert` says *change the world and ask again*,
where an argument refusal says *ask again differently, and the world is fine*. The member
funnel already has that second shape as its own class (`member` — a tool family with no such
member id), which is the evidence that the seam is real rather than theoretical; it just has
one instance today.

## Trigger to revisit

**The first agent-facing caller that branches on `because`** and would retry differently on
"fix your argument" than on "change the state" — most likely when the MCP surface grows a
write verb taking arguments the caller composes rather than reads off a projection. A split of
`inert` is a widening of the union, which is why the union is exported rather than inlined
into `ActionResult`'s arm.

## Reference

- `packages/editor/src/action-registry/result.ts` — `RefusalClass`, whose docblock carries the
  argument for seven classes and names this seam as the place an eighth would go.
- `packages/editor/src/frontend/lib/actions.ts` — `edit.delete`'s entity-id mismatch refusal,
  the one argument-shaped `inert` in the action table itself.
- `packages/editor/src/frontend/hooks/useWorld.tsx` — `write`'s invalid-name refusal, the
  other one, and the one an agent naming a world is likeliest to meet.
