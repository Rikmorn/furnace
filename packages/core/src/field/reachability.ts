// Stage 2 of the walkability advisor (D-F4-8, D-F4-18): the CONNECTIVITY passes.
// Where `analyze.ts` asks per-cell questions about one column, these two ask a
// graph question about the whole world — can the agent get THERE, and can it get
// BACK. Both read the shared substrate in `solidity.ts`, so "standable column"
// and "climbable" mean exactly what the column pass means by them.
import { warn } from "../log/internal.ts";
import { worldToVoxel } from "./chunks.ts";
import {
  type AnalyzeOptions,
  ceilingAbove,
  cellKey,
  chunkOf,
  climbCellsFor,
  DIRS,
  floorSurfaceWorld,
  isFloorAnchor,
  isSolid,
  type SolidView,
  validatedView,
} from "./solidity.ts";
import type { AgentProfile, ChunkKey, FieldFlag, FieldStore } from "./types.ts";

/** The floor surface a seed STANDS on: its own cell if that is already a floor
 *  anchor, else the first one straight down — the mover falls, so descending is
 *  the only honest snap. A seed inside rock has no such surface and is refused.
 *
 *  The descent terminates on the data, like {@link ceilingAbove}: unallocated
 *  space reads SOLID, so a column falling out of the allocated region stops at
 *  its edge. */
function seedAnchor(
  v: SolidView,
  cellSize: number,
  seed: readonly [number, number, number],
): [number, number, number] | undefined {
  const x = worldToVoxel(seed[0], cellSize);
  const z = worldToVoxel(seed[2], cellSize);
  let y = worldToVoxel(seed[1], cellSize);
  if (isSolid(v, x, y, z)) return undefined;
  while (!isSolid(v, x, y - 1, z)) y--;
  return [x, y, z];
}

/** One node of both connectivity passes: a floor-anchor cell.
 *
 *  Nodes are {@link isFloorAnchor} cells — the SAME walkable notion the column
 *  pass anchors on, minus its headroom test. Dropping the headroom test is
 *  deliberate for {@link markUnreachable}: requiring clearance would cut the
 *  flood at every crawlspace and demote everything beyond it, whereas
 *  over-connecting only ever demotes LESS, and for a demote-only pass less is
 *  the miss-safe direction. {@link detectPits} inherits the same node set so the
 *  two passes cannot disagree about what a standable column is — but note the
 *  posture does NOT carry over as cleanly there (see its own remarks). */
type Column = [number, number, number];

/** Receives one neighbour column during an expansion. */
type VisitColumn = (x: number, y: number, z: number) => void;

/** An edge rule, as a function: offers a column's neighbours to `visit`.
 *
 *  The graph is deliberately NEVER materialized. Storing it — and a directed
 *  pass needs the TRANSPOSE too, which is the expensive half — would cost an
 *  edge list of up to `4 * (2 * climbCells + 2)` entries per node over a node
 *  set measured at ~1.1k columns on the F3b default cave and ~16.8k on the
 *  largest committed world (2026-07-26), and every pass here visits each node
 *  exactly once anyway. Re-enumerating per pass buys that memory back for one
 *  extra neighbourhood scan per node per pass, which the budget test prices. */
type Expand = (x: number, y: number, z: number, visit: VisitColumn) => void;

/** The CLIMB band, the one edge rule every pass here shares: floor anchors in
 *  the 4 XZ-adjacent columns within `climbCells` of (x,y,z). SYMMETRIC by
 *  construction — |Δy| ≤ climbCells reads the same from either end — so one
 *  enumeration serves the undirected flood and BOTH directions of the directed
 *  one. Steps are 4-connected, so a purely DIAGONAL step is not an edge. */
function climbNeighbours(
  v: SolidView,
  climbCells: number,
  x: number,
  y: number,
  z: number,
  visit: VisitColumn,
): void {
  for (const [dx, dz] of DIRS) {
    const nx = x + dx;
    const nz = z + dz;
    for (let ny = y - climbCells; ny <= y + climbCells; ny++)
      if (isFloorAnchor(v, nx, ny, nz)) visit(nx, ny, nz);
  }
}

