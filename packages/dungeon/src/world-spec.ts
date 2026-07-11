// World spec (W1): a declarative, search-free description of a world — regions with
// explicit placements, connectors joining named portals, and a player-start hint.
// Charter contract v2, field-organic class only this slice.
import type { Vec3 } from "./region.ts";

/** Placement of a region in the world: translation + yaw (radians about +Y). */
export type WorldPlacement = { translation: Vec3; yaw: number };

export type WorldRegionSpec = {
  /** Unique id within the world (also the resource-key prefix in the merged doc). */
  id: string;
  class: "field-organic";
  /** Interior algorithm id — this slice: "cave". */
  algorithm: "cave";
  /** Exact generator params (the provenance contract): everything cave() takes
   *  beyond {theme, seed, origin}. */
  params: { mouths: number; capped?: number };
  seed: string;
  placement: WorldPlacement;
};

export type WorldConnectorSpec = {
  id: string;
  kind: "organic-tunnel";
  /** [regionId, portalIndex] at each end — portal indices index the region's
   *  RegionData.connections AFTER placement. */
  a: [string, number];
  b: [string, number];
  seed: string;
};

export type WorldSpec = {
  name: string;
  regions: WorldRegionSpec[];
  connectors: WorldConnectorSpec[];
  /** Which region the player starts in; concrete coordinates are computed at
   *  realize time (inward of that region's portal 0) and BAKED into world.json. */
  startRegion: string;
};

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

/** The default world: two caves facing each other through one organic tunnel.
 *  Cave B's placement translation is a PLACEHOLDER (zeros) — world-build.ts
 *  derives it from cave A's realized mouth (deterministic, no search); the
 *  DERIVED placement is what bakes into world.json. */
export const DEFAULT_WORLD: WorldSpec = {
  name: "default",
  regions: [
    {
      id: "cave-a",
      class: "field-organic",
      algorithm: "cave",
      params: { mouths: 1 },
      seed: "world-default:a",
      placement: { translation: [0, 0, 0], yaw: 0 },
    },
    {
      id: "cave-b",
      class: "field-organic",
      algorithm: "cave",
      params: { mouths: 1 },
      seed: "world-default:b",
      placement: { translation: [0, 0, 0], yaw: 0 }, // derived — see world-build.ts
    },
  ],
  connectors: [
    {
      id: "tunnel-1",
      kind: "organic-tunnel",
      a: ["cave-a", 0],
      b: ["cave-b", 0],
      seed: "world-default:t1",
    },
  ],
  startRegion: "cave-a",
};
