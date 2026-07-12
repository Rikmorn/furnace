// World spec (W2): a declarative, search-free description of a world — regions with
// explicit placements, connectors joining named portals, and a player-start hint.
// Charter contract v2: two region classes (field-organic caves, grid-built halls)
// and four connector kinds.
import type { Vec3 } from "./region.ts";
import { HALL_PRESETS, type HallParams } from "./themes/hall.ts";

/** Placement of a region in the world: translation + yaw (radians about +Y). */
export type WorldPlacement = { translation: Vec3; yaw: number };

/** A field-organic region (SDF cave): exact cave() provenance params. */
export type CaveRegionSpec = {
  /** Unique id within the world (also the resource-key prefix in the merged doc). */
  id: string;
  class: "field-organic";
  algorithm: "cave";
  /** Exact generator params (the provenance contract): everything cave() takes
   *  beyond {theme, seed, origin}. */
  params: { mouths: number; capped?: number };
  seed: string;
  placement: WorldPlacement;
};

/** A grid-built region (masonry hall): lattice-snapped placement; interior from
 *  the hall stamper's parameters. */
export type HallRegionSpec = {
  /** Unique id within the world (also the resource-key prefix in the merged doc). */
  id: string;
  class: "grid-built";
  algorithm: "hall";
  params: HallParams;
  seed: string;
  placement: WorldPlacement;
};

/** A region in the world — discriminated by `class` (and its paired `algorithm`). */
export type WorldRegionSpec = CaveRegionSpec | HallRegionSpec;

/** How two portals are joined. `organic-tunnel` = the SDF capsule bore (caves);
 *  `corridor`/`aperture`/`collar-bore` = grid-built joins (halls and mixed seams). */
export type WorldConnectorKind =
  | "organic-tunnel"
  | "corridor"
  | "aperture"
  | "collar-bore";

export type WorldConnectorSpec = {
  id: string;
  kind: WorldConnectorKind;
  /** [regionId, portalIndex] at each end — portal indices index the region's
   *  RegionData.connections AFTER placement. */
  a: [string, number];
  b: [string, number];
  seed: string;
  /** corridor/collar-bore derivation knobs; lattice-snapped where grid-facing. */
  params?: { length?: number; deltaY?: number };
};

export type WorldSpec = {
  name: string;
  regions: WorldRegionSpec[];
  connectors: WorldConnectorSpec[];
  /** Which region the player starts in; concrete coordinates are computed at
   *  realize time (inward of that region's portal 0) and BAKED into world.json. */
  startRegion: string;
};

/** Dust tolerance for join-derived grid placements (spec D-W2-10). */
const GRID_SNAP_TOL = 1e-6;
/** The lattice cell size grid placements snap to (m). */
const GRID_LATTICE = 0.5;
const QUARTER = Math.PI / 2;

/** Snap one translation component to the `GRID_LATTICE` lattice, throwing
 *  setup-loud if it sits further than dust off a lattice node. */
function snapLatticeAxis(t: number): number {
  const snapped = Math.round(t / GRID_LATTICE) * GRID_LATTICE;
  if (Math.abs(snapped - t) > GRID_SNAP_TOL) {
    throw new Error(
      `world: grid placement off the ${GRID_LATTICE} lattice (${t})`,
    );
  }
  return snapped;
}

/** Snap a grid-built placement to the exact lattice: translations to 0.5
 *  multiples, yaw to an exact quarter-turn. Setup-loud beyond dust tolerance —
 *  a non-cardinal join into a grid region is a spec error, not a rounding job. */
export function snapGridPlacement(p: WorldPlacement): WorldPlacement {
  const translation: Vec3 = [
    snapLatticeAxis(p.translation[0]),
    snapLatticeAxis(p.translation[1]),
    snapLatticeAxis(p.translation[2]),
  ];
  const yaw = Math.round(p.yaw / QUARTER) * QUARTER;
  if (Math.abs(yaw - p.yaw) > GRID_SNAP_TOL) {
    throw new Error(`world: grid yaw ${p.yaw} is not a quarter-turn`);
  }
  return { translation, yaw };
}

/** A `grid-built` region whose translation is all-zero AND yaw is 0 is the
 *  derived-placement placeholder: its real placement is computed at realize time,
 *  so it must NOT be lattice-checked yet. */
function isZeroTranslationPlaceholder(p: WorldPlacement): boolean {
  return p.translation.every((t) => t === 0) && p.yaw === 0;
}

/** Throws unless the spec is non-empty, every region is reachable from the first
 *  via connectors (charter rule: no region isolated), all connector endpoints
 *  resolve, and no portal is claimed by more than one connector (portal reuse
 *  would make Task 3's placement-from-connector derivation ambiguous). */
