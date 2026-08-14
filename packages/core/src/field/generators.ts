// packages/core/src/field/generators.ts — staged stamp generators (F2b).
// The hall and the maze are ported from the dungeon donors (themes/hall.ts,
// themes/maze.ts + the shared doorAt/validateDoorApproach machinery in
// themes/grid-stamp.ts — W3) onto a core-local mini coarse grid; evaluate()
// compiles the grid into a span of lattice-snapped brush ops. The registry is
// the ONE plug point (resolves the third-grid-vocabulary dispatch tax), and
// commitGenerator owns the entity semantics: one commit = one undo entry.
import { type FurnaceMeta, z } from "../registry/index.ts";
import { caveGenerator } from "./cave.ts";
import {
  applyFieldOp,
  assertOpValid,
  assertPatchValid,
  assertPlacementsValid,
} from "./ops.ts";
import { defineGenerator, MUST_BE_INTEGER } from "./registry.ts";
import { fnv1a, makeIntRng } from "./rng.ts";
import { scatterGenerator } from "./scatter.ts";
import type {
  BrushOp,
  ChunkKey,
  EntityOp,
  EvaluateContext,
  FieldOp,
  FieldStore,
  GeneratorDef,
  GeneratorEntity,
  GeneratorResult,
  MaterialTable,
  MergePolicy,
  OpInverse,
  OpLog,
  PlacementOp,
} from "./types.ts";

const CELL = 0.5;
const DOOR_W_CELLS = 4; // 2.0 m — the carried grid standards
const DOOR_H_CELLS = 6; // 3.0 m
/** How deep (coarse cells) a door's centre walk-lane must be clear of solids
 *  (the donor DOOR_CLEARANCE_DEPTH_CELLS — 2.0 m, the player-probe inset). */
const DOOR_CLEARANCE_DEPTH_CELLS = 4;

const AIR = 0;
const SOLID = 1;

type MiniGrid = { dims: [number, number, number]; cells: Uint8Array };

/** Off-grid reads SOLID (the donor coarseGet convention: the stamp's outside
 *  is sealed, so validation lanes never leak past the shell). */
const gridAt = (g: MiniGrid, i: number, j: number, k: number): number => {
  const [nx, ny, nz] = g.dims;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return SOLID;
  return g.cells[i + nx * (j + ny * k)] as number;
};

/** Setup-loud out-of-bounds write, matching the donor coarseSet contract. */
const gridSet = (
  g: MiniGrid,
  i: number,
  j: number,
  k: number,
  v: number,
): void => {
  const [nx, ny, nz] = g.dims;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz)
    throw new Error(`field generator: gridSet out of bounds (${i},${j},${k})`);
  g.cells[i + nx * (j + ny * k)] = v;
};

const createGrid = (
  dims: [number, number, number],
  fill: number,
): MiniGrid => ({
  dims,
  cells: new Uint8Array(dims[0] * dims[1] * dims[2]).fill(fill),
});

const snapDown = (v: number): number => Math.floor(v / CELL) * CELL;

/** Compile a mini grid into ops: ONE kit-class fill box over the whole stamp
 *  AABB (masked solid-only under keep-existing-air), then one dig box per
 *  x-run of AIR cells per (j,k) row. Every op is lattice-snapped by
 *  construction (cell corners are multiples of CELL from the snapped origin). */
function gridToOps(
  grid: MiniGrid,
  origin: [number, number, number],
  kitClassId: number,
  policy: MergePolicy,
): BrushOp[] {
  const [nx, ny, nz] = grid.dims;
  const ops: BrushOp[] = [];
  const box = (
    i0: number,
    j0: number,
    k0: number,
    wi: number,
    wj: number,
    wk: number,
  ): BrushOp["shape"] => ({
    kind: "box",
    center: [
      origin[0] + (i0 + wi / 2) * CELL,
      origin[1] + (j0 + wj / 2) * CELL,
      origin[2] + (k0 + wk / 2) * CELL,
    ],
    halfExtents: [(wi * CELL) / 2, (wj * CELL) / 2, (wk * CELL) / 2],
  });
  ops.push({
    id: 0,
    kind: "brush",
    effect: "fill",
    material: kitClassId,
    shape: box(0, 0, 0, nx, ny, nz),
    ...(policy === "keep-existing-air"
      ? { mask: { kind: "solid-only" as const } }
      : {}),
  });
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      let run = -1;
      for (let i = 0; i <= nx; i++) {
        const air = i < nx && gridAt(grid, i, j, k) === AIR;
        if (air && run < 0) run = i;
        if (!air && run >= 0) {
          ops.push({
            id: 0,
            kind: "brush",
            effect: "dig",
            shape: box(run, j, k, i - run, 1, 1),
          });
          run = -1;
        }
      }
    }
  return ops;
}

type Wall = "north" | "south" | "east" | "west";

/** A param key BOTH generator param tables declare. Used to PIN the key
 *  strings {@link WALLS} looks up to the zod tables that actually declare
 *  them: rename or drop one of those params on either table and the
 *  `satisfies` below stops compiling. It pins existence, not role — it cannot
 *  tell a door key from a rotation key. */
type SharedParamKey = keyof typeof HALL_PARAMS & keyof typeof MAZE_PARAMS;

/** The per-wall param spellings — ONE table feeding the enable lookup, the
 *  offset lookup, and the carve/validate order for BOTH generators (so the two
 *  report door errors in the same order). Each schema still writes its own
 *  eight door properties as literals; `SharedParamKey` is what keeps those
 *  literals and these in step. */
const WALLS = [
  { wall: "north", enable: "doorNorth", offsetKey: "doorNorthOffset" },
  { wall: "south", enable: "doorSouth", offsetKey: "doorSouthOffset" },
  { wall: "east", enable: "doorEast", offsetKey: "doorEastOffset" },
  { wall: "west", enable: "doorWest", offsetKey: "doorWestOffset" },
] as const satisfies readonly {
  wall: Wall;
  enable: SharedParamKey;
  offsetKey: SharedParamKey;
}[];

/** Whether a wall runs along X (north/south) rather than Z (east/west) — the
 *  axis the door carve, the lane check and the offset bound all switch on.
 *  ONE spelling of a predicate that was open-coded at four call sites. */
const runsAlongX = (w: Wall): boolean => w === "north" || w === "south";