/** Where walking off the edge LANDS (D-F4-18), per direction: the floor of the
 *  air pocket the neighbour column holds at OUR level, offered only when it
 *  sits more than `climbCells` below — a shallower drop is already a climb-band
 *  edge, and this one is DIRECTED (you fall in; you do not climb back out).
 *
 *  Rock at the neighbour's own level yields nothing: that is a wall to walk into,
 *  not an edge to walk off. There is no fall-distance limit and no fall-damage
 *  model in v1 — a 50 m drop is an edge exactly like a 1 m one. That matches the
 *  reference consumer's mover, which has no fall-damage concept either, and it
 *  is what makes a deep cavern floor ENTERABLE rather than merely unreachable.
 *  A consumer that adds fall damage has to revisit this rule.
 *
 *  The descent terminates on the data, as {@link seedAnchor}'s does: unallocated
 *  space reads SOLID, so a column falling out of the allocated region stops. */
function fallTargets(
  v: SolidView,
  climbCells: number,
  x: number,
  y: number,
  z: number,
  visit: VisitColumn,
): void {
  for (const [dx, dz] of DIRS) {
    const nx = x + dx;
    const nz = z + dz;
    if (isSolid(v, nx, y, nz)) continue;
    let ny = y;
    while (!isSolid(v, nx, ny - 1, nz)) ny--;
    if (ny < y - climbCells) visit(nx, ny, nz);
  }
}

/** The other end of {@link fallTargets}: every column that would LAND here.
 *
 *  The exact transpose, derived rather than approximated. `fallTargets` emits
 *  `u → v` iff v's column is air at u's level and the descent from there lands
 *  on v — which holds iff `y_v ≤ y_u < ceilingAbove(v)`, i.e. iff u's level is
 *  inside THIS cell's own air pocket — and iff the drop clears the climb band,
 *  `y_u > y_v + climbCells`. Intersecting those two gives the scanned range
 *  exactly: `[y + climbCells + 1, ceiling)`.
 *
 *  Two boundaries in that range are load-bearing, and both are tested:
 *  - The ceiling is EXCLUSIVE, so the pocket's topmost air cell is included. A
 *    scan stopping one short loses precisely the shelf that sits level with a
 *    roofed bay's top cell — and it is uncapped besides, the same
 *    data-terminated bound {@link ceilingAbove} supplies, because any cap
 *    silently drops every ledge above it (a false-negative cliff).
 *  - Starting past the climb band is an EFFICIENCY choice, not a correctness
 *    one: the levels it skips are exactly the ones {@link climbNeighbours}
 *    already offers, both ways.
 *
 *  Asymmetric in COUNT, though: a column falls into at most one pocket per
 *  direction, while a pocket can be fallen into from many ledges. */
function fallSources(
  v: SolidView,
  climbCells: number,
  x: number,
  y: number,
  z: number,
  visit: VisitColumn,
): void {
  // OUR pocket's ceiling, bounding a scan of the NEIGHBOURS' anchors: a faller
  // has to be inside this air volume to land here, whichever column it stood in.
  const ceiling = ceilingAbove(v, x, y, z);
  for (const [dx, dz] of DIRS) {
    const nx = x + dx;
    const nz = z + dz;
    for (let ny = y + climbCells + 1; ny < ceiling; ny++)
      if (isFloorAnchor(v, nx, ny, nz)) visit(nx, ny, nz);
  }
}

/** Flood over floor-anchor columns from `starts`, following whatever `expand`
 *  offers, keyed by cell so callers can both test membership and iterate. Order
 *  is irrelevant to a reachable set, so the worklist is a plain stack.
 *
 *  Bounded by the data, with no artificial budget: a floor anchor needs an air
 *  cell, air exists only in allocated chunks, so the visited set can never
 *  exceed the store's allocated cells. */
function floodColumns(
  starts: readonly Column[],
  expand: Expand,
): Map<string, Column> {
  const seen = new Map<string, Column>();
  const pending: Column[] = [];
  const visit: VisitColumn = (x, y, z) => {
    const key = cellKey(x, y, z);
    if (seen.has(key)) return;
    const cell: Column = [x, y, z];
    seen.set(key, cell);
    pending.push(cell);
  };
  for (const s of starts) visit(s[0], s[1], s[2]);
  while (pending.length > 0) {
    const cur = pending.pop();
    if (cur === undefined) break;
    expand(cur[0], cur[1], cur[2], visit);
  }
  return seen;
}

/** Each seed's floor surface, dropping the ones with none. A buried or
 *  non-finite seed warns rather than throwing: seeds come from world data, and
 *  one stale spawn point must not veto the pass — {@link markUnreachable} would
 *  then demote an entire world on the strength of it. */
function seedColumns(
  v: SolidView,
  cellSize: number,
  seeds: readonly [number, number, number][],
  who: string,
): Column[] {
  const anchors: Column[] = [];
  for (const seed of seeds) {
    const anchor = seedAnchor(v, cellSize, seed);
    if (anchor === undefined)
      warn(
        "field",
        `${who}: seed has no floor surface below it (buried or non-finite) — ignored`,
        { seed },
      );
    else anchors.push(anchor);
  }
  return anchors;
}

