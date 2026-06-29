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
