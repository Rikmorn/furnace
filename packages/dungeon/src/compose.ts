import { create as makeRng } from "@furnace/core/rng";
import { join, placePiece, route } from "./connect.ts";
import type {
  Connection,
  RegionData,
  ThemeGenerator,
  ThemeName,
  Vec3,
} from "./region.ts";
import { cave } from "./themes/cave.ts";
import { greatHall } from "./themes/great-hall.ts";
import { pillarHall } from "./themes/pillar-hall.ts";

/** Place a local-frame room so its door connection lands on `target` (facing −target.facing). */
function placeRoom(room: RegionData, target: Connection): RegionData {
  const door = room.connections.find((c) => c.kind === "door") as Connection;
  return placePiece(room, join(target, door));
}

/** Room theme rotation — branch 0 → pillarHall, branch 1 → greatHall, cycling for
 *  any future branch count. */
const ROOM_THEMES: Array<{ gen: ThemeGenerator; theme: ThemeName }> = [
  { gen: pillarHall, theme: "pillarHall" },
  { gen: greatHall, theme: "greatHall" },
];

/** Metres the room door sits beyond the cave mouth; a `route` corridor bridges the gap. */
const ROOM_GAP = 2.5; // GATE-TUNE

/** Compose a branching cave + a connector + a room per branch end. Branch 0 uses
 *  `pillarHall`, branch 1 uses `greatHall`; future branches cycle.
 *
 * @param seed   - Deterministic seed string for the entire area.
 * @param origin - World-space origin (XYZ) at which the cave hub is placed.
 * @returns An ordered array of `RegionData`: cave first, then connector+room pairs for
 *          each branch mouth (the -Z entrance mouth is excluded). */
export function buildArea(seed: string, origin: Vec3): RegionData[] {
  const rng = makeRng(seed);
  const c = cave({
    theme: "cave",
    seed: rng.derive("cave").float().toString(),
    origin,
  });
  const mouths = c.connections.filter(
    (m) =>
      m.kind === "tunnel-mouth" && !(m.facing[0] === 0 && m.facing[2] === -1),
  );
  const pairs = mouths.flatMap((mouth, i) => {
    // Boundary cast: modulo index is provably in-bounds; noUncheckedIndexedAccess
    // widens the element to `| undefined` and cannot track that invariant.
    const choice = ROOM_THEMES[i % ROOM_THEMES.length] as {
      gen: ThemeGenerator;
      theme: ThemeName;
    };
    const room = choice.gen({
      theme: choice.theme,
      seed: `${seed}-room-${i}`,
      origin,
    });
    // Place the room a gap out along the mouth facing (same height), then bridge the
    // mouth → placed-door span with a flat `route` corridor.
    const target: Connection = {
      position: [
        mouth.position[0] + mouth.facing[0] * ROOM_GAP,
        mouth.position[1],
        mouth.position[2] + mouth.facing[2] * ROOM_GAP,
      ],
      facing: mouth.facing,
      width: mouth.width,
      height: mouth.height,
      kind: "door",
    };
    const placed = placeRoom(room, target);
    const placedDoor = placed.connections.find(
      (cn) => cn.kind === "door",
    ) as Connection;
    return [route(mouth, placedDoor), placed];
  });
  return [c, ...pairs];
}

/** Seat the generated wing onto an authored door via the connection primitive: build the
 *  wing at a provisional origin, `join` the cave's −Z entrance portal onto `chamberDoor`
 *  (pushed `gap` metres out along the door facing), rigidly move every wing region by that
 *  placement, and `route` a corridor from the door to the placed entrance. Shared by
 *  `main.ts` and the traversal harness so they cannot drift.
 *
 * @param seed        - Deterministic seed string for the wing's area.
 * @param chamberDoor - The authored door the wing attaches to (its facing points outward,
 *                      away from the chamber interior, toward the wing).
 * @param gap         - Metres the cave entrance sits beyond the door; a `route` corridor
 *                      bridges the span.
 * @returns The placed wing regions and the corridor bridging the door to the placed entrance. */
export function attachWing(
  seed: string,
  chamberDoor: Connection,
  gap: number,
): { regions: RegionData[]; corridor: RegionData } {
  const wing = buildArea(seed, [0, 0, 0]);
  const caveRegion = wing.find(
    (r) => r.provenance.theme === "cave",
  ) as RegionData;
  const entrance = caveRegion.connections.find(
    (cn) =>
      cn.kind === "tunnel-mouth" && cn.facing[0] === 0 && cn.facing[2] === -1,
  ) as Connection;
  const seamTarget: Connection = {
    position: [
      chamberDoor.position[0] + chamberDoor.facing[0] * gap,
      chamberDoor.position[1],
      chamberDoor.position[2] + chamberDoor.facing[2] * gap,
    ],
    facing: chamberDoor.facing,
    width: entrance.width,
    height: entrance.height,
    kind: "door",
  };
  const place = join(seamTarget, entrance);
  const regions = wing.map((r) => placePiece(r, place));
  const placedCave = regions.find(
    (r) => r.provenance.theme === "cave",
  ) as RegionData;
  const placedEntrance = placedCave.connections.find(
    (cn) =>
      cn.kind === "tunnel-mouth" && cn.facing[0] === 0 && cn.facing[2] === -1,
  ) as Connection;
  const corridor = route(chamberDoor, placedEntrance);
  return { regions, corridor };
}