/** One enabled doorway: its wall, the param key its offset came from (for
 *  error messages) and the resolved lateral offset — `undefined` = auto-centre.
 *  The offset's UNIT is the generator's own (coarse cells for the hall, maze
 *  cells for the maze); each generator maps it before {@link openDoor}. */
type DoorSpec = { wall: Wall; offsetKey: string; offset: number | undefined };

/** The `-1` sentinel: both the schema default and the value a form user picks
 *  to mean "auto-centre this door". */
const AUTO_CENTRE = -1;

// THE OPTIONAL-BUCKET RULE, for every future param addition:
// `GeneratorEntity.params` is persisted, and `reconfigureGenerator`
// re-evaluates from the recorded set as a COMPLETE replacement. So a param
// added after entities exist in the wild MUST be spelled
// `.default(identity).optional()`, or every previously-saved entity becomes
// un-reconfigurable. A param present since a generator's first release stays
// REQUIRED (`.meta({ default })` — form metadata, missing key still throws) —
// missing it is a caller bug, not old data. `generators.test.ts`'s
// no-third-bucket test pins the derived `required` list to exactly this split.

/** The quarter-turn rotations, as STRINGS — ONE spelling feeding the schema
 *  enum, the narrowed type and the runtime check, so the three cannot drift.
 *
 *  Why strings rather than the numbers 0/90/180/270: the editor's inspector
 *  renders every enum through a Radix Select whose option values are strings
 *  and commits that STRING straight back into the params record — it never
 *  coerces to the schema member's original type, unlike its number/vec/quat
 *  fields. A numeric enum would therefore arrive here as `"90"` and be
 *  rejected, leaving the knob dead on arrival in the one UI it exists for.
 *  String members also keep ONE spelling in persisted `GeneratorEntity.params`
 *  rather than two (`90` from an API caller, `"90"` from the form), which is
 *  what a later migration or equality check would otherwise have to reconcile.
 *  See `docs/backlog/editor-and-tooling/editor-chrome-authoring-gaps.md`
 *  § *EnumField stringifies enum members and never coerces back — numeric enums are
 *  dead on arrival*. */
const ROTATIONS = ["0", "90", "180", "270"] as const;
type Rotation = (typeof ROTATIONS)[number];

/** Quarter turns about +Y, the integer form {@link rotateGrid} works in: 1 =
 *  90° counter-clockwise viewed from +Y (the repo's right-handed Y-up
 *  convention — `docs/reference/engine-conventions.md`). */
type QuarterTurn = 0 | 1 | 2 | 3;
const QUARTER_TURNS: Record<Rotation, QuarterTurn> = {
  "0": 0,
  "90": 1,
  "180": 2,
  "270": 3,
};

/** Quarter-turn rotation of a mini grid about +Y, applied AFTER the grid is
 *  fully built (doors carved and validated), so the two generators share ONE
 *  implementation and neither can rotate its doors out of agreement with its
 *  walls. Cell-exact and integer-only — no float math, so a rotated stamp lands
 *  on the same 0.5 m lattice as an unrotated one (Pr-2 discipline).
 *
 *  A 0-turn rotation returns the INPUT grid itself, not a copy — which is what
 *  makes the unrotated path provably free and byte-identical. Callers treat the
 *  result as read-only (both feed it straight to {@link gridToOps}); anything
 *  that needs to mutate the result must copy first.
 *
 *  The cell map, for a source grid of dims [nx, ny, nz]:
 *  90° `(i, k) → (k, nx−1−i)`, 180° `(i, k) → (nx−1−i, nz−1−k)`,
 *  270° `(i, k) → (nz−1−k, i)`. In centred coordinates 90° is `(u, v) → (v, −u)`
 *  — a positive right-handed rotation about +Y. X and Z dims SWAP for 90/270.
 *
 *  Rotation is about the grid's own min corner, which the caller anchors at
 *  `snapDown(region.min)`: a 90/270 stamp on a region that is not square in XZ
 *  therefore occupies a different world AABB than its unrotated form, and can
 *  extend past the recorded `region`. That is the SAME region-vs-params
 *  mismatch the field host already documents for oversized params
 *  (`packages/editor/src/field-host/field-host.ts`, `snapshotChunks`: "the
 *  region-vs-params mismatch is the stamp UI's to surface"), not a second
 *  hedge — `region` is the stamp's ANCHOR, not a clip box. */
function rotateGrid(g: MiniGrid, turns: QuarterTurn): MiniGrid {
  if (turns === 0) return g;
  const [nx, ny, nz] = g.dims;
  const dims: [number, number, number] =
    turns === 2 ? [nx, ny, nz] : [nz, ny, nx];
  const out = createGrid(dims, SOLID);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = gridAt(g, i, j, k);
        if (turns === 1) gridSet(out, k, j, nx - 1 - i, v);
        else if (turns === 2) gridSet(out, nx - 1 - i, j, nz - 1 - k, v);
        else gridSet(out, nz - 1 - k, j, i, v);
      }
  return out;
}

/** Open one doorway through the shell + validate its walk lane (the donor
 *  validateDoorApproach rule: the centre 2 of the 4 width cells ×
 *  DOOR_CLEARANCE_DEPTH_CELLS inward × full door height must be AIR —
 *  setup-loud, the W2 colonnade-on-the-door-axis lesson). `offset` is the
 *  door's lateral offset in COARSE CELLS along the wall (the donor doorAt
 *  contract); omitted = auto-centred on the wall.
 *
 *  The clamp to the wall span is an internal backstop only: both generators run
 *  {@link assertDoorOffsetFits} against the actual wall before calling in, so a
 *  caller-visible out-of-range offset throws rather than silently landing the
 *  door somewhere else. Callers pass offsets in their OWN unit — the hall's
 *  authored offsets are already coarse cells, the maze multiplies its maze-cell
 *  offsets by PITCH first (which is what keeps a door on a passage column). */
