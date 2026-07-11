// src/world-build.ts — the deterministic (search-free) realize step: turns a WorldSpec
// into placed region + connector RegionData plus a computed player start. Runs at bake
// time (browser), so its placement trig is BAKED and never regenerated cross-engine.
import { join, type Placement, placePiece } from "./connect.ts";
import { organicTunnel } from "./connector.ts";
import type { Connection, RegionData, Vec3 } from "./region.ts";
import { cave } from "./themes/cave.ts";
import {
  DEFAULT_TUNNEL_LENGTH,
  validateWorldSpec,
  type WorldConnectorSpec,
  type WorldPlacement,
  type WorldRegionSpec,
  type WorldSpec,
} from "./world-spec.ts";

/** How far inside the start region's portal (along its INWARD facing) the player spawns (m). */
const PLAYER_START_INSET = 2.0;
/** Player spawn height above the portal floor (m): 0.9 capsule rest + 0.2 drop-in (main.ts). */
const PLAYER_SPAWN_RISE = 1.1;

/** The fully realized world: the resolved spec (derived placements baked in), the placed
 *  region + connector geometry, and where/which-way the player starts. */
export type RealizedWorld = {
  /** The input spec with every derived placement written back (world.json bakes this). */
  spec: WorldSpec;
  /** Region id → placed RegionData. */
  regions: Map<string, RegionData>;
  /** Connector id → RegionData. */
  connectors: Map<string, RegionData>;
  /** World-space player spawn position. */
  playerStart: Vec3;
  /** Player yaw (FpController convention) orienting them to face the start portal. */
  playerYaw: number;
};

/** Generate a region's unplaced (local-frame, origin [0,0,0]) RegionData from its spec.
 *  Only the "cave" algorithm exists this slice — the spec type restricts `algorithm` to it;
 *  add a dispatch here when a second interior algorithm lands. */
function generateRegion(region: WorldRegionSpec): RegionData {
  return cave({
    theme: "cave",
    seed: region.seed,
    origin: [0, 0, 0],
    mouths: region.params.mouths,
    capped: region.params.capped,
  });
}

function isZeroTranslation(t: Vec3): boolean {
  return t[0] === 0 && t[1] === 0 && t[2] === 0;
}

/** Map each DERIVED region (a `b`-end whose placement translation is the zero placeholder)
 *  to the connector its placement derives from. First such connector wins; W1 is one
 *  connector, so this is unambiguous. Regions absent from the map are placed explicitly. */
function identifyDerivedRegions(
  spec: WorldSpec,
  regionById: Map<string, WorldRegionSpec>,
): Map<string, WorldConnectorSpec> {
  const derivingConnector = new Map<string, WorldConnectorSpec>();
  for (const connector of spec.connectors) {
    const bId = connector.b[0];
    const bRegion = regionById.get(bId);
    if (
      bRegion &&
      isZeroTranslation(bRegion.placement.translation) &&
      !derivingConnector.has(bId)
    ) {
      derivingConnector.set(bId, connector);
    }
  }
  return derivingConnector;
}

/** The input spec with every region's resolved placement written back (derived `b`-ends
 *  carry their join-derived placement; everything else its explicit one). Fresh objects
 *  throughout — never aliases the input spec. */
function resolveSpec(
  spec: WorldSpec,
  resolvedPlacements: Map<string, WorldPlacement>,
): WorldSpec {
  return {
    ...spec,
    regions: spec.regions.map((region): WorldRegionSpec => {
      const placement = resolvedPlacements.get(region.id);
      if (!placement) throw new Error(`world: unplaced region ${region.id}`);
      return { ...region, params: { ...region.params }, placement };
    }),
    connectors: spec.connectors.map(
      (connector): WorldConnectorSpec => ({
        ...connector,
        a: [connector.a[0], connector.a[1]],
        b: [connector.b[0], connector.b[1]],
      }),
    ),
  };
}

/** A phantom portal `DEFAULT_TUNNEL_LENGTH` out along a PLACED portal's OUTWARD facing,
 *  keeping that facing. `join(phantom, b)` seats b's opening onto the phantom and makes
 *  b's placed facing `= −phantom.facing = −pA.facing`, so the two placed portals end up
 *  facing each other (dot ≈ −1) exactly one tunnel-length apart. */
function phantomTarget(pA: Connection): Connection {
  return {
    ...pA,
    position: [
      pA.position[0] + pA.facing[0] * DEFAULT_TUNNEL_LENGTH,
      pA.position[1] + pA.facing[1] * DEFAULT_TUNNEL_LENGTH,
      pA.position[2] + pA.facing[2] * DEFAULT_TUNNEL_LENGTH,
    ],
  };
}

