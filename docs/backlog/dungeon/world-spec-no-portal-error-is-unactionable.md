# `realizeWorldSpec`'s "no portal 0" error says nothing actionable

`packages/dungeon/src/world-build.ts (gone):672` throws
`world: start region <id> has no portal 0 to spawn at` when the start region has no
door to spawn in. The message names the symptom and nothing else: it does not say that
doors come from CONNECTORS (so the fix is "attach a region", not "edit the region"), and
it does not say which of the spec's regions could legally be attached instead.

Filed at the W3 phase gate (2026-07-13) as an editor UX finding, when the World panel
surfaced this throw as a red banner with no next step. **That panel was deleted at F4.5a
and the rest of the W3 set died with it — this half did not.** `realizeWorldSpec` is
still live and still reachable: `bake.ts`'s `bakeWorld` and `editor-extensions.ts` both
call it, so the message still lands on whoever bakes a hand-authored `WorldSpec`.

A one-line message fix, worth doing whenever someone is next in `world-build.ts`.

**Trigger to revisit:** the next time a `WorldSpec` is authored or baked by hand, or any
work that reopens `world-build.ts`'s error surface.

**Reference:** `packages/dungeon/src/world-build.ts` (gone) (the throw); W3 seal in
`docs/learnings/seals/2026-07-11-epic3-recharter-w1-world-model.md`. The five sibling findings it was filed with were all about
`packages/editor/src/frontend/components/world-panel/`, deleted at F4.5a Task 4.
