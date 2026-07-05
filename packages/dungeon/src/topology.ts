// packages/dungeon/src/topology.ts
// The Slice 2.2.5b-B2 topology generator: a pure, deterministic, seeded world-graph
// builder feeding layoutWorld unchanged. Two-phase: the PLAN pass below decides
// sectors/rooms/edges on plain data (cycles-first macro ring; elevations assigned during
// growth so every edge's dh is a derived difference and cycles close in height by
// construction; universal descent orientation because every generated portal is walled);
// the MATERIALIZE pass (generateWorldGraph) calls theme generators with exact door
// counts and resolves portal indices.
import { create as makeRng, type Rng } from "@furnace/core/rng";
import { type ConnectorKind, minWalkableRun } from "./connect.ts";
import type { RegionData, ThemeName } from "./region.ts";
import type { DoorSpec, Side } from "./themes/box-room.ts";
import { cave } from "./themes/cave.ts";
import { greatHall } from "./themes/great-hall.ts";
import { pillarHall } from "./themes/pillar-hall.ts";
import {
  validateGraph,
  type WorldEdge,
  type WorldGraph,
  type WorldNode,
} from "./world-graph.ts";

/** Sector archetype: the coarse identity biasing a sector's themes/heights/styles. */
export type SectorArchetype = "warren" | "halls" | "works";

/** Generator knobs. `attempts` is consumed by world.ts buildWorld's retry loop. */
export type TopologyConfig = {
  /** Total generated rooms across all sectors (a cave counts as one room). */
  targetRooms: number;
  /** Sector count sampled uniformly in this inclusive range. */
  sectors: [number, number];
  /** Max |elevation| of any room floor (m). */
  verticality: number;
  /** Probability an eligible open-portal pair closes an intra-sector loop. */
  loopChance: number;
  /** buildWorld's whole-pipeline retry budget (total attempts). */
  attempts: number;
};

export const DEFAULT_TOPOLOGY: TopologyConfig = {
  targetRooms: 30,
  sectors: [3, 5],
  verticality: 14,
  loopChance: 0.35,
  attempts: 3,
};

const MIN_ROOMS_PER_SECTOR = 2;
const SECTOR_STEP: [number, number] = [4, 8]; // |base elevation| step between adjacent sectors
const INTRA_LENGTH: [number, number] = [4, 10];
const INTER_LENGTH: [number, number] = [8, 16];
const ENTRY_LENGTH: [number, number] = [6, 12];
const LOOP_MAX_DROP = 10; // skip loop candidates with a bigger |dh| (aesthetic soft cap)
const CAP_CHANCE = 0.25; // warren caves: chance of one extra sealed bore (dressing)
const MIN_RANGE_SPAN = 2; // every lengthRange spans ≥ this (the placer samples lengths)
const FLAT_SNAP = 0.05; // |dh| below this is emitted as exactly flat

type ArchetypeProfile = {
  themes: [ThemeName, number][];
  /** Per-room |elevation delta| range off its growth parent (m). */
  delta: [number, number];
  /** Band half-height around the sector base (m). */
  amplitude: number;
  /** Chance a child room stays exactly level with its parent. */
  flatChance: number;
  /** Chance a sector-owned edge is enclosure:"open" (guardrail bridge). */
  openChance: number;
  /** Chance a sloped sector-owned edge is forced kind:"stairs". */
  forceStairsChance: number;
};

const PROFILES: Record<SectorArchetype, ArchetypeProfile> = {
  warren: {
    themes: [
      ["cave", 0.5],
      ["pillarHall", 0.4],
      ["greatHall", 0.1],
    ],
    delta: [0.5, 3],
    amplitude: 3,
    flatChance: 0.5,
    openChance: 0,
    forceStairsChance: 0,
  },
  halls: {
    themes: [
      ["pillarHall", 0.65],
      ["greatHall", 0.3],
      ["cave", 0.05],
    ],
    delta: [0.5, 1.5],
    amplitude: 2,
    flatChance: 0.7,
    openChance: 0,
    forceStairsChance: 0,
  },
  works: {
    themes: [
      ["pillarHall", 0.8],
      ["greatHall", 0.1],
      ["cave", 0.1],
    ],
    delta: [3, 10],
    amplitude: 8,
    flatChance: 0.15,
    openChance: 0.3,
    forceStairsChance: 0.35,
  },
};

