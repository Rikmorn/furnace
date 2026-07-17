// packages/core/src/field/generators.ts — staged stamp generators (F2b).
// The hall is ported from the dungeon donors (themes/hall.ts + the shared
// doorAt/validateDoorApproach machinery in themes/grid-stamp.ts — W3) onto a
// core-local mini coarse grid; evaluate() compiles the grid into a span of
// lattice-snapped brush ops. The registry is the ONE plug point (resolves the
// third-grid-vocabulary dispatch tax); the maze joins in Task 6.
import { assertOpValid } from "./ops.ts";
import type {
  BrushOp,
  GeneratorDef,
  MaterialTable,
  MergePolicy,
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

/** Open one doorway through the shell + validate its walk lane (the donor
 *  validateDoorApproach rule: the centre 2 of the 4 width cells ×
 *  DOOR_CLEARANCE_DEPTH_CELLS inward × full door height must be AIR —
 *  setup-loud, the W2 colonnade-on-the-door-axis lesson). `offset` is the
 *  door's lateral offset in coarse cells along the wall, clamped to the wall
 *  span (the donor doorAt contract); omitted = auto-centred. The hall always
 *  centres; the maze's passage-column doors (Task 6) pass explicit offsets —
 *  full GridDoor offset AUTHORING returns in F3. */
function openDoor(
  grid: MiniGrid,
  wall: Wall,
  label: string,
  offset?: number,
): void {
  const [nx, , nz] = grid.dims;
  const alongX = wall === "north" || wall === "south";
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

/** The hall's pillar vocabularies — ONE spelling feeding the schema enum, the
 *  narrowed param type, and the runtime check (no drift between the three). */
const PILLAR_KINDS = ["none", "grid", "colonnade"] as const;
type PillarKind = (typeof PILLAR_KINDS)[number];
const isPillarKind = (v: unknown): v is PillarKind =>
  PILLAR_KINDS.some((k) => k === v);

/** The hall's narrowed, range-validated params. `doors` is the resolved wall
 *  list from the four per-wall booleans. */
type HallParams = {
  width: number;
  height: number;
  depth: number;
  pillars: PillarKind;
  pillarSpacing: number;
  doors: Wall[];
};

const HALL_SCHEMA = {
  type: "object",
  properties: {
    width: { type: "number", minimum: 4, maximum: 24, default: 8 },
    height: { type: "number", minimum: 6, maximum: 12, default: 6 },
    depth: { type: "number", minimum: 4, maximum: 32, default: 8 },
    pillars: { enum: PILLAR_KINDS, default: "none" },
    pillarSpacing: { type: "number", minimum: 2, maximum: 8, default: 3 },
    doorNorth: { type: "boolean", default: true },
    doorSouth: { type: "boolean", default: false },
    doorEast: { type: "boolean", default: false },
    doorWest: { type: "boolean", default: false },
  },
} as const;

/** The schema's per-property defaults, DERIVED (never restated) — the one
 *  source both the session seed (defaults) and the rendered form (paramSchema)
 *  agree on. */
const HALL_DEFAULTS: Record<string, unknown> = Object.fromEntries(
  Object.entries(HALL_SCHEMA.properties).map(([k, p]) => [k, p.default]),
);

/** Integer param in the schema property's [minimum, maximum] — setup-loud.
 *  `label` names the generator in the error ("hall" / "maze"). */
function intParam(
  label: string,
  params: Record<string, unknown>,
  key: string,
  range: { minimum: number; maximum: number },
): number {
  const v = params[key];
  if (
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    v < range.minimum ||
    v > range.maximum
  )
    throw new Error(
      `${label}: ${key} must be an integer in [${range.minimum}, ${range.maximum}], got ${JSON.stringify(v)}`,
    );
  return v;
}

/** Boolean param — setup-loud. `label` names the generator in the error. */
function boolParam(
  label: string,
  params: Record<string, unknown>,
  key: string,
): boolean {
  const v = params[key];
  if (typeof v !== "boolean")
    throw new Error(
      `${label}: ${key} must be a boolean, got ${JSON.stringify(v)}`,
    );
  return v;
}

/** Narrows + range-validates hall params (ranges from HALL_SCHEMA), throwing
 *  setup-loud on a missing, mistyped, or out-of-range field. */
function hallParams(params: Record<string, unknown>): HallParams {
  const p = HALL_SCHEMA.properties;
  const pillars = params["pillars"];
  if (!isPillarKind(pillars))
    throw new Error(
      `hall: pillars must be one of ${PILLAR_KINDS.map((k) => `"${k}"`).join(" | ")}, got ${JSON.stringify(pillars)}`,
    );
  const doors: Wall[] = [];
  if (boolParam("hall", params, "doorNorth")) doors.push("north");
  if (boolParam("hall", params, "doorSouth")) doors.push("south");
  if (boolParam("hall", params, "doorEast")) doors.push("east");
  if (boolParam("hall", params, "doorWest")) doors.push("west");
  return {
    width: intParam("hall", params, "width", p.width),
    height: intParam("hall", params, "height", p.height),
    depth: intParam("hall", params, "depth", p.depth),
    pillars,
    pillarSpacing: intParam("hall", params, "pillarSpacing", p.pillarSpacing),
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

/** The hall generator: interior width×height×depth coarse cells inside a
 *  dims+2 masonry shell, optional pillar lattice (`grid` | `colonnade`), and
 *  auto-centred doorways per wall boolean — the donor hall.ts port. Evaluation
 *  is params-determined (the seed is reserved for skin variants); a blocked
 *  door walk lane throws setup-loud. Module-local: the registry is the one
 *  access path. */
const hallGenerator: GeneratorDef = {
  id: "hall",
  name: "Hall",
  paramSchema: HALL_SCHEMA,
  defaults: HALL_DEFAULTS,
  evaluate(params, seed, region, table, policy) {
    void seed; // hall structure is params-determined (donor contract)
    const p = hallParams(params); // narrow + range-validate, setup-loud
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
    for (const wall of p.doors) openDoor(grid, wall, "hall");
    const origin: [number, number, number] = [
      snapDown(region.min[0]),
      snapDown(region.min[1]),
      snapDown(region.min[2]),
    ];
    const ops = gridToOps(grid, origin, kitClassId(table), policy);
    // lattice-snapped by construction; assert it stays true at the source
    for (const op of ops) assertOpValid(op, table);
    return ops;
  },
};

/** The staged-generator registry — the one plug point (a new vocabulary = one
 *  entry here; nothing downstream dispatches on generator identity). */
export const FIELD_GENERATORS: readonly GeneratorDef[] = [hallGenerator];

/** Registry lookup, setup-loud on unknown ids. */
export function generatorById(id: string): GeneratorDef {
  const def = FIELD_GENERATORS.find((g) => g.id === id);
  if (!def) throw new Error(`unknown field generator "${id}"`);
  return def;
}