function openDoor(
  grid: MiniGrid,
  wall: Wall,
  label: string,
  offset?: number,
): void {
  const [nx, , nz] = grid.dims;
  const alongX = runsAlongX(wall);
  const interiorLen = (alongX ? nx : nz) - 2;
  const centred = Math.floor((interiorLen - DOOR_W_CELLS) / 2);
  const lo =
    1 + Math.max(0, Math.min(offset ?? centred, interiorLen - DOOR_W_CELLS));
  const shellIdx =
    wall === "north"
      ? nz - 1
      : wall === "south"
        ? 0
        : wall === "east"
          ? nx - 1
          : 0;
  for (let w = 0; w < DOOR_W_CELLS; w++)
    for (let j = 1; j <= DOOR_H_CELLS; j++) {
      if (alongX) gridSet(grid, lo + w, j, shellIdx, AIR);
      else gridSet(grid, shellIdx, j, lo + w, AIR);
    }
  // centre-lane validation: middle 2 lateral cells × clearance depth inward ×
  // door height (donor grid-stamp.ts validateDoorApproach, port-verified)
  const inwardSign = wall === "north" || wall === "east" ? -1 : 1;
  const firstInterior = shellIdx + inwardSign;
  for (let depth = 0; depth < DOOR_CLEARANCE_DEPTH_CELLS; depth++)
    for (let lat = lo + 1; lat < lo + 3; lat++)
      for (let j = 1; j <= DOOR_H_CELLS; j++) {
        const di = alongX ? lat : firstInterior + inwardSign * depth;
        const dk = alongX ? firstInterior + inwardSign * depth : lat;
        if (gridAt(grid, di, j, dk) !== AIR)
          throw new Error(
            `${label}: ${wall} door has a blocked walk lane (solid at cell ` +
              `${di},${j},${dk}) — move the door or adjust the interior`,
          );
      }
}

/** The door fields as they come off a zod-parsed hall/maze record — what
 *  {@link doorsOf} consumes; both generators' param tables satisfy it. */
type ParsedDoorParams = {
  [K in (typeof WALLS)[number]["enable"]]: boolean;
} & {
  [K in (typeof WALLS)[number]["offsetKey"]]?: number | undefined;
};

/** The enabled doorways with their resolved offsets, in {@link WALLS} order —
 *  the ONE door-authoring convention both generators assemble through.
 *
 *  EVERY wall's offset is schema-validated at parse, including walls whose
 *  door is switched off (they are ordinary schema fields), so a malformed
 *  offset on a disabled door can never slip into the persisted
 *  `GeneratorEntity.params` and detonate when that door is later toggled on.
 *  An ABSENT key parses to the {@link AUTO_CENTRE} sentinel (the schema
 *  default — the recorded-params allowance: pre-F3a entities carry none of
 *  these keys), so "key omitted" and "key set to -1" reach auto-centre through
 *  the same single branch and cannot drift apart. */
function doorsOf(p: ParsedDoorParams): DoorSpec[] {
  const doors: DoorSpec[] = [];
  for (const w of WALLS) {
    if (!p[w.enable]) continue;
    const raw = p[w.offsetKey];
    doors.push({
      wall: w.wall,
      offsetKey: w.offsetKey,
      offset: raw === undefined || raw === AUTO_CENTRE ? undefined : raw,
    });
  }
  return doors;
}

/** Setup-loud check that a door's offset fits the wall it sits on.
 *
 *  The schema's `maximum` is a static supremum over every admissible geometry,
 *  so the real bound — which depends on this stamp's width/depth or cell counts
 *  — can only be checked here. Throwing rather than clamping is deliberate:
 *  {@link openDoor} clamps internally, and a schema advertising a range that
 *  silently snaps the door somewhere else is a lie to the form user
 *  (`engine-conventions.md` §Failure policy — the cold path validates and
 *  throws). With this check in front of it, openDoor's clamp is an unreachable
 *  backstop.
 *
 *  @throws {@link Error} if `door.offset` is set and exceeds `maxOffset`. */
function assertDoorOffsetFits(
  label: string,
  door: DoorSpec,
  maxOffset: number,
  unit: string,
): void {
  if (door.offset === undefined) return; // auto-centre always fits
  if (door.offset > maxOffset)
    throw new Error(
      `${label}: ${door.offsetKey} ${door.offset} does not fit the ` +
        `${door.wall} wall — legal offsets are 0..${maxOffset} ${unit} ` +
        `(or ${AUTO_CENTRE} to auto-centre)`,
    );
}

/** The first kit class in the table — the stamp's masonry. Setup-loud when the
 *  catalog has none (stamps REQUIRE a kit class; the builtin rock-only table
 *  cannot stamp). */
function kitClassId(table: MaterialTable): number {
  const kit = table.classes.find((c) => c.kind === "kit");
  if (!kit)
    throw new Error(
      "stamp generators need a kit material class in the catalog",
    );
  return kit.id;
}

/** The hall's pillar vocabularies — ONE spelling feeding the schema enum and
 *  the narrowed param type (zod's enum check is the runtime guard). */
const PILLAR_KINDS = ["none", "grid", "colonnade"] as const;
type PillarKind = (typeof PILLAR_KINDS)[number];

/** The hall's narrowed, range-validated params. `doors` holds one
 *  {@link DoorSpec} per ENABLED wall — wall, offset param key, and resolved
 *  lateral offset in coarse cells (`undefined` = auto-centre) — in
 *  {@link WALLS} order. `rotation` is the stamp's quarter turn about +Y. */
type HallParams = {
  width: number;
  height: number;
  depth: number;
  pillars: PillarKind;
  pillarSpacing: number;
  rotation: QuarterTurn;
  doors: DoorSpec[];
};

/** The hall's door-offset param. `max(28)` is the supremum over every
 *  admissible hall: the longest wall an offset can sit on is `depth` (max 32),
 *  and a door needs DOOR_W_CELLS of it — 32 − 4 = 28. The bound for a GIVEN
 *  hall is tighter and is enforced by {@link assertDoorOffsetFits}.
 *  No `furnace.unit`: the range is coarse cells EXCEPT for the AUTO_CENTRE
 *  sentinel, so a "cells" suffix would be wrong on exactly the default. */
const hallOffset = () =>
  z
    .number()
    .min(AUTO_CENTRE)
    .max(28)
    .multipleOf(1, MUST_BE_INTEGER)
    .default(AUTO_CENTRE)
    .optional();

