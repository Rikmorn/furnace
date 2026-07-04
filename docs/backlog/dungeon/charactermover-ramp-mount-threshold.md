# Dungeon: CharacterMover can't mount a ramp steeper than ~48° from flat ground

**Context.** Empirical data from Slice 2.2.5b-B1 Task 1 execution (per-frame GPU traces): the
`CharacterMover` mounts a **47.2°** ramp from flat ground successfully, but **stalls** at the
flat→**49.64°** junction at a ramp foot — it cannot climb onto the ramp from a flat approach.
Meanwhile `connect.ts` `chooseKind`'s ramp band tops out at **52°**
(`SLOPE_LIMIT_RAD − RAMP_MARGIN`, with `MAX_SLOPE_DEG` 55 and `RAMP_MARGIN` 3°) — i.e.
`chooseKind` can emit a ramp in the ~48–52° range that the mover cannot actually mount from a
flat approach. In B1 this is **dormant**: the landing was scoped away from ascending ramps
(see `landing-walled-low-portal-discriminator.md`), so ascending ramps keep their original
continuous-climb-from-portal geometry with no flat→steep junction for the mover to stall on.

**Trigger to revisit.** Any Slice 2.2.5b-B2 layout that produces a ramp in the ~48–52° band —
especially with a flat approach (e.g. a landing meeting a ramp foot) — OR any `CharacterMover`
work. Options: tighten `RAMP_MARGIN` so `chooseKind` flips to stairs below the practical mount
threshold, OR add ramp-foot mount assistance to `char-move.ts` (a step-up at the flat→ramp
junction).

**Reference.** `packages/dungeon/src/connect.ts` (`chooseKind`), `packages/dungeon/src/walkability.ts`
(`RAMP_MARGIN`, `SLOPE_LIMIT_RAD`, `MAX_SLOPE_DEG`), `packages/dungeon/src/char-move.ts`.
Surfaced during Slice 2.2.5b-B1 execution (2026-07-03).
