# A tool family member's `id` is its DISPLAY LABEL for four of the five families

`familyMembers` in `packages/editor/src/frontend/lib/actions.ts` builds a `ToolFamilyMember.id`
two different ways:

- `"generators"` (the stamp family) — `id: g.id`, a real generator id (`hall`, `maze`).
- `"rows"` (Select, Brush, Cell select) — `id: m.label`, i.e. the string a human reads off the
  rail's flyout: `Dig`, `Fill`, `Paint`, `Smooth`, `Segment`, `Box`, `Wand`, `Room`.

That line is older than this entry and was harmless while `id` was a React key and a cmdk
`value`. **Foundations T4b promoted it.** `runMember(family, memberId, ctx)` now takes the id as
its caller-facing argument, and the id also appears in the refusal sentence it hands back:
`no "Pain" in the Brush tools — its members are [Dig, Fill, Paint, Smooth, Segment]`.

So renaming a brush member from "Smooth" to "Blur" — a pure copy change, the kind the editor
makes freely — is now a breaking change for the exact caller class the id-taking signature was
introduced to serve, and nothing in the repo flags it. That sits directly against the rule this
same tranche wrote into `packages/editor/src/action-registry/result.ts`: prose is free to be
reworded, which is *why* `because` exists as a separate machine-readable field. A member id is
the one place a display string is still load-bearing for a machine.

## Context

**A stable id already exists.** `DerivedMember.ref` is a discriminated union carrying either
`{ effect: … }` or `{ gesture: … }` (`packages/editor/src/shared/action-table.ts`) — `dig`,
`fill`, `paint`, `smooth`, `segment`, `box`, `material`, `void`. Those are data, not copy, and
they are what `armMember` already switches on. An id derived from `ref` would be stable across
any relabelling and would read the same way the generator half already does.

**The test helper is the tell.** `memberIdNamed(members, label)` in
`packages/editor/tests/actions.test.ts` exists to find a member by LABEL and hand back its id,
with a docblock explaining that the two are not the same string for generators. It works around
the coupling rather than closing it — which is the right call for a test, and a signal about the
production shape.

**Why it is not fixed here.** Changing the id shape touches every surface keyed on it: the rail's
flyout keys, the command palette's `value` (`${family.arm.id}.${member.id}`, which cmdk also
scores for search), and possibly persisted UI state. Whether the id and the palette's search
`value` can diverge — and what a member id should be called when it is no longer a label — is a
design decision, not a mechanical rename.

## Trigger to revisit

**The first caller that names a member id from OUTSIDE the chrome.** Worth being precise about
when that is not: T4b does **not** project actions as MCP tools — there is no action-descriptor
projection in this tranche, and its `toJsonSchema` round-trip work is plumbing, not a surface. So
the trigger is **T4c's projection, or any agent-facing `runMember`, whichever lands first**.
Whichever it is, it is the moment a member id stops being an internal key and becomes a name in
someone else's request, and it should land BEFORE that caller exists rather than after — a
stable-id migration is cheap while the chrome is the only consumer.

## Reference

- `packages/editor/src/frontend/lib/actions.ts` — `familyMembers` (the two `id` assignments),
  `ToolFamilyMember`, and `runMember`, whose docblock argues why the funnel takes an id.
- `packages/editor/src/shared/action-table.ts` — `FAMILY_ROWS` and `DerivedMember.ref`, the
  stable ids that already exist.
- `packages/editor/src/frontend/components/shell/CommandPalette.tsx` — `memberRows`, where the
  id is half of the cmdk `value` and therefore half of what search matches on.
- `packages/editor/src/action-registry/result.ts` — `RefusalClass`, and the prose-is-not-a-key
  rule this entry is an instance of.