// The dimension params count COARSE CELLS (CELL = 0.5 m), which is why they
// carry `"cells"` and not `"m"`: a hall of width 8 is 4 m across, and a metre
// suffix on this row would be a false statement in the UI. Required params
// carry `.meta({ default })` (form metadata; a missing key still throws);
// the post-hoc optional ones carry `.default().optional()` — the
// optional-bucket rule above, spelled out in GeneratorDeclaration's TSDoc.
const HALL_PARAMS = {
  width: z
    .number()
    .min(4)
    .max(24)
    .multipleOf(1, MUST_BE_INTEGER)
    .meta({ default: 8, furnace: { unit: "cells" } satisfies FurnaceMeta }),
  height: z
    .number()
    .min(6)
    .max(12)
    .multipleOf(1, MUST_BE_INTEGER)
    .meta({ default: 6, furnace: { unit: "cells" } satisfies FurnaceMeta }),
  depth: z
    .number()
    .min(4)
    .max(32)
    .multipleOf(1, MUST_BE_INTEGER)
    .meta({ default: 8, furnace: { unit: "cells" } satisfies FurnaceMeta }),
  pillars: z.enum(PILLAR_KINDS).meta({ default: "none" }),
  pillarSpacing: z
    .number()
    .min(2)
    .max(8)
    .multipleOf(1, MUST_BE_INTEGER)
    .meta({ default: 3, furnace: { unit: "cells" } satisfies FurnaceMeta }),
  rotation: z.enum(ROTATIONS).default("0").optional(),
  doorNorth: z.boolean().meta({ default: true }),
  doorSouth: z.boolean().meta({ default: false }),
  doorEast: z.boolean().meta({ default: false }),
  doorWest: z.boolean().meta({ default: false }),
  doorNorthOffset: hallOffset(),
  doorSouthOffset: hallOffset(),
  doorEastOffset: hallOffset(),
  doorWestOffset: hallOffset(),
};

/** Assembles evaluate's working params from the zod-parsed record: doors
 *  resolve in {@link WALLS} order (AUTO_CENTRE → auto-centre; an absent key
 *  parses to the sentinel via the schema default), the rotation string maps to
 *  its quarter turn, and each enabled door's offset is checked against ITS
 *  wall — {@link assertDoorOffsetFits}, the cross-field rule the schema range
 *  (a static supremum) cannot express. */
function hallParams(p: z.output<z.ZodObject<typeof HALL_PARAMS>>): HallParams {
  const doors = doorsOf(p);
  // A hall offset counts COARSE CELLS along its wall, so the wall's interior
  // length bounds it: north/south run along width, east/west along depth.
  for (const door of doors) {
    const alongX = runsAlongX(door.wall);
    assertDoorOffsetFits(
      "hall",
      door,
      (alongX ? p.width : p.depth) - DOOR_W_CELLS,
      "coarse cells",
    );
  }
  return {
    width: p.width,
    height: p.height,
    depth: p.depth,
    pillars: p.pillars,
    pillarSpacing: p.pillarSpacing,
    rotation: QUARTER_TURNS[p.rotation ?? "0"],
    doors,
  };
}

/** Donor stampPillars port (themes/hall.ts, verbatim loops onto MiniGrid):
 *  `grid` = a pillar lattice every `spacing` cells across the interior;
 *  `colonnade` = twin rows flanking the central z-aisle. */
function stampPillars(g: MiniGrid, p: HallParams): void {
  if (p.pillars === "none") return;
  const { width: w, height: h, depth: d } = p;
  const s = Math.max(2, p.pillarSpacing);
  if (p.pillars === "grid") {
    for (let k = s; k <= d - 1; k += s)
      for (let i = s; i <= w - 1; i += s)
        for (let j = 1; j <= h; j++) gridSet(g, i, j, k, SOLID);
    return;
  }
  // colonnade: twin rows flanking the central z-aisle (the pillar-hall look).
  const centre = Math.floor(w / 2) + 1; // interior-centre i (1-based grid coords)
  const rows = [centre - 2, centre + 2];
  for (const i of rows)
    for (let k = s; k <= d - 1; k += s)
      for (let j = 1; j <= h; j++) gridSet(g, i, j, k, SOLID);
}

/** The hall generator: interior width×height×depth coarse cells inside a
 *  dims+2 masonry shell, optional pillar lattice (`grid` | `colonnade`), and
 *  one doorway per wall boolean — the donor hall.ts port. Evaluation is
 *  params-determined (the seed is reserved for skin variants).
 *
 *  Each doorway sits at `door<Wall>Offset` COARSE CELLS along its wall, or
 *  auto-centres at the `-1` sentinel (equivalently, an absent key). The stamp
 *  is then turned by `rotation` — a quarter turn about +Y applied AFTER the
 *  doors are carved and lane-validated, so the lane guarantee is rotation-
 *  invariant. Module-local: the registry is the one access path.
 *
 *  @throws {@link Error} if any param is missing, mistyped or out of its schema
 *    range; if a door offset does not fit its wall; if a door's walk lane is
 *    blocked (the donor validateDoorApproach rule); or if the catalog has no
 *    kit class. All setup-loud, before any op is emitted. */
const hallGenerator: GeneratorDef = defineGenerator({
  id: "hall",
  name: "Hall",
  params: HALL_PARAMS,
  contextFree: true, // params-determined; no field reads
  emits: "ops", // a pure carver — the masonry stamp, no placed instances
  usesSeed: false, // the ONE seedless generator — see the `void seed` below
  evaluate(params, seed, region, table, policy) {
    void seed; // hall structure is params-determined (donor contract)
    const p = hallParams(params); // doors + rotation + the cross-field check
    const dims: [number, number, number] = [
      p.width + 2,
      p.height + 2,
      p.depth + 2,
    ];
    const grid = createGrid(dims, SOLID);
    for (let k = 1; k <= p.depth; k++)
      for (let j = 1; j <= p.height; j++)
        for (let i = 1; i <= p.width; i++) gridSet(grid, i, j, k, AIR);
    stampPillars(grid, p);
    for (const door of p.doors) openDoor(grid, door.wall, "hall", door.offset);
    // Rotation LAST: doors are carved and lane-validated in the unrotated
    // frame, and rotateGrid is a bijection on cells, so a blocked lane can
    // never be laundered into a passing one by rotating.
    const finalGrid = rotateGrid(grid, p.rotation);
    const origin: [number, number, number] = [
      snapDown(region.min[0]),
      snapDown(region.min[1]),
      snapDown(region.min[2]),
    ];
    const ops = gridToOps(finalGrid, origin, kitClassId(table), policy);
    // lattice-snapped by construction; assert it stays true at the source
    for (const op of ops) assertOpValid(op, table);
    return { ops, placements: [] };
  },
});

