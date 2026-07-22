// packages/core/src/field/generators.ts — staged stamp generators (F2b).
// The hall and the maze are ported from the dungeon donors (themes/hall.ts,
// themes/maze.ts + the shared doorAt/validateDoorApproach machinery in
// themes/grid-stamp.ts — W3) onto a core-local mini coarse grid; evaluate()
// compiles the grid into a span of lattice-snapped brush ops. The registry is
// the ONE plug point (resolves the third-grid-vocabulary dispatch tax), and
// commitGenerator owns the entity semantics: one commit = one undo entry.
import { applyOp, assertOpValid } from "./ops.ts";
import type {
  BrushOp,
  ChunkKey,
  EntityOp,
  FieldOp,
  FieldStore,
  GeneratorDef,
  GeneratorEntity,
  MaterialTable,
  MergePolicy,
  OpInverse,
  OpLog,
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

/** Finite number param in the schema property's [minimum, maximum] —
 *  setup-loud; unlike {@link intParam} it admits fractional values (the
 *  maze's braid is a real-valued probability, NOT an integer). */
function numParam(
  label: string,
  params: Record<string, unknown>,
  key: string,
  range: { minimum: number; maximum: number },
): number {
  const v = params[key];
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < range.minimum ||
    v > range.maximum
  )
    throw new Error(
      `${label}: ${key} must be a number in [${range.minimum}, ${range.maximum}], got ${JSON.stringify(v)}`,
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

// ——— the maze (donor: packages/dungeon/src/themes/maze.ts — W3) ———
// The RNG (fnv1a + makeIntRng), carvePlan, and braidPass port VERBATIM: any
// change to the mixer changes every maze in existence. INTEGER-ONLY
// randomness (FNV-1a seed hash → Math.imul mixer) — no transcendentals.

/** Passage height in coarse cells — fixed at the door standard (3.0 m), not a
 *  knob (the donor MAZE_H_CELLS contract). */
const MAZE_H_CELLS = DOOR_H_CELLS;

/** Passage width/depth in coarse cells — the door width (2.0 m), so a door
 *  always opens onto a full-width passage column. Must stay
 *  `>= DOOR_CLEARANCE_DEPTH_CELLS`, or a door's centre approach lane reaches
 *  past its passage block into the wall band beyond and the openDoor lane
 *  check starts rejecting valid mazes (the donor coupling, equal today). */
const PASSAGE_CELLS = 4;
/** Maze-cell pitch in coarse cells: a `PASSAGE_CELLS` passage block plus the
 *  1-cell (0.5 m) internal wall band that separates it from the next block. */
const PITCH = PASSAGE_CELLS + 1;

/** FNV-1a 32-bit over the seed string (the donor pieces.ts variant-hash
 *  pattern) — VERBATIM donor port. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32-shape uint32 stream: Math.imul + shifts only. Every operation is
 *  integer (spec-exact in JS on every engine) — the Pr-2-safe RNG for grid
 *  content. VERBATIM donor port. */
function makeIntRng(seedWord: number): () => number {
  let state = seedWord >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

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

const MAZE_SCHEMA = {
  type: "object",
  properties: {
    cellsX: { type: "number", minimum: 2, maximum: 8, default: 3 },
    cellsZ: { type: "number", minimum: 2, maximum: 8, default: 3 },
    braid: { type: "number", minimum: 0, maximum: 1, default: 0.25 },
    doorNorth: { type: "boolean", default: true },
    doorSouth: { type: "boolean", default: false },
    doorEast: { type: "boolean", default: false },
    doorWest: { type: "boolean", default: false },
  },
} as const;

/** The schema's per-property defaults, DERIVED (never restated) — the
 *  HALL_DEFAULTS pattern. */
const MAZE_DEFAULTS: Record<string, unknown> = Object.fromEntries(
  Object.entries(MAZE_SCHEMA.properties).map(([k, p]) => [k, p.default]),
);

/** The maze's narrowed, range-validated params. `doors` is the resolved wall
 *  list from the four per-wall booleans. */
type MazeParams = {
  cellsX: number;
  cellsZ: number;
  braid: number;
  doors: Wall[];
};

/** Narrows + range-validates maze params (ranges from MAZE_SCHEMA), throwing
 *  setup-loud on a missing, mistyped, or out-of-range field. Braid is a REAL
 *  number in [0, 1] (numParam); the cell counts are integers. */
function mazeParams(params: Record<string, unknown>): MazeParams {
  const p = MAZE_SCHEMA.properties;
  const doors: Wall[] = [];
  if (boolParam("maze", params, "doorNorth")) doors.push("north");
  if (boolParam("maze", params, "doorSouth")) doors.push("south");
  if (boolParam("maze", params, "doorEast")) doors.push("east");
  if (boolParam("maze", params, "doorWest")) doors.push("west");
  return {
    cellsX: intParam("maze", params, "cellsX", p.cellsX),
    cellsZ: intParam("maze", params, "cellsZ", p.cellsZ),
    braid: numParam("maze", params, "braid", p.braid),
    doors,
  };
}

/** The maze generator: a cellsX×cellsZ growing-tree spanning maze (seeded,
 *  integer-only donor RNG) with a probabilistic braid pass (dead ends opened
 *  into loops), 2.0 m passages, 0.5 m internal walls, 3.0 m passage height —
 *  the donor maze.ts port. Doors auto-centre on the passage column at
 *  maze-cell floor(cells/2) — coarse offset PITCH·cell, so a door can never
 *  land on an internal wall band (offset AUTHORING returns in F3).
 *  Module-local: the registry is the one access path. */
const mazeGenerator: GeneratorDef = {
  id: "maze",
  name: "Maze",
  paramSchema: MAZE_SCHEMA,
  defaults: MAZE_DEFAULTS,
  evaluate(params, seed, region, table, policy) {
    const p = mazeParams(params); // narrow + range-validate, setup-loud
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
    for (const wall of p.doors) {
      const alongCells =
        wall === "north" || wall === "south" ? p.cellsX : p.cellsZ;
      openDoor(grid, wall, "maze", PITCH * Math.floor(alongCells / 2));
    }
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
export const FIELD_GENERATORS: readonly GeneratorDef[] = [
  hallGenerator,
  mazeGenerator,
];

/** Registry lookup, setup-loud on unknown ids. */
export function generatorById(id: string): GeneratorDef {
  const def = FIELD_GENERATORS.find((g) => g.id === id);
  if (!def) throw new Error(`unknown field generator "${id}"`);
  return def;
}

/** Applies a generator's evaluated span to the store and records the log's
 *  first entity-op class: span ops + ONE `entity/place` op, all under ONE undo
 *  entry (⌘Z removes the whole commit — charter §2.3). The WHOLE evaluated
 *  span re-validates through {@link assertOpValid} (the applier-side check)
 *  BEFORE the first write — validate-all-then-apply, so a bad op leaves the
 *  store, the log, and the id counter untouched (the setup-loud-before-
 *  mutation posture; a single pass would strand earlier ops applied but
 *  unlogged). Per-chunk inverse merge is FIRST-wins: each chunk's first
 *  snapshot is its PRE-COMMIT state, so undo restores the field exactly.
 *  Returns the commit's dirty chunk set and a COPY of the recorded
 *  {@link GeneratorEntity} — whose `entityId` intentionally equals the entity
 *  op's log id (the same log.nextId slot). The copy is deliberate and matches
 *  {@link reconfigureGenerator}: mutating the returned record cannot rewrite the
 *  log, so provenance only ever changes through a verb that logs an undo entry. The entity's `params`/`region` are
 *  CLONED (deep): the log owns its copy of the record, so a caller reusing a
 *  live object across commits can never rewrite it. Commit RE-EVALUATES the
 *  generator; it relies on evaluate's determinism (pure, same-input-twice —
 *  the charter §2.2 contract) to reproduce a previewed span exactly.
 *
 *  @throws {@link Error} if the generator's own param validation rejects
 *    `opts.params`, the evaluated span is EMPTY (a generator must emit at
 *    least one op), or any evaluated op fails {@link assertOpValid}; a
 *    `DataCloneError` if `opts.params`/`opts.region` hold structured-clone-
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
  },
): { dirty: Set<ChunkKey>; entity: GeneratorEntity } {
  const evaluated = def.evaluate(
    opts.params,
    opts.seed,
    opts.region,
    opts.table,
    opts.policy,
  );
  if (evaluated.length === 0)
    throw new Error(
      `commitGenerator: generator "${def.id}" evaluated to an empty op span`,
    );
  // Provenance clones run BEFORE any store write: the log owns its copy of the
  // record (a caller mutating a reused params/region object must never rewrite
  // it), and a non-cloneable value (unknown keys survive param validation) must
  // throw HERE — cloning after pass 2 would strand a mutated store with no
  // undo entry.
  const params = structuredClone(opts.params);
  const region = structuredClone(opts.region);
  // Pass 1 — stamp real ids and validate the WHOLE span before any write.
  const firstId = log.nextId;
  let nextId = firstId;
  const span: BrushOp[] = [];
  for (const op of evaluated) {
    const s: BrushOp = { ...op, id: nextId++ };
    assertOpValid(s, opts.table);
    span.push(s);
  }
  // Pass 2 — apply; merge per-chunk inverses FIRST-wins (pre-commit state).
  const dirty = new Set<ChunkKey>();
  const inverse: OpInverse = new Map();
  for (const s of span) {
    const r = applyOp(store, s, opts.table);
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
  const entityOp: EntityOp = {
    id: nextId++,
    kind: "entity",
    action: "place",
    entity,
  };
  log.nextId = nextId;
  const stamped: FieldOp[] = [...span, entityOp];
  // Loop push, not arguments-spread: fn(...arr) hits JS-engine argument-count
  // ceilings (~65k in JSC) on mega commit spans.
  for (const op of stamped) log.ops.push(op);
  log.undoStack.push({ kind: "ops", ops: stamped, inverse });
  log.redoStack.length = 0;
  // A COPY, matching reconfigureGenerator: handing back the live record makes a
  // caller that edits it (an inspector binding straight to the returned object)
  // rewrite history with no undo entry and no dirty set.
  return { dirty, entity: structuredClone(entity) };
}