/** Max portal count a theme can host (one per cardinal side / 4 cave bores).
 *  Exported for tests. */
export const CAPACITY: Record<ThemeName, number> = {
  cave: 4,
  pillarHall: 4,
  greatHall: 1,
};

/** Plan-pass abstract node — everything materialization needs, no RegionData. */
export type AbstractNode = {
  id: string;
  sector: number;
  theme: ThemeName;
  seed: string;
  /** Floor elevation (m, relative to the anchor portal's Y). */
  elevation: number;
  /** Sampled portal capacity (≤ CAPACITY[theme]). */
  capacity: number;
  /** Consumed portals — assigned as slot indices 0..used-1 in edge-creation order. */
  used: number;
  /** Extra sealed cave bores (warren dressing); 0 for box themes. */
  capped: number;
};

export type AbstractEdge = {
  a: string; // node id, or the anchor id for the entry edge
  b: string;
  aSlot: number;
  bSlot: number;
  /** b.elevation − a.elevation, ≤ 0 by orientation (universal descent). */
  dh: number;
  lengthRange: [number, number];
  kind?: ConnectorKind;
  enclosure?: "open";
};

export type AbstractPlan = {
  sectors: { archetype: SectorArchetype; base: number }[];
  nodes: AbstractNode[];
  edges: AbstractEdge[];
};

function validateConfig(cfg: TopologyConfig): void {
  if (cfg.sectors[0] < 1 || cfg.sectors[1] < cfg.sectors[0]) {
    throw new Error(`topology: sectors range [${cfg.sectors}] is invalid`);
  }
  if (cfg.targetRooms < MIN_ROOMS_PER_SECTOR * cfg.sectors[0]) {
    throw new Error(
      `topology: targetRooms ${cfg.targetRooms} cannot fill ${cfg.sectors[0]} sectors at ${MIN_ROOMS_PER_SECTOR} rooms each`,
    );
  }
  if (cfg.loopChance < 0 || cfg.loopChance > 1) {
    throw new Error(`topology: loopChance ${cfg.loopChance} outside [0, 1]`);
  }
  if (cfg.verticality < 0) {
    throw new Error(`topology: verticality ${cfg.verticality} must be >= 0`);
  }
  if (cfg.attempts < 1) {
    throw new Error(`topology: attempts ${cfg.attempts} must be >= 1`);
  }
}

