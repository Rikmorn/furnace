import { create as makeRng } from "@furnace/core/rng";
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

/** Snap an outward XZ facing to the nearest cardinal unit vector. */
function snapCardinal(f: Vec3): Vec3 {
  return Math.abs(f[0]) >= Math.abs(f[2])
    ? [Math.sign(f[0]) || 1, 0, 0]
    : [0, 0, Math.sign(f[2]) || 1];
}

/** Rotate a local XZ vector by the cardinal yaw that maps `from` → `to` (both unit cardinals). */
function yawMap(from: Vec3, to: Vec3): (v: Vec3) => Vec3 {
  const rots: Array<(v: Vec3) => Vec3> = [
    (v) => [v[0], v[1], v[2]], // 0°
    (v) => [v[2], v[1], -v[0]], // +90°
    (v) => [-v[0], v[1], -v[2]], // 180°
    (v) => [-v[2], v[1], v[0]], // -90°
  ];
  const matched = rots.find((r) => {
    const a = r(from);
    return a[0] === to[0] && a[2] === to[2];
  });
  if (!matched)
    throw new Error(
      `yawMap: no cardinal rotation maps ${JSON.stringify(from)} -> ${JSON.stringify(to)}`,
    );
  return matched;
}

/** Cardinal yaw swaps X/Z extents for 90/270-degree rotations. */
function rotateExtent(size: Vec3, rot: (v: Vec3) => Vec3): Vec3 {
  const r = rot([size[0], size[1], size[2]]);
  return [Math.abs(r[0]), Math.abs(r[1]), Math.abs(r[2])];
}

function rotateShape(
  shape: RegionData["colliders"][number]["shape"],
  rot: (v: Vec3) => Vec3,
): RegionData["colliders"][number]["shape"] {
  if ("cuboid" in shape) {
    const e = rotateExtent(shape.cuboid as Vec3, rot);
    return { cuboid: e };
  }
  // voxels (cave proxies) never go through placeRoom
  return shape;
}

/** Place a local-frame room so its door connection lands on `target` facing −target.facing. */
function placeRoom(room: RegionData, target: Connection): RegionData {
  const door = room.connections.find((c) => c.kind === "door") as Connection;
  const wantFacing: Vec3 = [
    -target.facing[0],
    target.facing[1],
    -target.facing[2],
  ];
  const rot = yawMap(door.facing, snapCardinal(wantFacing));

  const doorWorld = rot(door.position);
  const t: Vec3 = [
    target.position[0] - doorWorld[0],
    target.position[1] - doorWorld[1],
    target.position[2] - doorWorld[2],
  ];
  const xf = (v: Vec3): Vec3 => {
    const r = rot(v);
    return [r[0] + t[0], r[1] + t[1], r[2] + t[2]];
  };

  return {
    ...room,
    meshes: room.meshes.map((m) => ({
      ...m,
      position: xf(m.position),
      geometry:
        "box" in m.geometry
          ? { box: rotateExtent(m.geometry.box, rot) }
          : m.geometry,
    })),
    colliders: room.colliders.map((c) => ({
      shape: rotateShape(c.shape, rot),
      position: xf(c.position),
    })),
    connections: room.connections.map((c) => ({
      ...c,
      position: xf(c.position),
      facing: rot(c.facing),
    })),
    origin: target.position,
  };
}

/** A small flat-floored vestibule box bridging a cave mouth to a room door (research §3). */
function vestibule(
  mouth: Connection,
  floorY: number,
  seed: string,
): RegionData {
  const FLOOR_THICK = 0.3; // vestibule floor slab thickness (m) — GATE-TUNE
  const dir = snapCardinal(mouth.facing);
  const depth = 2.5; // overlap into cave + reach to room — GATE-TUNE
  const halfX = Math.max(mouth.width, 1.6) / 2 + 0.4;
  const halfZ = depth / 2;
  // centre the vestibule floor flush at floorY, straddling the mouth along `dir`
  const cx = mouth.position[0] + dir[0] * (depth / 2 - 0.5);
  const cz = mouth.position[2] + dir[2] * (depth / 2 - 0.5);
  const floorSize: Vec3 = [halfX * 2, FLOOR_THICK, halfZ * 2];
  const floorCenter: Vec3 = [cx, floorY - FLOOR_THICK / 2, cz];
  const mat = {
    color: [0.5, 0.5, 0.52, 1] as [number, number, number, number],
    specular: [0.02, 0.02, 0.02, 8] as [number, number, number, number],
  };
  return {
    meshes: [
      { geometry: { box: floorSize }, material: 0, position: floorCenter },
    ],
    colliders: [
      {
        shape: {
          cuboid: [floorSize[0] / 2, floorSize[1] / 2, floorSize[2] / 2],
        },
        position: floorCenter,
      },
    ],
    materials: [mat],
    connections: [],
    instances: [],
    origin: mouth.position,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "pillarHall",
      seed,
    },
  };
}

/** Room theme rotation — branch 0 → pillarHall, branch 1 → greatHall, cycling for
 *  any future branch count. */
const ROOM_THEMES: Array<{ gen: ThemeGenerator; theme: ThemeName }> = [
  { gen: pillarHall, theme: "pillarHall" },
  { gen: greatHall, theme: "greatHall" },
];

/** Compose a branching cave + a vestibule + a room per branch end.
 *  Branch 0 uses `pillarHall`, branch 1 uses `greatHall`; future branches cycle.
 *
 * @param seed  - Deterministic seed string for the entire area.
 * @param origin - World-space origin (XYZ) at which the cave hub is placed.
 * @returns An ordered array of `RegionData`: cave first, then vestibule+room pairs
 *          for each branch mouth (entrance -Z excluded). */
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
    return [
      vestibule(mouth, mouth.position[1], `${seed}-vest-${i}`),
      placeRoom(room, mouth),
    ];
  });
  return [c, ...pairs];
}