// Both upper rooms float in the VOID well clear of the authored chamber: each climb rises
// over a chamber rim (walls reach y=6, open-topped above) and continues OUT into empty space,
// so the room floor lands above y=6 (clearing the chamber by elevation) AND offset in XZ
// (clearing the other room). Long connectors are intentional — the rooms sit high in the fog.
const CLIMB_RUN = 16; // off-axis ramp horizontal run — long, to climb over the north rim into the void — GATE-TUNE
const CLIMB_HEIGHT = 13.4; // ramp room floats this high; the slab clears the y=6 north wall mid-climb (pitch ≈40°) — GATE-TUNE
const STAIR_RUN = 12; // cardinal stair horizontal run — long, to climb over the east rim into the void — GATE-TUNE
const STAIR_HEIGHT = 10; // stair room floats this high; the steps clear the y=6 east wall mid-climb — GATE-TUNE
const RAMP_OFF_AXIS_DEG = 30; // ramp yaw off −Z — non-cardinal, proves arbitrary-angle joining

/** Build one elevated room: seat `room`'s door `run` metres out and `height` up along the
 *  portal's facing (`from.facing` IS the climb direction) from the floor portal `from`, then
 *  `route` a `kind` connector up to it. Returns the connector + placed-room pair (same shape
 *  as `buildArea`'s entries). */
function attachUpperRoom(
  from: Connection,
  run: number,
  height: number,
  kind: "ramp" | "stairs",
  room: RegionData,
): RegionData[] {
  const dir = from.facing;
  const target: Connection = {
    position: [
      from.position[0] + dir[0] * run,
      from.position[1] + height,
      from.position[2] + dir[2] * run,
    ],
    facing: dir,
    width: from.width,
    height: from.height,
    kind: "door",
  };
  const placed = placeRoom(room, target);
  const door = placed.connections.find((c) => c.kind === "door") as Connection;
  return [route(from, door, { kind }), placed];
}

/** Two elevated rooms attached to authored 2nd-chamber floor portals, each relocated into
 *  SEPARATED clear void: a pillarHall reached by a ~30° OFF-AXIS ramp (proves arbitrary-yaw
 *  joining) that climbs over the NORTH rim and sprawls north-west, and a greatHall reached by
 *  a cardinal stair-run that climbs over the EAST rim and sprawls east. Both room floors land
 *  ABOVE y=6 (so neither overlaps the chamber, walls y[0,6]) and in disjoint XZ volumes (so
 *  the two rooms do not overlap each other) — asserted by `tests/upper-level.test.ts`. The
 *  climbs clear the chamber's walls/pillar/slab/detail (GATE-TUNE). Returns connector+room
 *  pairs (same shape as `buildArea`'s). */
export function attachUpperLevel(seed: string): RegionData[] {
  // (a) off-axis ramp — fromA at the chamber's east-mid floor, just south of the z=-10 floating
  // detail (the wall y[3,9]), climbing ~30° off −Z toward the NORTH-WEST. Sitting close to z=-10
  // keeps the crossing LOW so the capsule (and its per-tick step-up raise) passes UNDER the
  // detail; the ramp then stays WEST of the fallen slab, clears the north wall (x[5,15]) ABOVE
  // y=6 mid-climb, and continues into the void. The pillarHall floor lands ~13 m up with its
  // door at z≈-23; the room AABB (x[-13,8], z[-42,-20], y[13,18]) is clear of both the chamber
  // and the EAST-sprawling greatHall (which lives at x>18).
  const aYaw = (RAMP_OFF_AXIS_DEG * Math.PI) / 180;
  const aDir: Vec3 = [-Math.sin(aYaw), 0, -Math.cos(aYaw)];
  const fromA: Connection = {
    position: [10, 0, -9.6],
    facing: aDir,
    width: 2,
    height: 3,
    kind: "door",
  };
  const roomA = pillarHall({
    theme: "pillarHall",
    seed: `${seed}-up-a`,
    origin: [0, 0, 0],
  });

  // (b) cardinal stairs — fromB in the south-clear band (z=-6, clear of the pillar and the
  // z=-10 detail), climbing +X over the EAST wall (x=15, cleared above y=6 mid-climb) and out
  // into the void; the greatHall floor lands ~10 m up at x>15 — clear of both the chamber and
  // the NW-sprawling pillarHall.
  const bDir: Vec3 = [1, 0, 0];
  const fromB: Connection = {
    position: [7, 0, -6],
    facing: bDir,
    width: 2,
    height: 3,
    kind: "door",
  };
  const roomB = greatHall({
    theme: "greatHall",
    seed: `${seed}-up-b`,
    origin: [0, 0, 0],
  });

  return [
    ...attachUpperRoom(fromA, CLIMB_RUN, CLIMB_HEIGHT, "ramp", roomA),
    ...attachUpperRoom(fromB, STAIR_RUN, STAIR_HEIGHT, "stairs", roomB),
  ];
}