function weightedPick<T>(rng: Rng, entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng.float() * total;
  for (const [v, w] of entries) {
    roll -= w;
    if (roll <= 0) return v;
  }
  return (entries[entries.length - 1] as [T, number])[0];
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

/** Internal growth-time edge (pre-orientation, pre-slot). */
type RawEdge = {
  a: string;
  b: string;
  context: "entry" | "intra" | "inter";
  /** Sector whose profile styles this edge (the deeper/owning sector). */
  sector: number;
};

/** BFS over a growth-tree edge list to recover the tree path between two nodes
 *  (endpoints included). Mirrors chains.ts deriveChains' treePath construction — the
 *  placer's own cycle-member recovery — so a cycle's "members" agree between the
 *  generator's hygiene guard here and the placer's chain decomposition there: BFS only
 *  ever walks `tree`, never a previously accepted closing edge, so it can't shortcut
 *  into a shorter, different-membership path than deriveChains would recover for the
 *  same edge. Throws (generator bug) if `b` is unreachable from `a` — the growth tree
 *  spans every node by construction, so this should never fire on a passing pipeline. */
function treePathNodes(tree: RawEdge[], a: string, b: string): string[] {
  const adj = new Map<string, string[]>();
  for (const e of tree) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
  }
  const prev = new Map<string, string>();
  const seen = new Set([a]);
  const q = [a];
  while (q.length) {
    // Boundary cast: the `while (q.length)` guard proves the queue is non-empty.
    const cur = q.shift() as string;
    if (cur === b) break;
    for (const next of adj.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      q.push(next);
    }
  }
  if (!seen.has(b)) {
    throw new Error(
      `topology: no growth-tree path ${a} → ${b} (generator bug — tree disconnected)`,
    );
  }
  const path: string[] = [b];
  let cur = b;
  while (cur !== a) {
    // Boundary cast: every enqueued non-source node had its `prev` entry set when it
    // was enqueued; the walk starts at `b` (reachable, so enqueued) and follows `prev`
    // back to `a`, so each visited `cur !== a` has a `prev` entry.
    const p = prev.get(cur) as string;
    path.push(p);
    cur = p;
  }
  return path;
}

/** PLAN PASS. Pure and deterministic: sector skeleton (cycles-first macro ring over the
 *  sector graph, entry sector = warren, ≥1 works), per-sector tree growth with
 *  elevations assigned parent-relative (cycles close in height by construction),
 *  intra-sector loop closing, ring-closing inter-sector edges chosen minimizing |dh|,
 *  then edge finishing: universal descent orientation (a = high end), archetype styling
 *  (open enclosure / forced stairs), and lengthRange floors from minWalkableRun so every
 *  emitted edge is walkable by construction. Exported for unit tests (the scatter
 *  `_sampleSurface` convention); generateWorldGraph is the public entry. */