/**
 * Marks every flag the agent cannot walk to from `seeds` as `unreachable`
 * (D-F4-8), WRITING THE VERDICT INTO the flags passed in — a triage demotion,
 * never a deletion. It removes no flag, changes no severity, and never touches
 * the store.
 *
 * The filter is a floor-connected flood from each seed's floor surface: four XZ
 * neighbours, any rise or drop within `climbCeiling` — the CLIMB BAND, the one
 * edge rule this module's two connectivity passes share, so "climbable" means
 * one thing here. Every flag anchors on a floor cell, so a flag is reachable
 * exactly when its anchor cell is in the flood.
 *
 * Miss-safety comes from demote-not-delete, NOT from the filter being sound —
 * which it is not, and deliberately so:
 * - **Falling is ignored.** A shelf the mover can only drop off, or reach by
 *   falling into, reads unreachable. {@link detectPits} models exactly that
 *   edge, and the two are deliberately NOT merged: this pass answers "can the
 *   agent get there at all", which stays the honest question for a demotion,
 *   and its undirected flood is what makes the answer conservative. One
 *   consequence follows directly: this flood cannot enter a pit, so tagging one
 *   would demote every `detectPits` finding. **`pit` flags are therefore SKIPPED
 *   here** — their tag is left `undefined`, the "show it" state — so mixing the
 *   two flag sets into one list is a no-op rather than a silent hiding.
 * - Headroom is ignored, so the flood crosses gaps the capsule cannot fit
 *   through, and coarse cells (a `cellSize` COARSER than `climbCeiling`, which
 *   floors `climbCells` to 0 — an equal one still grants 1) strand everything
 *   off the seed's own level.
 * - **Steps are 4-connected in XZ.** A floor whose only route in is a DIAGONAL
 *   step reads unreachable, though the mover walks there fine.
 *
 * Every one of those errors is visible in the UI as a hidden-by-default filter,
 * never as a missing flag. Present the `unreachable` set; do not drop it.
 *
 * @param flags - The map {@link analyzeWorld} returns (or an equivalent set of
 * per-chunk arrays). MUTATED — this is the function's only output, and the only
 * thing it writes: every flag gets `unreachable` set, `false` when reached and
 * `true` when not, so a re-run after the world changes clears a stale demotion
 * as readily as it makes a new one. An unwritten (`undefined`) tag means this
 * never ran over that flag — or that the flag is a `pit`, which this pass
 * deliberately does not answer for (see above).
 *
 * That third state is not hypothetical: analysis is per-dirty-chunk while this
 * pass is whole-world, so a MIXED-VINTAGE map — freshly analysed flags that no
 * flood has visited yet, beside tagged ones — is the normal steady state.
 * Consumers must therefore filter on the POSITIVE: hide `unreachable === true`,
 * show everything else. Testing `=== false` for "reachable" silently hides every
 * not-yet-flooded flag, which is a false negative wearing a filter's clothes.
 * @param seeds - WORLD positions the agent starts from (`playerStart`, spawn
 * points). Each snaps to the floor surface at or below it; a seed buried in rock
 * is unusable and warns. An empty list — or a list where no seed is usable —
 * skips the pass entirely, leaving every tag as it was: with nothing known to be
 * reachable, tagging would demote the whole world.
 * @throws Error - setup-loud, as {@link analyzeChunk}: an inconsistent agent
 * profile, or an `extraSolid` buffer of the wrong length.
 */
export function markUnreachable(
  store: FieldStore,
  profile: AgentProfile,
  flags: ReadonlyMap<ChunkKey, readonly FieldFlag[]>,
  seeds: readonly [number, number, number][],
  opts?: AnalyzeOptions,
): void {
  const v = validatedView(store, profile, opts);
  if (seeds.length === 0) return;
  // A clean world is the common case in the edit loop; flooding it to tag
  // nothing is pure cost.
  if (![...flags.values()].some((list) => list.length > 0)) return;

  const anchors = seedColumns(v, store.cellSize, seeds, "markUnreachable");
  if (anchors.length === 0) {
    warn(
      "field",
      "markUnreachable: no usable seed — skipped, no flags demoted",
      { seeds: seeds.length },
    );
    return;
  }

  const climbCells = climbCellsFor(profile, store.cellSize);
  const reached = floodColumns(anchors, (x, y, z, visit) =>
    climbNeighbours(v, climbCells, x, y, z, visit),
  );
  for (const list of flags.values())
    for (const f of list) {
      // A `pit` is trapped BY DEFINITION, and this flood cannot enter one — so
      // the question is meaningless here and the answer would always be "true".
      // Left unwritten rather than answered wrongly: `undefined` is the
      // documented "show it" state, so a consumer that keeps ONE flag list (the
      // natural shape for a panel) gets a no-op instead of silently hiding every
      // pit behind the default filter.
      if (f.kind === "pit") continue;
      f.unreachable = !reached.has(cellKey(f.cell[0], f.cell[1], f.cell[2]));
    }
}