// ——— the maze (donor: packages/dungeon/src/themes/maze.ts — W3) ———
// carvePlan and braidPass port VERBATIM: any change to the mixer changes every
// maze in existence. INTEGER-ONLY randomness (FNV-1a seed hash → Math.imul
// mixer) — no transcendentals. The RNG primitives (fnv1a + makeIntRng) moved
// to ./rng.ts (F3b Task 2) so the cave/scatter generators share them without a
// generators.ts import cycle.

/** Passage height in coarse cells — fixed at the door standard (3.0 m), not a
 *  knob (the donor MAZE_H_CELLS contract). */
const MAZE_H_CELLS = DOOR_H_CELLS;

/** Passage width/depth in coarse cells — the door width (2.0 m), so a door
 *  always opens onto a full-width passage column. Must stay
 *  `>= DOOR_CLEARANCE_DEPTH_CELLS`, or a door's centre approach lane reaches
 *  past its passage block into the wall band beyond and the openDoor lane
 *  check starts rejecting valid mazes (the donor coupling, equal today). */
const PASSAGE_CELLS = 4;
/** Maze-cell pitch in coarse cells (0.5 m each): one `PASSAGE_CELLS`-wide
 *  passage block plus the single internal wall band that separates it from the
 *  next block. A `cellsX × cellsZ` maze occupies `MAZE_PITCH_CELLS · cells + 1`
 *  coarse cells per horizontal axis (the passage blocks plus the outer shell),
 *  so the largest maze that fits an extent of `n` coarse cells on an axis has
 *  `floor((n − 1) / MAZE_PITCH_CELLS)` cells there — the inverse the editor's
 *  selection-fit size defaults read, keeping the footprint math single-sourced
 *  to this generator. */
export const MAZE_PITCH_CELLS = PASSAGE_CELLS + 1;
/** Terse internal alias of {@link MAZE_PITCH_CELLS} — keeps the VERBATIM donor
 *  carve loops (`1 + PITCH · a`) readable while the public name carries the
 *  contract. ONE source: the arithmetic lives only on the export. */
const PITCH = MAZE_PITCH_CELLS;

/** An open-edge key: `h:a,b` = wall between (a,b)-(a+1,b); `v:a,b` = (a,b)-(a,b+1). */
type EdgeKey = string;

/** The in-bounds edges around `cell`, paired with the neighbour they cross to. */
function edgesOf(
  cell: number,
  mx: number,
  mz: number,
): { edge: EdgeKey; next: number }[] {
  const a = cell % mx;
  const b = (cell - a) / mx;
  const out: { edge: EdgeKey; next: number }[] = [];
  if (a + 1 < mx) out.push({ edge: `h:${a},${b}`, next: cell + 1 });
  if (a - 1 >= 0) out.push({ edge: `h:${a - 1},${b}`, next: cell - 1 });
  if (b + 1 < mz) out.push({ edge: `v:${a},${b}`, next: cell + mx });
  if (b - 1 >= 0) out.push({ edge: `v:${a},${b - 1}`, next: cell - mx });
  return out;
}

/** The maze's open-edge plan: a growing-tree (backtracker) spanning maze, then
 *  the braid pass. Deterministic per (mx, mz, braid, seed). VERBATIM donor
 *  port. */
function carvePlan(
  mx: number,
  mz: number,
  braid: number,
  seed: string,
): Set<EdgeKey> {
  const rng = makeIntRng(fnv1a(seed));
  const cellCount = mx * mz;
  const visited = new Uint8Array(cellCount);
  const open = new Set<EdgeKey>();
  const first = rng() % cellCount;
  const stack: number[] = [first];
  visited[first] = 1;
  while (stack.length > 0) {
    // Index is proven in-bounds for a non-empty stack; noUncheckedIndexedAccess
    // widens the element to number|undefined, so narrow it back.
    const cur = stack[stack.length - 1] as number;
    const candidates = edgesOf(cur, mx, mz).filter(
      (e) => visited[e.next] !== 1,
    );
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    // Index is proven in-bounds (rng() % length on a non-empty array); the flag
    // widens the element, so narrow it back.
    const pick = candidates[rng() % candidates.length] as {
      edge: EdgeKey;
      next: number;
    };
    open.add(pick.edge);
    visited[pick.next] = 1;
    stack.push(pick.next);
  }
  braidPass(open, mx, mz, braid, rng);
  return open;
}

/** Open a wall from each ORIGINAL dead end with probability `braid`. The
 *  dead-end list is computed ONCE, before any opening, and scanned in
 *  cell-index order (z-major) — deterministic. Opening only ADDS edges (degree
 *  never drops), so at braid=1 zero dead ends remain (for the mx,mz >= 2
 *  footprints mazeParams admits) and no new ones can appear. The probability
 *  draw is an exact power-of-two division of the integer stream — no float
 *  noise; the divisor is 0x1000000, NOT 0xFFFFFF, so the draw is half-open
 *  [0, 1): that is precisely what makes braid=1 open EVERY dead end (a draw
 *  can never reach 1.0 and skip one).
 *
 *  The guard is `!(braid > 0)`, not `braid <= 0`: under a NaN braid every
 *  comparison is false, so `>= braid` would never skip and the maze would
 *  FULL-braid — `!(braid > 0)` fails safe to a perfect maze instead. That is a
 *  module-internal fail-safe, NOT the public contract: mazeParams REJECTS a
 *  non-finite braid setup-loud before this is ever reached. VERBATIM donor
 *  port. */
function braidPass(
  open: Set<EdgeKey>,
  mx: number,
  mz: number,
  braid: number,
  rng: () => number,
): void {
  if (!(braid > 0)) return;
  const cellCount = mx * mz;
  const isDeadEnd = (cell: number): boolean =>
    edgesOf(cell, mx, mz).filter((e) => open.has(e.edge)).length === 1;
  const originalDeadEnds: number[] = [];
  for (let cell = 0; cell < cellCount; cell++)
    if (isDeadEnd(cell)) originalDeadEnds.push(cell);
  for (const cell of originalDeadEnds) {
    if ((rng() >>> 8) / 0x1000000 >= braid) continue;
    const closed = edgesOf(cell, mx, mz).filter((e) => !open.has(e.edge));
    if (closed.length === 0) continue;
    // Index is proven in-bounds (rng() % length on a non-empty array); the flag
    // widens the element, so narrow it back.
    const pick = closed[rng() % closed.length] as { edge: EdgeKey };
    open.add(pick.edge);
  }
}

