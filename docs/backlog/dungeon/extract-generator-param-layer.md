# Extract the generator param layer out of `field/generators.ts`

`packages/core/src/field/generators.ts` grew from 758 lines (F2b) to ~1050 across F3a
Task 7, and the growth is concentrated in one cohesive band that is not "generator"
code at all: the param vocabulary and its parsers — `WALLS`, `runsAlongX`, `DoorSpec`,
`AUTO_CENTRE`, `ROTATION_KEY`, `OPTIONAL_PARAM_KEYS`, `requiredKeys`, `ROTATIONS` /
`QUARTER_TURNS`, `intParam` / `numParam` / `boolParam` / `rotParam` / `doorOffsetParam` /
`doorsParam`, and `assertDoorOffsetFits`. That is ~150 lines whose only job is turning an
untyped params record into narrowed, range-validated values.

Splitting it into `field/generator-params.ts` would mirror the split already made for
`field/reconfigure.ts` and `field/snapshots.ts`, and would leave `generators.ts` holding
the two grid builders, `gridToOps`, `rotateGrid`, `openDoor` and the registry — the
actual generator concern. The param module is also where a third generator (F3's cave)
would plug in without touching the hall or maze.

Not done during Task 7's review round: it is a pure move with no behaviour change, the
file had three other commits landing on it in the same window, and mixing a 150-line
relocation into a fix commit would have buried four real corrections in the diff. It
wants its own commit on a quiet file.

One constraint the move must respect: `SharedParamKey` is defined as
`keyof typeof HALL_SCHEMA.properties & keyof typeof MAZE_SCHEMA.properties` and pins
`WALLS`' and `ROTATION_KEY`'s key strings to the schemas. If the param layer moves out
while the schemas stay, that type has to move with the schemas or be re-expressed, or the
pin silently stops pinning. There is a test that would catch the `required` half of the
drift, but not the `WALLS` half — that one is compile-time only.

**Trigger to revisit:** the F3 cave generator (a third schema is the forcing function), or
the next time `generators.ts` is opened for more than a small fix.

**Reference:** `packages/core/src/field/generators.ts`; the sibling splits at
`packages/core/src/field/reconfigure.ts` and `packages/core/src/field/snapshots.ts`.