/** One trap: the columns of a region, and the lowest of them — chosen by a
 *  post-pass minimum over the finished region under a total order
 *  ({@link lowerColumn}), so it never depends on flood order. */
type PitRegion = { anchor: Column; cells: Column[] };

/** Is `a` lower than `b` — Y first, then x, then z, so a flat-floored region
 *  picks the same anchor whatever order its columns were discovered in. */
function lowerColumn(a: Column, b: Column): boolean {
  if (a[1] !== b[1]) return a[1] < b[1];
  if (a[0] !== b[0]) return a[0] < b[0];
  return a[2] < b[2];
}

/** Splits the trapped columns into regions over the SAME edges the two floods
 *  walked, direction IGNORED: a shelf that drops into its own deeper floor is
 *  one trap and not two, because that is how the mover meets it. */
function pitRegions(
  v: SolidView,
  climbCells: number,
  trapped: ReadonlyMap<string, Column>,
): PitRegion[] {
  const claimed = new Set<string>();
  const regions: PitRegion[] = [];
  for (const [key, start] of trapped) {
    if (claimed.has(key)) continue;
    const region = floodColumns([start], (x, y, z, visit) => {
      const inside: VisitColumn = (nx, ny, nz) => {
        if (trapped.has(cellKey(nx, ny, nz))) visit(nx, ny, nz);
      };
      climbNeighbours(v, climbCells, x, y, z, inside);
      fallTargets(v, climbCells, x, y, z, inside);
      fallSources(v, climbCells, x, y, z, inside);
    });
    let anchor = start;
    for (const cell of region.values())
      if (lowerColumn(cell, anchor)) anchor = cell;
    for (const k of region.keys()) claimed.add(k);
    regions.push({ anchor, cells: [...region.values()] });
  }
  return regions;
}

/** One region as its flag: anchored at the bottom of the trap, carrying the
 *  region's size and every chunk it touches. Owners are sorted by KEY STRING —
 *  determinism, not spatial order. */
function pitFlag(cellSize: number, region: PitRegion): FieldFlag {
  const [x, y, z] = region.anchor;
  const owners = new Set<ChunkKey>();
  for (const cell of region.cells) owners.add(chunkOf(cell));
  return {
    kind: "pit",
    severity: "candidate",
    cell: [x, y, z],
    world: floorSurfaceWorld(cellSize, x, y, z),
    chunk: chunkOf(region.anchor),
    chunks: [...owners].sort(),
    cells: region.cells.length,
  };
}