/** Carve one AIR block: `wCells × MAZE_H_CELLS × dCells` starting at coarse
 *  (i0, 1, k0) — the donor carveBlock loops onto MiniGrid. */
function carveBlock(
  g: MiniGrid,
  i0: number,
  k0: number,
  wCells: number,
  dCells: number,
): void {
  for (let k = k0; k < k0 + dCells; k++)
    for (let j = 1; j <= MAZE_H_CELLS; j++)
      for (let i = i0; i < i0 + wCells; i++) gridSet(g, i, j, k, AIR);
}

/** The maze's door-offset param. A maze offset counts MAZE CELLS, so the
 *  supremum is one less than the largest admissible cell count (8 − 1 = 7);
 *  {@link assertDoorOffsetFits} enforces the tighter per-maze bound. */
const mazeOffset = () =>
  z
    .number()
    .min(AUTO_CENTRE)
    .max(7)
    .multipleOf(1, MUST_BE_INTEGER)
    .default(AUTO_CENTRE)
    .optional();

const MAZE_PARAMS = {
  // The names already say the unit, so no `furnace.unit` — "Cells X 3 cells".
  cellsX: z
    .number()
    .min(2)
    .max(8)
    .multipleOf(1, MUST_BE_INTEGER)
    .meta({ default: 3 }),
  cellsZ: z
    .number()
    .min(2)
    .max(8)
    .multipleOf(1, MUST_BE_INTEGER)
    .meta({ default: 3 }),
  braid: z.number().min(0).max(1).meta({ default: 0.25 }),
  rotation: z.enum(ROTATIONS).default("0").optional(),
  doorNorth: z.boolean().meta({ default: true }),
  doorSouth: z.boolean().meta({ default: false }),
  doorEast: z.boolean().meta({ default: false }),
  doorWest: z.boolean().meta({ default: false }),
  doorNorthOffset: mazeOffset(),
  doorSouthOffset: mazeOffset(),
  doorEastOffset: mazeOffset(),
  doorWestOffset: mazeOffset(),
};

/** The maze's narrowed, range-validated params. `doors` holds one
 *  {@link DoorSpec} per ENABLED wall — wall, offset param key, and resolved
 *  lateral offset in MAZE CELLS (`undefined` = auto-centre) — in
 *  {@link WALLS} order. `rotation` is the stamp's quarter turn about +Y. */
type MazeParams = {
  cellsX: number;
  cellsZ: number;
  braid: number;
  rotation: QuarterTurn;
  doors: DoorSpec[];
};

/** Assembles evaluate's working params from the zod-parsed record — the
 *  {@link hallParams} pattern: doors via {@link doorsOf}, the rotation string
 *  mapped to its quarter turn, and each enabled door's offset checked against
 *  ITS wall's cell count (braid stays a REAL number in [0, 1] — no integer
 *  notch on the schema). */
function mazeParams(p: z.output<z.ZodObject<typeof MAZE_PARAMS>>): MazeParams {
  const doors = doorsOf(p);
  // A maze offset counts MAZE CELLS, so the wall's cell count bounds it:
  // north/south run along cellsX, east/west along cellsZ.
  for (const door of doors) {
    const alongCells = runsAlongX(door.wall) ? p.cellsX : p.cellsZ;
    assertDoorOffsetFits("maze", door, alongCells - 1, "maze cells");
  }
  return {
    cellsX: p.cellsX,
    cellsZ: p.cellsZ,
    braid: p.braid,
    rotation: QUARTER_TURNS[p.rotation ?? "0"],
    doors,
  };
}

/** The maze generator: a cellsX×cellsZ growing-tree spanning maze (seeded,
 *  integer-only donor RNG) with a probabilistic braid pass (dead ends opened
 *  into loops), 2.0 m passages, 0.5 m internal walls, 3.0 m passage height —
 *  the donor maze.ts port.
 *
 *  `door<Wall>Offset` counts MAZE CELLS, not coarse cells: the offset is
 *  multiplied by PITCH before reaching {@link openDoor}, which is what
 *  guarantees a door always opens onto a passage column and can never land on
 *  an internal wall band. The `-1` sentinel (equivalently, an absent key)
 *  auto-centres on maze cell floor(cells/2) — the DONOR's rule, which is not
 *  openDoor's coarse centring; the two coincide at odd cell counts and diverge
 *  at every even one, so this generator always passes an explicit offset. The
 *  stamp is then turned by `rotation` (a quarter turn about +Y, applied after
 *  the doors are carved and lane-validated).
 *
 *  Module-local: the registry is the one access path.
 *
 *  @throws {@link Error} if any param is missing, mistyped or out of its schema
 *    range; if a door offset does not fit its wall's cell count; if a door's
 *    walk lane is blocked; or if the catalog has no kit class. */
