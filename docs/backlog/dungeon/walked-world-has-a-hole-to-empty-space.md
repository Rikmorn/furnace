# A walked world has a hole to empty space, and nothing detects it

Observed by the owner walking sculpting-worlds cycle 2's `monastery-in-the-rock` world in
the game (`bun run dungeon:dev`, 2026-08-12): *"it having a hole to empty space"* — somewhere
the world opens onto void rather than onto rock or onto more world.

**This entry is filed WITHOUT the location.** The owner's walk verdict was collected as prose
and the coordinates were not captured; the world is a local gitignored artifact on the
authoring machine, so a later reader cannot recover them either. That missing field is the one
thing that would make this actionable, and it is recorded as missing rather than guessed.

## What has been ruled out, measured

- **Not a pit.** `bun scripts/measure-analyze.ts` from `packages/dungeon` over that world
  (2026-08-12, post-re-bake, local artifact on the authoring machine) reports **0 pit
  regions** across 2,541 flags, with `seeds: 1/1 usable` so the detector actually ran.
- **Not an escape past the allocated field.** `packages/core/src/field/chunks.ts:12` and `:53`
  — *"unallocated chunks read as SOLID"*. A carve that leaves the allocated region meets rock,
  not void, so "carve containment at the chunk frontier" (the walk verdict's first guess) is
  not the mechanism.
- **Probably not the mesher.** `field-mesher-degenerate-triangles.md` records zero-area
  triangles on symmetric surfaces, but also that they *draw nothing* and that the render mesh
  is visually watertight, with zero count-1 holes verified at an 8-chunk corner.

## What is left, unranked and untested

- **The bake region does not contain the carve.** `world.bake` compiles a region; anything
  built outside it would simply not be in the artifact the game loads, which would read
  exactly like a hole. This is the leading candidate on elimination alone.
- **A surface the analyzer has no detector for.** There is no "the world opens onto nothing"
  check anywhere — `analyzeWorld` finds narrow, low-clearance, ledge, lip-near-wall and pit,
  none of which is this. Whatever the cause, **the class is undetected**, and that is the part
  of this entry that survives even if the specific hole turns out to be trivial.

The second bullet is the reason this is filed at all. Cycle 2's world was analysed, walked and
reported on, and a defect a human found in minutes is invisible to every automated pass we
have.

**Trigger to revisit:** the next time anyone walks a baked world and sees through it — capture
the coordinates then, because this entry cannot be closed without a location. Sooner if a
detector for "open to void" is cheap to add alongside the advisor's other passes, in which case
the detector closes the class without ever locating this instance.

**Reference:** `docs/learnings/2026-08-12-agent-world-building-cycle-2.md` (the walk verdict
and the analyzer numbers, with their deriving commands);
`packages/core/src/field/chunks.ts:12,53` (unallocated reads solid);
`packages/core/src/field/analyze.ts` (the flag kinds, none of which is this);
`docs/backlog/dungeon/field-mesher-degenerate-triangles.md`.