/** The player spawn + yaw from the (placed) start portal: stepped `PLAYER_START_INSET`
 *  along the INWARD facing (portal facing is OUTWARD → inward = −facing, horizontal only),
 *  raised `PLAYER_SPAWN_RISE` above the portal floor, and yawed to look OUT along +facing
 *  toward the tunnel. */
function playerSpawn(pStart: Connection): { start: Vec3; yaw: number } {
  return {
    start: [
      pStart.position[0] - pStart.facing[0] * PLAYER_START_INSET,
      pStart.position[1] + PLAYER_SPAWN_RISE,
      pStart.position[2] - pStart.facing[2] * PLAYER_START_INSET,
    ],
    // FpController: forwardVector(yaw,0) = [−sin yaw, 0, −cos yaw]; solving for +facing
    // gives yaw = atan2(−facing.x, −facing.z).
    yaw: Math.atan2(-pStart.facing[0], -pStart.facing[2]),
  };
}

/** Realize a WorldSpec: generate + place every region (deriving zero-translation `b`-end
 *  placements from their already-placed `a` end via join-math), build every connector
 *  between the resulting placed portals, and compute the player start. Deterministic and
 *  search-free. Does NOT mutate `spec` — returns a resolved copy with derived placements. */
export function realizeWorldSpec(spec: WorldSpec): RealizedWorld {
  validateWorldSpec(spec);

  const regionById = new Map(spec.regions.map((r) => [r.id, r]));
  const generated = new Map<string, RegionData>(
    spec.regions.map((r) => [r.id, generateRegion(r)]),
  );

  const derivingConnector = identifyDerivedRegions(spec, regionById);

  const placed = new Map<string, RegionData>();
  const resolvedPlacements = new Map<string, WorldPlacement>();

  // Pass 1 — explicitly placed regions (everything not derived). This places every `a`
  // end before any `b` end is derived (W1 is linear; no topological solver needed).
  for (const region of spec.regions) {
    if (derivingConnector.has(region.id)) continue;
    const placement: Placement = {
      yaw: region.placement.yaw,
      translation: region.placement.translation,
    };
    const generatedRegion = generated.get(region.id);
    if (!generatedRegion) throw new Error(`world: missing region ${region.id}`);
    placed.set(region.id, placePiece(generatedRegion, placement));
    resolvedPlacements.set(region.id, {
      translation: [...region.placement.translation],
      yaw: region.placement.yaw,
    });
  }

  // Pass 2 — derive each `b`-end placement from its (already-placed) `a` end.
  for (const [bId, connector] of derivingConnector) {
    const [aId, aPortal] = connector.a;
    const bPortal = connector.b[1];
    const placedA = placed.get(aId);
    if (!placedA) {
      throw new Error(
        `world: cannot derive ${bId} — its a-end ${aId} is not placed yet`,
      );
    }
    const pA = placedA.connections[aPortal];
    const unplacedB = generated.get(bId);
    const bDoor = unplacedB?.connections[bPortal];
    if (!pA || !unplacedB || !bDoor) {
      throw new Error(
        `world: connector ${connector.id} references a missing portal`,
      );
    }
    const placement = join(phantomTarget(pA), bDoor);
    placed.set(bId, placePiece(unplacedB, placement));
    resolvedPlacements.set(bId, {
      translation: placement.translation,
      yaw: placement.yaw,
    });
  }

  // Build every connector between the resolved placed portals.
  const connectors = new Map<string, RegionData>();
  for (const connector of spec.connectors) {
    const portalA = placed.get(connector.a[0])?.connections[connector.a[1]];
    const portalB = placed.get(connector.b[0])?.connections[connector.b[1]];
    if (!portalA || !portalB) {
      throw new Error(
        `world: connector ${connector.id} references a missing portal`,
      );
    }
    connectors.set(
      connector.id,
      organicTunnel(portalA, portalB, connector.seed),
    );
  }

  const startPlaced = placed.get(spec.startRegion);
  const pStart = startPlaced?.connections[0];
  if (!pStart) {
    throw new Error(
      `world: start region ${spec.startRegion} has no portal 0 to spawn at`,
    );
  }
  const { start: playerStart, yaw: playerYaw } = playerSpawn(pStart);

  return {
    spec: resolveSpec(spec, resolvedPlacements),
    regions: placed,
    connectors,
    playerStart,
    playerYaw,
  };
}