const mazeGenerator: GeneratorDef = defineGenerator({
  id: "maze",
  name: "Maze",
  params: MAZE_PARAMS,
  contextFree: true, // seeded-but-pure; no field reads
  emits: "ops", // a pure carver — the passage stamp, no placed instances
  usesSeed: true, // the carve plan is seeded (fnv1a(String(seed)))
  evaluate(params, seed, region, table, policy) {
    const p = mazeParams(params); // doors + rotation + the cross-field check
    const w = PITCH * p.cellsX - 1;
    const d = PITCH * p.cellsZ - 1;
    const dims: [number, number, number] = [w + 2, MAZE_H_CELLS + 2, d + 2];
    const grid = createGrid(dims, SOLID);
    // Passage blocks: maze cell (a,b) owns the PASSAGE_CELLS × MAZE_H_CELLS ×
    // PASSAGE_CELLS block whose floor-layer XZ corner is (1+PITCH·a, 1+PITCH·b).
    for (let b = 0; b < p.cellsZ; b++)
      for (let a = 0; a < p.cellsX; a++)
        carveBlock(
          grid,
          1 + PITCH * a,
          1 + PITCH * b,
          PASSAGE_CELLS,
          PASSAGE_CELLS,
        );
    // Open walls per the carve plan: a 1-cell band across the shared wall.
    // The GeneratorDef seed is a NUMBER; the donor hashes a seed STRING —
    // fnv1a(String(seed)) keeps donor bit-parity with the string spelling.
    for (const key of carvePlan(p.cellsX, p.cellsZ, p.braid, String(seed))) {
      const m = /^([hv]):(\d+),(\d+)$/.exec(key);
      if (!m) throw new Error(`maze: bad edge key ${key}`);
      const a = Number(m[2]);
      const b = Number(m[3]);
      if (m[1] === "h") {
        carveBlock(
          grid,
          1 + PITCH * a + PASSAGE_CELLS,
          1 + PITCH * b,
          1,
          PASSAGE_CELLS,
        );
      } else {
        carveBlock(
          grid,
          1 + PITCH * a,
          1 + PITCH * b + PASSAGE_CELLS,
          PASSAGE_CELLS,
          1,
        );
      }
    }
    for (const door of p.doors) {
      const alongCells = runsAlongX(door.wall) ? p.cellsX : p.cellsZ;
      // The offset is in MAZE CELLS; PITCH maps it to the coarse cell openDoor
      // wants, which is what guarantees a door always lands on a passage
      // column and never on an internal wall band. Auto-centre is the maze's
      // OWN centring (maze cell floor(cells/2)), not openDoor's coarse
      // centring — the two differ, and this is the donor's rule.
      const cell = door.offset ?? Math.floor(alongCells / 2);
      openDoor(grid, door.wall, "maze", PITCH * cell);
    }
    // Rotation LAST — see the hall's note and the rotateGrid TSDoc.
    const finalGrid = rotateGrid(grid, p.rotation);
    const origin: [number, number, number] = [
      snapDown(region.min[0]),
      snapDown(region.min[1]),
      snapDown(region.min[2]),
    ];
    const ops = gridToOps(finalGrid, origin, kitClassId(table), policy);
    // lattice-snapped by construction; assert it stays true at the source
    for (const op of ops) assertOpValid(op, table);
    return { ops, placements: [] };
  },
});

/** The staged-generator registry — the one plug point (a new vocabulary = one
 *  entry here; nothing downstream dispatches on generator identity). */
export const FIELD_GENERATORS: readonly GeneratorDef[] = [
  hallGenerator,
  mazeGenerator,
  caveGenerator,
  scatterGenerator,
];

/** Registry lookup, setup-loud on unknown ids — **the message NAMES the registered ids**,
 *  because the one caller that cannot see this array is an agent over the editor's MCP door
 *  (`generate` refuses through here) and a bare "unknown" leaves it guessing. */
export function generatorById(id: string): GeneratorDef {
  const def = FIELD_GENERATORS.find((g) => g.id === id);
  if (!def)
    throw new Error(
      `unknown field generator "${id}" — registered: ${FIELD_GENERATORS.map((g) => g.id).join(", ")}`,
    );
  return def;
}

/** Calls a generator's `evaluate`, enforcing BOTH declarative facts a
 *  {@link GeneratorDef} carries — the ONE GUARDED call site, shared by
 *  {@link commitGenerator} and `reconfigureGenerator`, so neither path can drift
 *  from the other. A direct `def.evaluate` call (the editor's stamp preview,
 *  tests) bypasses it, and therefore both facts below:
 *
 *  - `contextFree` (what evaluate READS) — a context-reading def
 *    (`contextFree === false`) MUST be given a `ctx`, or it is a caller bug. A
 *    context-free def ignores any `ctx` passed.
 *  - `emits` (what evaluate RETURNS) — the result must not carry a channel the
 *    declaration forbids. Checked AFTER evaluate, on the result in hand: two
 *    array-length reads, no traversal.
 *
 *  Both are programming errors at authoring time, so both are setup-loud.
 *
 *  @throws {@link Error} if `def.contextFree === false` and `ctx` is undefined;
 *    or if the evaluated result contradicts `def.emits` — placements from an
 *    `emits: "ops"` def, ops from an `emits: "placements"` one. */
export function evaluateGenerator(
  def: GeneratorDef,
  params: Record<string, unknown>,
  seed: number,
  region: { min: [number, number, number]; max: [number, number, number] },
  table: MaterialTable,
  policy: MergePolicy,
  ctx: EvaluateContext | undefined,
): GeneratorResult {
  if (def.contextFree === false && ctx === undefined)
    throw new Error(
      `generator "${def.id}": contextFree is false but evaluate was called without an EvaluateContext`,
    );
  const result = def.evaluate(params, seed, region, table, policy, ctx);
  if (result.placements.length > 0 && def.emits === "ops")
    throw new Error(
      `generator "${def.id}": declares emits:"ops" but returned ${result.placements.length} placement(s) — fix evaluate, or declare emits:"both" if it legitimately does both`,
    );
  if (result.ops.length > 0 && def.emits === "placements")
    throw new Error(
      `generator "${def.id}": declares emits:"placements" but returned ${result.ops.length} op(s) — fix evaluate, or declare emits:"both" if it legitimately does both`,
    );
  return result;
}