export function _planTopology(
  anchorId: string,
  anchorElevation: number,
  seed: string,
  cfg: TopologyConfig,
): AbstractPlan {
  validateConfig(cfg);
  const rng = makeRng(`${seed}/topology`);

  // --- 1. Sectors: count, archetypes, macro ring + branches, bases ---
  const maxSectors = Math.min(
    cfg.sectors[1],
    Math.floor(cfg.targetRooms / MIN_ROOMS_PER_SECTOR),
  );
  const count = rng.derive("sector-count").int(cfg.sectors[0], maxSectors + 1);
  const archetypes: SectorArchetype[] = ["warren"];
  const worksAt = count > 1 ? 1 + rng.derive("works-at").int(0, count - 1) : 0;
  const pickArch = rng.derive("arch");
  for (let i = 1; i < count; i++) {
    archetypes.push(
      i === worksAt
        ? "works"
        : weightedPick(pickArch, [
            ["warren", 0.3],
            ["halls", 0.4],
            ["works", 0.3],
          ] as [SectorArchetype, number][]),
    );
  }
  // Macro shape: ring over sectors 0..ringSize-1 (entry always on the ring → the
  // guaranteed world cycle passes the front door); the rest branch off earlier sectors.
  // A ring needs ≥ 3 members; degenerate configs (sectors floor < 3) fall back to a
  // chain — cycles then come only from intra-sector loops (the guarantee holds for the
  // DEFAULT config, whose floor is 3).
  const ringSize =
    count < 3 ? 0 : count === 3 ? 3 : 3 + rng.derive("ring").int(0, count - 2);
  // Macro spanning tree: ring members chain 0→1→…→ringSize-1; every other sector
  // branches off any earlier sector. The ring-CLOSING pair is (ringSize-1, 0),
  // materialized after growth as a checked loop edge.
  const macroParent: (number | null)[] = [null];
  for (let i = 1; i < count; i++) {
    macroParent.push(i < ringSize ? i - 1 : rng.derive(`branch${i}`).int(0, i));
  }
  // Bases: bounded walk down the macro tree from the entry (base = anchor elevation).
  const bases: number[] = [anchorElevation];
  const baseRng = rng.derive("bases");
  for (let i = 1; i < count; i++) {
    const parent = bases[macroParent[i] as number] as number;
    const amp = PROFILES[archetypes[i] as SectorArchetype].amplitude;
    const step =
      SECTOR_STEP[0] + baseRng.float() * (SECTOR_STEP[1] - SECTOR_STEP[0]);
    const sign = baseRng.bool() ? 1 : -1;
    bases.push(
      clamp(
        parent + sign * step,
        anchorElevation - cfg.verticality + amp,
        anchorElevation + cfg.verticality - amp,
      ),
    );
  }

  // --- 2. Room budget ---
  const perSector = new Array(count).fill(MIN_ROOMS_PER_SECTOR) as number[];
  let leftover = cfg.targetRooms - MIN_ROOMS_PER_SECTOR * count;
  const budgetRng = rng.derive("budget");
  while (leftover > 0) {
    // Boundary cast: noUncheckedIndexedAccess widens the compound-assignment read to
    // number|undefined even though `perSector` is a fixed-length number[]; the cast is
    // erased at compile time (identical runtime semantics, single RNG draw).
    (perSector[budgetRng.int(0, count)] as number) += 1;
    leftover--;
  }

  // --- 3. Growth: per sector, in macro-tree order (parents before children) ---
  const nodes: AbstractNode[] = [];
  const raw: RawEdge[] = [];
  const byId = new Map<string, AbstractNode>();
  const free = (n: AbstractNode): number => n.capacity - n.used;
  /** Macro edges still owed by sector i (children in the macro tree + its ring-closing
   *  duty). Growth keeps this many slots free so inter-sector seams always fit. */
  const reserved = new Array(count).fill(0) as number[];
  // Boundary cast (see above): compound-assignment reads into `reserved`/`perSector`
  // need `as number` under noUncheckedIndexedAccess; erased at compile time.
  for (let i = 1; i < count; i++)
    (reserved[macroParent[i] as number] as number) += 1;
  if (ringSize >= 3) {
    (reserved[0] as number) += 1;
    (reserved[ringSize - 1] as number) += 1;
  }

  const sectorNodes = (s: number): AbstractNode[] =>
    nodes.filter((n) => n.sector === s);
  const sectorFree = (s: number): number =>
    sectorNodes(s).reduce((sum, n) => sum + free(n), 0);

  const growthOrder: number[] = [];
  {
    // BFS over the macro tree so every sector's parent grows first.
    const kids = new Map<number, number[]>();
    for (let i = 1; i < count; i++) {
      const p = macroParent[i] as number;
      kids.set(p, [...(kids.get(p) ?? []), i]);
    }
    const q = [0];
    while (q.length) {
      const s = q.shift() as number;
      growthOrder.push(s);
      for (const k of kids.get(s) ?? []) q.push(k);
    }
  }

  for (const s of growthOrder) {
    const profile = PROFILES[archetypes[s] as SectorArchetype];
    const grow = rng.derive(`grow${s}`);
    for (let j = 0; j < (perSector[s] as number); j++) {
      const id = `s${s}-r${j}`;
      const isRoot = j === 0;
      // Parent: sector root attaches across the seam (anchor for sector 0, an
      // open-portal room of the macro-parent sector otherwise); other rooms attach
      // to an open-portal room of their OWN sector.
      let parent: AbstractNode | null = null;
      if (!isRoot || s !== 0) {
        const poolSector = isRoot ? (macroParent[s] as number) : s;
        const candidates = sectorNodes(poolSector).filter((n) => free(n) > 0);
        if (candidates.length === 0) {
          throw new Error(
            `topology: sector ${poolSector} has no free portals for ${id} — reserve guard failed (generator bug)`,
          );
        }
        parent = candidates[
          grow.derive(`p${j}`).int(0, candidates.length)
        ] as AbstractNode;
      }
      // Theme: entry root is ALWAYS a cave (cave-first front door). Guard: while this
      // sector still owes rooms or macro seams beyond this node's own tree link, don't
      // let a capacity-1 greatHall starve the frontier.
      let theme: ThemeName =
        isRoot && s === 0
          ? "cave"
          : weightedPick(grow.derive(`t${j}`), profile.themes);
      const roomsLeft = (perSector[s] as number) - j - 1;
      const needAfter = roomsLeft + (reserved[s] as number);
      const freeAfterParent = isRoot ? sectorFree(s) : sectorFree(s) - 1;
      if (
        CAPACITY[theme] === 1 &&
        needAfter > 0 &&
        freeAfterParent + (CAPACITY[theme] - 1) < needAfter
      ) {
        theme = "pillarHall";
      }
      const sampled =
        CAPACITY[theme] === 1
          ? 1
          : grow.derive(`c${j}`).int(2, CAPACITY[theme] + 1);
      // Reserve floor (Lever B, 2026-07-04 investigation): the greatHall guard above only
      // ever checks the FIXED capacity of a capacity-1 theme; a capacity>1 theme's SAMPLED
      // value can still land too low to cover this sector's still-outstanding macro/ring
      // duty once this is the LAST room the sector will grow (no later sibling can add more
      // free capacity). Flooring only here — using the sector's ACTUAL accumulated free
      // total, not a forecast — is exact: earlier rooms already resolved sectorFree(s).
      const capacity =
        roomsLeft === 0 && CAPACITY[theme] > 1
          ? Math.min(
              CAPACITY[theme],
              Math.max(sampled, needAfter - freeAfterParent + 1),
            )
          : sampled;
      // Elevation: parent-relative, clamped to the sector band.
      const base = bases[s] as number;
      const parentElev = parent ? parent.elevation : anchorElevation;
      let elevation = parentElev;
      if (grow.derive(`f${j}`).float() >= profile.flatChance) {
        const mag =
          profile.delta[0] +
          grow.derive(`d${j}`).float() * (profile.delta[1] - profile.delta[0]);
        const sign = grow.derive(`sg${j}`).bool() ? 1 : -1;
        elevation = clamp(
          parentElev + sign * mag,
          Math.max(base - profile.amplitude, anchorElevation - cfg.verticality),
          Math.min(base + profile.amplitude, anchorElevation + cfg.verticality),
        );
      }
      const capped =
        theme === "cave" &&
        archetypes[s] === "warren" &&
        grow.derive(`cap${j}`).float() < CAP_CHANCE
          ? 1
          : 0;
      const node: AbstractNode = {
        id,
        sector: s,
        theme,
        seed: `${seed}/s${s}/r${j}`,
        elevation,
        capacity,
        used: 0,
        capped,
      };
      // Cap check: capped bores + used portals must fit the cave's 4 cardinals; the
      // materializer passes mouths=used, capped=capped. Reserve one cardinal per cap.
      if (node.capped > 0) node.capacity = Math.min(node.capacity, 3);
      nodes.push(node);
      byId.set(id, node);
      if (isRoot && s === 0) {
        raw.push({ a: anchorId, b: id, context: "entry", sector: s });
        node.used += 1; // anchor edge consumes one mouth
      } else {
        const p = parent as AbstractNode;
        raw.push({
          a: p.id,
          b: id,
          context: isRoot ? "inter" : "intra",
          sector: s,
        });
        p.used += 1;
        node.used += 1;
        if (isRoot) (reserved[macroParent[s] as number] as number) -= 1;
      }
    }
  }

  // Cycle hygiene: fundamental cycles are VERTEX-DISJOINT — cycles sharing rooms are
  // the one shape the cycles-first precedent (Ma-2014/Edgar) degrades on, and the
  // Gate-A block measured exactly that (interleaved 15/7/4-member cycle systems).
  const cycleMembers = new Set<string>();
  // Frozen growth-tree snapshot for cycle-path BFS below: sections 4/5 append CLOSING
  // edges to `raw` (materialization needs them in growth order), but a cycle's members
  // are its TREE path — snapshotting here, before any closing edge exists, means later
  // treePathNodes calls can never shortcut through one (see treePathNodes' own doc).
  const growthEdges = raw.slice();

  // --- 4. Ring closing: one checked loop edge between the ring's end sectors ---
  if (ringSize >= 3) {
    const ends: [number, number] = [ringSize - 1, 0];
    const [sa, sb] = ends;
    let best: [AbstractNode, AbstractNode] | null = null;
    for (const na of sectorNodes(sa).filter((n) => free(n) > 0)) {
      for (const nb of sectorNodes(sb).filter((n) => free(n) > 0)) {
        if (
          !best ||
          Math.abs(na.elevation - nb.elevation) <
            Math.abs(best[0].elevation - best[1].elevation)
        ) {
          best = [na, nb];
        }
      }
    }
    if (!best) {
      throw new Error(
        "topology: no free portal pair to close the macro ring — reserve guard failed (generator bug)",
      );
    }
    for (const id of treePathNodes(growthEdges, best[0].id, best[1].id))
      cycleMembers.add(id);
    raw.push({ a: best[0].id, b: best[1].id, context: "inter", sector: sa });
    best[0].used += 1;
    best[1].used += 1;
    (reserved[sa] as number) -= 1;
    (reserved[sb] as number) -= 1;
  }

  // --- 5. Intra-sector loop closing ---
  const loopRng = rng.derive("loops");
  for (let s = 0; s < count; s++) {
    const openNodes = () => sectorNodes(s).filter((n) => free(n) > 0);
    const connected = (a: string, b: string): boolean =>
      raw.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
    const candidates = openNodes();
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const na = candidates[i] as AbstractNode;
        const nb = candidates[j] as AbstractNode;
        if (free(na) < 1 || free(nb) < 1) continue;
        if (connected(na.id, nb.id)) continue;
        if (Math.abs(na.elevation - nb.elevation) > LOOP_MAX_DROP) continue;
        const path = treePathNodes(growthEdges, na.id, nb.id);
        if (path.some((id) => cycleMembers.has(id))) continue;
        if (loopRng.derive(`${na.id}|${nb.id}`).float() < cfg.loopChance) {
          raw.push({ a: na.id, b: nb.id, context: "intra", sector: s });
          na.used += 1;
          nb.used += 1;
          for (const id of path) cycleMembers.add(id);
        }
      }
    }
  }

  // --- 6. Edge finishing: orientation, style, lengths, slots ---
  const slotCounter = new Map<string, number>();
  const nextSlot = (id: string): number => {
    if (id === anchorId) return 0;
    const k = slotCounter.get(id) ?? 0;
    slotCounter.set(id, k + 1);
    return k;
  };
  const styleRng = rng.derive("style");
  const edges: AbstractEdge[] = raw.map((e, i) => {
    const elevOf = (id: string): number =>
      id === anchorId
        ? anchorElevation
        : (byId.get(id) as AbstractNode).elevation;
    // Universal descent orientation: a = the HIGH end. Every generated portal is a
    // walled doorway (box lintels / cave collars), so every climbing edge must arrive
    // at its LOW end through route's flat landing — b below a, always.
    let [a, b] = [e.a, e.b];
    if (elevOf(b) > elevOf(a)) [a, b] = [b, a];
    let dh = elevOf(b) - elevOf(a);
    if (Math.abs(dh) < FLAT_SNAP) dh = 0;
    const profile = PROFILES[archetypes[e.sector] as SectorArchetype];
    const er = styleRng.derive(`e${i}`);
    const kind: ConnectorKind | undefined =
      dh < 0 && er.derive("k").float() < profile.forceStairsChance
        ? "stairs"
        : undefined;
    const enclosure: "open" | undefined =
      er.derive("o").float() < profile.openChance ? "open" : undefined;
    const base =
      e.context === "entry"
        ? ENTRY_LENGTH
        : e.context === "inter"
          ? INTER_LENGTH
          : INTRA_LENGTH;
    const lo = Math.max(base[0], minWalkableRun(dh, kind));
    const hi = Math.max(base[1], lo + MIN_RANGE_SPAN);
    const out: AbstractEdge = {
      a,
      b,
      aSlot: nextSlot(a),
      bSlot: nextSlot(b),
      dh,
      lengthRange: [lo, hi],
    };
    if (kind) out.kind = kind;
    if (enclosure) out.enclosure = enclosure;
    return out;
  });

  return {
    sectors: archetypes.map((archetype, i) => ({
      archetype,
      base: bases[i] as number,
    })),
    nodes,
    edges,
  };
}

