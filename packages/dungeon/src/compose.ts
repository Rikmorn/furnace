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

export { STEP_HEIGHT } from "./themes/box-room.ts";

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

const CLIMB_RUN = 4.33; // horizontal run of the ramp climb (≈30° at CLIMB_HEIGHT) — GATE-TUNE
const CLIMB_HEIGHT = 2.5; // height the ramp upper room sits above its floor portal — GATE-TUNE
const STAIR_RUN = 6; // horizontal run of the stair climb — GATE-TUNE
const STAIR_HEIGHT = 3.5; // height the stair upper room sits above its floor portal — GATE-TUNE
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

/** Two elevated rooms attached to authored 2nd-chamber floor portals: a pillarHall reached
 *  by a ~30° OFF-AXIS ramp (proves arbitrary-yaw joining) and a greatHall reached by a
 *  cardinal stair-run. Coordinates clear the chamber's walls/pillar/slab/detail (GATE-TUNE);
 *  the rooms sit above the chamber at the climb height (their footprints overlap it). Returns
 *  connector+room pairs (same shape as `buildArea`'s). */
export function attachUpperLevel(seed: string): RegionData[] {
  // (a) off-axis ramp — fromA in the chamber's mid-west, climbing ~30° toward the NORTH (the
  // ramp passes UNDER the z=-10 floating detail at y<1, and stays WEST of the fallen slab).
  // aDir is 30° off −Z so the pillarHall sprawls north (past the north wall), clear of (b)'s
  // stair path at z=-6. Both rooms are large; aiming their sprawl into different exterior
  // volumes keeps each climb path clear of the other's room.
  const aYaw = (RAMP_OFF_AXIS_DEG * Math.PI) / 180;
  const aDir: Vec3 = [Math.sin(aYaw), 0, -Math.cos(aYaw)];
  const fromA: Connection = {
    position: [8, 0, -9.5],
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

  // (b) cardinal stairs — fromB in the south-clear band, climbing +X.
  const bDir: Vec3 = [1, 0, 0];
  const fromB: Connection = {
    position: [6, 0, -6],
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