/** Applies a generator's evaluated result to the store and records the log's
 *  first entity-op class: span ops (field ops + an optional placement op) + ONE
 *  `entity/place` op, all under ONE undo
 *  entry (⌘Z removes the whole commit — charter §2.3). The WHOLE evaluated
 *  span re-validates through {@link assertOpValid} (the applier-side check)
 *  BEFORE the first write — validate-all-then-apply, so a bad op leaves the
 *  store, the log, and the id counter untouched (the setup-loud-before-
 *  mutation posture; a single pass would strand earlier ops applied but
 *  unlogged). What that does NOT buy is a transaction, and the residue is
 *  {@link logApplyGroup}'s exactly: all-or-nothing covers VALIDATION only.
 *  `assertOpValid` checks that a shape's numbers are finite and its lengths
 *  positive, never that a length is BUILDABLE, so a def emitting a
 *  finite-but-absurd radius clears pass 1 and dies in the applier — leaving the
 *  span ops before it written into the store with no entry describing them.
 *  Ids survive that (they commit only once pass 2 finishes); the store is not
 *  rolled back. Per-chunk inverse merge is FIRST-wins: each chunk's first
 *  snapshot is its PRE-COMMIT state, so undo restores the field exactly.
 *  Returns the commit's dirty chunk set and a COPY of the recorded
 *  {@link GeneratorEntity} — whose `entityId` intentionally equals the entity
 *  op's log id (the same log.nextId slot). The copy is deliberate and matches
 *  {@link reconfigureGenerator}: mutating the returned record cannot rewrite
 *  the log, so provenance only ever changes through a verb that logs an undo
 *  entry. The entity's `params`/`region` are
 *  CLONED (deep): the log owns its copy of the record, so a caller reusing a
 *  live object across commits can never rewrite it. Commit RE-EVALUATES the
 *  generator; it relies on evaluate's determinism (pure, same-input-twice —
 *  the charter §2.2 contract) to reproduce a previewed span exactly.
 *
 *  `opts.origin` is who is authoring the commit — the ACTOR OF THIS CALL, never
 *  an inherited author ({@link BrushOp.origin}). ONE commit has one author, so
 *  the single value stamps every op the commit AUTHORS — the evaluated field
 *  ops, the placement op that rides the span, and the `entity/place` op that
 *  records the recipe — plus the undo entry ({@link LogEntry}.origin). Omit it
 *  for the human's own work: absent = human, and nothing gains the property, so
 *  a human commit stays byte-identical to its pre-v4 form. An `origin` already
 *  sitting on an EVALUATED op is overwritten: a generator does not author its
 *  own output, the caller that commits it does.
 *
 *  @throws {@link Error} if the generator's own param validation rejects
 *    `opts.params`, the evaluated result contradicts the def's
 *    {@link GeneratorDef.emits} declaration, the evaluated result is EMPTY (no
 *    ops AND no placements — a generator must emit something), or any evaluated
 *    op/placement fails
 *    {@link assertOpValid}/{@link assertPatchValid}/{@link assertPlacementsValid}
 *    — that last class re-thrown as `commitGenerator: generator "<id>" — <the
 *    predicate's own message>` with the original on `cause`, because a span
 *    nobody wrote is addressed by its GENERATOR, not by a position inside it;
 *    a `DataCloneError` if `opts.params`/`opts.region` hold structured-clone-
 *    incompatible values (e.g. a function in an unknown key) — in all cases
 *    before any mutation. */
export function commitGenerator(
  store: FieldStore,
  log: OpLog,
  def: GeneratorDef,
  opts: {
    params: Record<string, unknown>;
    seed: number;
    region: { min: [number, number, number]; max: [number, number, number] };
    policy: MergePolicy;
    table: MaterialTable;
    origin?: string;
  },
): { dirty: Set<ChunkKey>; entity: GeneratorEntity } {
  const origin = opts.origin;
  const ctx: EvaluateContext | undefined =
    def.contextFree === false ? { store } : undefined;
  const { ops, placements } = evaluateGenerator(
    def,
    opts.params,
    opts.seed,
    opts.region,
    opts.table,
    opts.policy,
    ctx,
  );
  if (ops.length + placements.length === 0)
    throw new Error(
      `commitGenerator: generator "${def.id}" evaluated to an empty result (no ops, no placements)`,
    );
  // Provenance clones run BEFORE any store write: the log owns its copy of the
  // record (a caller mutating a reused params/region object must never rewrite
  // it), and a non-cloneable value (unknown keys survive param validation) must
  // throw HERE — cloning after pass 2 would strand a mutated store with no
  // undo entry.
  const params = structuredClone(opts.params);
  const region = structuredClone(opts.region);
  // Pass 1 — stamp real ids and validate the WHOLE span before any write, under
  // the DEF's address. Deliberately not an index the way `logApplyGroup` names
  // one: nobody wrote this span, so "op 37 of 55" addresses nothing a reader can
  // open — the generator is the thing to fix, and its id is the same locator the
  // empty-result rejection above already uses.
  const firstId = log.nextId;
  let nextId = firstId;
  const span: FieldOp[] = [];
  try {
    for (const op of ops) {
      // Conditional, never `origin: undefined`: an explicit undefined is an OWN
      // property (`Object.hasOwn`), which would change what serializeOps writes.
      const s =
        origin === undefined
          ? { ...op, id: nextId++ }
          : { ...op, id: nextId++, origin };
      if (s.kind === "patch") assertPatchValid(s, opts.table);
      else assertOpValid(s, opts.table);
      span.push(s);
    }
    // Placements ride the span as ONE placement op appended AFTER the field ops,
    // still inside opSpan — validated setup-loud like every other span member.
    if (placements.length > 0) {
      assertPlacementsValid(placements);
      const bare = {
        id: nextId++,
        kind: "placement" as const,
        records: placements,
      };
      const placementOp: PlacementOp =
        origin === undefined ? bare : { ...bare, origin };
      span.push(placementOp);
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`commitGenerator: generator "${def.id}" — ${detail}`, {
      cause: e,
    });
  }
  // Pass 2 — apply; merge per-chunk inverses FIRST-wins (pre-commit state). A
  // placement op writes no cells (applyFieldOp returns null), so it contributes
  // nothing to dirty/inverse but stays in the log's span.
  const dirty = new Set<ChunkKey>();
  const inverse: OpInverse = new Map();
  for (const s of span) {
    const r = applyFieldOp(store, s, opts.table);
    if (r === null) continue;
    for (const k of r.dirty) dirty.add(k);
    for (const [k, pre] of r.inverse) if (!inverse.has(k)) inverse.set(k, pre);
  }
  const entity: GeneratorEntity = {
    entityId: nextId,
    type: "generator",
    generator: def.id,
    params,
    seed: opts.seed,
    region,
    opSpan: [firstId, nextId - 1],
  };
  const bareEntityOp = {
    id: nextId++,
    kind: "entity" as const,
    action: "place" as const,
    entity,
  };
  const entityOp: EntityOp =
    origin === undefined ? bareEntityOp : { ...bareEntityOp, origin };
  log.nextId = nextId;
  const stamped: FieldOp[] = [...span, entityOp];
  // Loop push, not arguments-spread: fn(...arr) hits JS-engine argument-count
  // ceilings (~65k in JSC) on mega commit spans.
  for (const op of stamped) log.ops.push(op);
  log.undoStack.push(
    origin === undefined
      ? { kind: "ops", ops: stamped, inverse }
      : { kind: "ops", ops: stamped, inverse, origin },
  );
  log.redoStack.length = 0;
  // A COPY, matching reconfigureGenerator: handing back the live record makes a
  // caller that edits it (an inspector binding straight to the returned object)
  // rewrite history with no undo entry and no dirty set.
  return { dirty, entity: structuredClone(entity) };
}
