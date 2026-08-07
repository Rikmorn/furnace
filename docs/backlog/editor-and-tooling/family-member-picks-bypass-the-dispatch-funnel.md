# Family MEMBER picks do not go through `runAction` — "the one funnel" is not literally true

`runAction` is documented as *"the one funnel every surface dispatches through"*. Picking a
member out of a tool family is the exception: the rail's flyout and the ⌘K member rows call
`member.arm(ctx)` directly, which reaches the host or a `ctx.run` verb and produces no
`ActionResult` at all.

## Context

Two arm closures, both in `packages/editor/src/frontend/lib/actions.ts` (re-read them; the
surrounding table moves):

- the rows half — `familyMembers`' `"rows"` branch hands each member
  `arm: (c) => armMember(m, c)`, which calls `c.run.setGesture` / `c.run.armBrush`;
- the generators half — `arm: (c) => c.host?.startStamp(g.id)`.

Neither is gated by `gateAction`, neither returns a Result, and neither is voiced by
`sayResult`. Two surfaces call them: `ToolRail.tsx`'s `MemberFlyout` and
`CommandPalette.tsx`'s `memberRows`.

**Pre-existing, and not currently a defect a user can reach.** Both surfaces refuse BEFORE
the pick rather than inside it: the flyout's trigger checks `row.verdict` and answers a
refused press through `notify.sayRefusal` without opening, and the palette's member rows
carry the family's `controlVerdict` and render `disabled`, which cmdk skips for the arrows,
for auto-selection and for ⏎. So a refused member cannot currently be picked by either
route. What is wrong is the CLAIM, and the exposure a third caller would inherit.

**Why T3b2 Task 5 did not close it**, having rewritten this exact code: routing a member pick
through the funnel is a behaviour change, and Task 5's contract was that the six tables become
derivations with the chrome suites green unmodified. The stamp family is the tempting case —
`tool.stamp` already carries a `{generatorId}` input schema, so
`runNamed(byId("tool.stamp"), ctx, { generatorId: g.id })` would work today — but it would add
a gate and a toast to a path that has neither, which belongs in a task licensed to change
behaviour.

The rows half has no such route yet: `tool.brush` and `tool.select` arm the family's CURRENT
member and carry no input, so closing that half means either giving them an
`{ effect } | { gesture }` input schema or minting an action per member. That is a design
decision with a deletion pass of its own (an action per member would put Dig, Fill, Paint,
Smooth, Segment, Box, Wand and Room into `ACTION_DESCRIPTORS`, which is eight rows the ⌘K
palette already renders from `memberRows` — ship one and delete the other, or ship neither).

## Trigger to revisit

Any of:

- **A third caller of `member.arm` appears** — it will not inherit either surface's
  pre-check, and the refusal that both existing callers make unreachable becomes reachable.
- **The MCP surface lands** (foundations T4/T5). An agent asking to arm Paint has no rail
  flyout to be refused by, and "every verb answers with an `ActionResult`" is the property
  that surface is being built on.
- **`tool.brush` / `tool.select` gain an input schema** for any other reason — at that point
  the rows half is one call site away from the funnel.

## Reference

- `packages/editor/src/frontend/lib/actions.ts` — `familyMembers`, `armMember`, and
  `runAction`'s *"one funnel"* docblock.
- `packages/editor/src/frontend/components/shell/ToolRail.tsx` — `MemberFlyout`, and the
  trigger's refusal check.
- `packages/editor/src/frontend/components/shell/CommandPalette.tsx` — `memberRows`, and
  `disabled={!row.verdict.runnable}` on the row.
- `docs/reference/editor-architecture.md` §22.6 — the funnel and the three failure
  provenances.