export function validateWorldSpec(spec: WorldSpec): void {
  const first = spec.regions[0];
  if (!first) throw new Error("world: no regions");
  const ids = new Set(spec.regions.map((r) => r.id));
  if (ids.size !== spec.regions.length) {
    throw new Error("world: duplicate region ids");
  }
  for (const r of spec.regions) {
    if (
      r.class === "grid-built" &&
      !isZeroTranslationPlaceholder(r.placement)
    ) {
      snapGridPlacement(r.placement); // throws setup-loud off-lattice
    }
  }
  if (!ids.has(spec.startRegion)) {
    throw new Error(`world: startRegion ${spec.startRegion} is not a region`);
  }
  const adj = new Map<string, string[]>();
  const claimedPortals = new Set<string>();
  const claimPortal = (rid: string, portal: number): void => {
    const key = `${rid}:${portal}`;
    if (claimedPortals.has(key)) {
      throw new Error(
        `world: portal ${key} is claimed by more than one connector`,
      );
    }
    claimedPortals.add(key);
  };
  for (const c of spec.connectors) {
    for (const [rid] of [c.a, c.b]) {
      if (!ids.has(rid)) {
        throw new Error(
          `world: connector ${c.id} references unknown region ${rid}`,
        );
      }
    }
    claimPortal(c.a[0], c.a[1]);
    claimPortal(c.b[0], c.b[1]);
    adj.set(c.a[0], [...(adj.get(c.a[0]) ?? []), c.b[0]]);
    adj.set(c.b[0], [...(adj.get(c.b[0]) ?? []), c.a[0]]);
  }
  const seen = new Set<string>([first.id]);
  const queue = [first.id];
  while (queue.length > 0) {
    const cur = queue.pop();
    if (cur === undefined) break;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const isolated = spec.regions.filter((r) => !seen.has(r.id));
  if (isolated.length > 0) {
    throw new Error(
      `world: isolated region(s): ${isolated.map((r) => r.id).join(", ")}`,
    );
  }
}

/** Tunnel length between the two cave mouths (m) — cave B's placement derives
 *  from cave A's mouth via join-math at this distance (world-build.ts). */
export const DEFAULT_TUNNEL_LENGTH = 8;

/** THE GATE WORLD (W2 Task 14) — the committed default the game boots and the
 *  player walks. It exercises BOTH region classes and BOTH built connector kinds
 *  in one graph: a grid-built pillar hall (the start) climbs a stair corridor
 *  into a small box room, and bores sideways through a collar into a
 *  field-organic cave.
 *
 *  Portal indexing follows `params.doors` order: `hall-a` portal 0 is its NORTH
 *  door (consumed by `corridor-1`), portal 1 its EAST door (consumed by `bore-1`).
 *
 *  `hall-b` and `cave-c` carry PLACEHOLDER (all-zero) placements — world-build.ts
 *  derives each from the connector that reaches it (deterministic, no search:
 *  the corridor carries `length`/`deltaY`, the bore its axis). The DERIVED
 *  placements are what bake into the manifest. */
export const DEFAULT_WORLD: WorldSpec = {
  name: "default",
  regions: [
    {
      id: "hall-a",
      class: "grid-built",
      algorithm: "hall",
      params: {
        ...HALL_PRESETS.pillarHall,
        doors: [
          { wall: "north", offset: 3 }, // portal 0 — corridor-1
          // Offset 5 seats the door centre at z=4.0, BETWEEN the colonnade's
          // pillar slots (k=3,6,9,…): offset 6 put a pillar dead on the bore
          // axis — rejected by the stamper's door-lane validation.
          { wall: "east", offset: 5 }, // portal 1 — bore-1
        ],
      },
      seed: "world-default:a",
      placement: { translation: [0, 0, 0], yaw: 0 },
    },
    {
      id: "hall-b",
      class: "grid-built",
      algorithm: "hall",
      params: {
        ...HALL_PRESETS.boxRoom,
        doors: [{ wall: "south", offset: 2 }],
      },
      seed: "world-default:b",
      placement: { translation: [0, 0, 0], yaw: 0 }, // derived via corridor-1
    },
    {
      id: "cave-c",
      class: "field-organic",
      algorithm: "cave",
      params: { mouths: 1 },
      seed: "world-default:c",
      placement: { translation: [0, 0, 0], yaw: 0 }, // derived via bore-1
    },
  ],
  connectors: [
    {
      id: "corridor-1",
      kind: "corridor",
      a: ["hall-a", 0],
      b: ["hall-b", 0],
      seed: "world-default:t1",
      params: { length: 6, deltaY: 1.5 }, // Task 12 proved this flight walks up AND down
    },
    {
      id: "bore-1",
      kind: "collar-bore",
      a: ["hall-a", 1],
      b: ["cave-c", 0],
      seed: "world-default:t2",
    },
  ],
  startRegion: "hall-a",
};