/**
 * Finds the regions the agent can get INTO and not back OUT of (D-F4-18) — the
 * connectivity half of the advisor, and the one finding no per-cell filter can
 * express. **ADVISORY ONLY**, like every pass here: it never mutates the store,
 * never blocks a verb, never auto-fixes.
 *
 * The graph is the standable columns {@link markUnreachable} floods, with a
 * directed edge rule between XZ-4-adjacent ones: within `climbCeiling` of each
 * other they connect BOTH ways; further apart the higher one connects to the
 * lower and not back — walking off an edge, which the mover does freely (no
 * fall-damage model here, and none in the reference consumer's mover either).
 * A pit is then ENTERABLE ∧ ¬CAN-RETURN:
 * the flood from the seeds MINUS the flood that reaches the seeds over reversed
 * edges. Those columns cluster into 4-connected regions and each region emits
 * ONE flag, anchored at its lowest column.
 *
 * This replaces what the `ledge` candidate band tried to say and could not:
 * measurement (P-F4-3) found a tall rise is simply what vertical cave terrain is
 * made of, while a trap is a property of the graph.
 *
 * @param seeds - WORLD positions the agent starts from (`playerStart`, spawn
 * points), each snapped DOWN to the floor surface at or below it; a seed buried
 * in rock warns and is dropped. An empty list — or one where no seed is usable —
 * returns NO flags: with no known starting point there is no "enterable", and
 * guessing a spawn would be the advisor inventing its own premise. Several seeds
 * are ONE set, not several runs: a region counts as returnable if it can reach
 * ANY of them, so a hollow with a spawn of its own in it is never a pit.
 * @returns One `candidate` flag per pit region, ordered by where the enterable
 * flood first met each region — a FLAT array,
 * not the per-chunk map {@link analyzeWorld} returns, because a pit is a global
 * property and this pass is world-cadence (run it on the idle tail, not per
 * dirty chunk: one dug cell can open or seal a trap anywhere in the world).
 * `cell`/`world` are the anchor column, `cells` is the region's size in columns,
 * and `chunks` is every chunk the region touches — `chunk` alone (the anchor's)
 * is NOT a complete owner, so pit flags must be replaced wholesale per run
 * rather than per owner chunk the way the column pass's flags are.
 * @throws Error - setup-loud, as {@link analyzeChunk}: an inconsistent agent
 * profile, or an `extraSolid` buffer of the wrong length. The gate runs BEFORE
 * the empty-seed return, so a bad profile throws even with nothing to do.
 * @remarks What this does NOT model, all of it inherited from the shared node
 * set and edge rule, and none of it one-directionally safe the way
 * {@link markUnreachable}'s unsoundness is — this pass reports rather than
 * demotes, so an error either way is a wrong finding:
 * - **Headroom is ignored** (the node set's own simplification), so both floods
 *   cross gaps the capsule cannot fit through. That can hide a pit whose only
 *   modelled exit is a crawlspace the mover cannot enter, and can invent one
 *   whose only modelled entrance is.
 * - **Steps are 4-connected in XZ**, so a region whose only way out is a
 *   DIAGONAL step reads as a pit though the mover walks out of it.
 * - **The climb band has NO safe direction** — and do not reason as though it
 *   did. The band itself is exact rather than conservative (see
 *   {@link climbCellsFor}: a rise between anchors is exactly `Δy * cellSize`),
 *   and region count is not monotone in it EITHER way. Measured 2026-07-26 over
 *   4000 random stores: shrinking the band from 3 cells to 2 added a region in
 *   1561 and LOST one in 34, because a narrower band deletes ENTERABLE edges as
 *   readily as return ones — the band can reach an anchor that is not the
 *   descent landing, and {@link fallTargets} only offers the landing. So a
 *   MISSING pit is possible, and this list is not a proof that it is not.
 * - **Resolution bites where rounding does not.** At a `cellSize` as coarse as
 *   `climbCeiling` the band is one cell, and coarser still it is zero: the
 *   lattice then cannot represent a climbable step at all, so everything the
 *   agent can only drop to reads as trapped — a flood of regions rather than a
 *   finding. That is the coarse-cell cliff {@link markUnreachable} documents,
 *   with a louder failure mode.
 * - **Falls have no distance limit**, so a 50 m drop is an entrance like any
 *   other. It matches the reference consumer's mover, which takes no fall
 *   damage, and it is what makes a deep cavern floor "enterable" rather than
 *   merely unreachable. A consumer that adds fall damage must revisit it.
 * - The **rim divergence** applies unchanged: unallocated chunks read SOLID, so
 *   a shelf at the outer rim of the allocated region can read as walled-in where
 *   the runtime has no collider at all.
 */
export function detectPits(
  store: FieldStore,
  profile: AgentProfile,
  seeds: readonly [number, number, number][],
  opts?: AnalyzeOptions,
): FieldFlag[] {
  const v = validatedView(store, profile, opts);
  if (seeds.length === 0) return [];

  const anchors = seedColumns(v, store.cellSize, seeds, "detectPits");
  if (anchors.length === 0) {
    warn("field", "detectPits: no usable seed — skipped, no pits reported", {
      seeds: seeds.length,
    });
    return [];
  }

  const climbCells = climbCellsFor(profile, store.cellSize);
  const enterable = floodColumns(anchors, (x, y, z, visit) => {
    climbNeighbours(v, climbCells, x, y, z, visit);
    fallTargets(v, climbCells, x, y, z, visit);
  });
  const canReturn = floodColumns(anchors, (x, y, z, visit) => {
    climbNeighbours(v, climbCells, x, y, z, visit);
    fallSources(v, climbCells, x, y, z, visit);
  });

  const trapped = new Map<string, Column>();
  for (const [key, cell] of enterable)
    if (!canReturn.has(key)) trapped.set(key, cell);
  return pitRegions(v, climbCells, trapped).map((region) =>
    pitFlag(store.cellSize, region),
  );
}
