import { create as makeRng } from "@furnace/core/rng";
import type {
  MaterialDescriptor,
  RegionData,
  RegionParams,
} from "../region.ts";
import {
  boxRoom,
  type DoorSpec,
  pillarBox,
  pillarGrid,
  roomFloorScatter,
} from "./box-room.ts";

const MATERIAL_COLOR: [number, number, number, number] = [0.55, 0.54, 0.5, 1];
const MATERIAL_SPECULAR: [number, number, number, number] = [
  0.05, 0.05, 0.05, 16,
];

/** Columned rectangular hall: seeded dims + pillar grid over a boxRoom shell.
 *  Returns a full `RegionData` in LOCAL frame; `compose.ts` bakes world placement. */
export function pillarHall(p: RegionParams): RegionData {
  const rng = makeRng(p.seed);
  const width = rng.derive("w").int(8, 15);
  const depth = rng.derive("d").int(10, 19);
  const height = 3.5 + rng.derive("h").float() * 1.5;
  // Door height clears the controller's step-up reach at the cave seam: the cave
  // voxel floor sits ~0.25m below the room floor at the mouth, so entering the room
  // is a step-up; a 2.2m lintel sat only STEP_HEIGHT above the room-floor rest height,
  // so the step-up raise slammed the capsule into the lintel and wedged it (walk-probe
  // gate). A 2.8m door lifts the lintel well clear of the raised capsule top.
  const door: DoorSpec = { side: "S", offset: 0, width: 1.6, height: 2.8 };
  const bay = rng.derive("bay").pick([3, 3.5, 4, 4.5]);
  const section = rng.derive("sec").pick([0.5, 0.7, 1.0]);
  const pillars = pillarGrid({ width, depth, bay, section, door }).map((g) =>
    pillarBox(g.x, g.z, height, section),
  );
  const room = boxRoom(
    { width, depth, height, wallThick: 0.4, floorThick: 0.3, door },
    pillars,
  );
  const materials: MaterialDescriptor[] = [
    { color: MATERIAL_COLOR, specular: MATERIAL_SPECULAR },
  ];
  const instances = roomFloorScatter(
    width,
    depth,
    door,
    rng.derive("scatter"),
    materials,
  );
  return {
    ...room,
    materials,
    instances,
    origin: p.origin,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "pillarHall",
      seed: p.seed,
    },
  };
}
