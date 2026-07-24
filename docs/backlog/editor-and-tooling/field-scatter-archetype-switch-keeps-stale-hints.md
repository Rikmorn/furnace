# Switching archetype mid-session keeps the previous archetype's scatter hints

**Context.** F3b Task 10 wired the entity catalog into the stamp form: a scatter session
opens with the chosen archetype's authored `scatter` block (density / minSpacing /
scaleRange / variants …) overlaid on the generator's schema defaults
(`seedArchetypeParams`, called once from `FieldHost.startStamp`). The `archetypeId` param
also renders as a picker, its options the catalog ids (`withArchetypeOptions`).

Seeding happens ONCE, at session open. Picking a different archetype in the form after
that changes the id alone — a session opened on `rock` (density 0.3, spacing 1.0) and
switched to `stalagmite` keeps rock's numbers instead of stalagmite's authored 0.15 / 1.4.
The props are placed with the wrong distribution for what they are, and nothing says so.

The alternative — re-seeding on every archetype change — is not obviously right either: it
silently discards whatever the user just tuned. The real answer is probably a third shape
(track which params the user has actually edited and re-seed only the untouched ones, or
offer an explicit "reset to <archetype> defaults" affordance beside the picker), which is
a UX decision, not a patch. Filed rather than guessed at.

**Trigger to revisit:** the F3b gate round, if switching archetype mid-session comes up as
a real annoyance; OR the first catalog with more than two archetypes, where switching
between them stops being a rare gesture. It also becomes moot if a future design gives
each archetype its own palette button (one press = one session, seeded correctly).

**Reference:** `packages/editor/src/viewport-host/field-placements.ts`
(`seedArchetypeParams`, `withArchetypeOptions`);
`packages/editor/src/viewport-host/field-host.ts` (`startStamp` — the seeding call site
and the TSDoc that states the once-only rule); `packages/dungeon/catalog/entities.json`
(the authored `scatter` blocks).