const SIDES: readonly Side[] = ["S", "N", "E", "W"];
const ROOM_DOOR = { width: 1.6, height: 2.8 };

/** MATERIALIZE one abstract node: call its theme with exactly `used` portals so slot k
 *  is portal k by construction (boxRoom emits connections in door order; cave emits its
 *  usable collared mouths in bore order). */
function materializeNode(n: AbstractNode): RegionData {
  if (n.theme === "cave") {
    return cave({
      theme: "cave",
      seed: n.seed,
      origin: [0, 0, 0],
      mouths: n.used,
      capped: n.capped,
    });
  }
  if (n.theme === "greatHall") {
    // capacity 1 by construction — its single fixed S door is slot 0.
    return greatHall({ theme: "greatHall", seed: n.seed, origin: [0, 0, 0] });
  }
  const sides = shuffled(makeRng(`${n.seed}/sides`), SIDES).slice(0, n.used);
  const doors: DoorSpec[] = sides.map((side) => ({
    side,
    offset: 0,
    width: ROOM_DOOR.width,
    height: ROOM_DOOR.height,
  }));
  return pillarHall({
    theme: "pillarHall",
    seed: n.seed,
    origin: [0, 0, 0],
    doors,
  });
}

/** Generate the full world graph off a pinned anchor: PLAN (see _planTopology), then
 *  MATERIALIZE each node with exact door counts, then emit WorldEdges whose portal
 *  indices are the plan's slot indices. Pure + deterministic; throws setup-loud on
 *  config nonsense or a door-less anchor; self-checks with validateGraph before
 *  returning. The entry edge joins anchor portal 0 to the entry warren's root cave. */
export function generateWorldGraph(
  anchor: WorldNode,
  seed: string,
  config?: Partial<TopologyConfig>,
): WorldGraph {
  const cfg: TopologyConfig = { ...DEFAULT_TOPOLOGY, ...config };
  const entry = anchor.region.connections[0];
  if (!entry || entry.kind !== "door") {
    throw new Error(
      "topology: anchor must expose a door-class portal at index 0",
    );
  }
  const plan = _planTopology(anchor.id, entry.position[1], seed, cfg);
  const nodes: WorldNode[] = [anchor];
  for (const n of plan.nodes) {
    nodes.push({ id: n.id, region: materializeNode(n), theme: n.theme });
  }
  const edges: WorldEdge[] = plan.edges.map((e) => {
    const out: WorldEdge = {
      a: e.a,
      b: e.b,
      aPortal: e.aSlot,
      bPortal: e.bSlot,
      lengthRange: e.lengthRange,
    };
    if (e.dh !== 0) out.heightDelta = e.dh;
    if (e.kind) out.kind = e.kind;
    if (e.enclosure) out.enclosure = e.enclosure;
    return out;
  });
  const graph: WorldGraph = { nodes, edges };
  validateGraph(graph);
  return graph;
}
