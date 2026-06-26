import { create as makeRng } from "@furnace/core/rng";
import type { RegionData, RegionParams, Vec3 } from "../region.ts";
import { type Box, boxRoom, type DoorSpec, stepBoxes } from "./box-room.ts";

const MATERIAL_COLOR: [number, number, number, number] = [0.48, 0.47, 0.46, 1];
const MATERIAL_SPECULAR: [number, number, number, number] = [
  0.04, 0.04, 0.04, 12,
];

/** Grand rectangular hall with a raised dais at the far end and a stepped approach.
 *  Seeded dims are wider and taller than a pillarHall. Door height 2.8 clears the
 *  controller's step-up reach at the cave-mouth seam (same gate-proven clearance as
 *  pillarHall). Returns a full `RegionData` in LOCAL frame; `compose.ts` bakes world
 *  placement. */
export function greatHall(p: RegionParams): RegionData {
  const rng = makeRng(p.seed);
  const width = rng.derive("w").int(14, 23);
  const depth = rng.derive("d").int(18, 31);
  const height = 6 + rng.derive("h").float() * 3;
  const door: DoorSpec = { side: "S", offset: 0, width: 2.0, height: 2.8 };
  const platTop = 0.3 + rng.derive("plat").float() * 0.5; // 0.3..0.8 m dais height
  const platDepth = depth / 3;
  const platZ = depth / 2 - platDepth / 2; // far end (away from S door)
  const dais: Box = {
    center: [0, platTop / 2, platZ] as Vec3,
    size: [width * 0.7, platTop, platDepth] as Vec3,
  };
  const steps = stepBoxes(
    platTop,
    platZ - platDepth / 2 - 0.5,
    Math.min(4, width * 0.4),
    1.0,
  );
  const features: Box[] = [dais, ...steps];
  const room = boxRoom(
    { width, depth, height, wallThick: 0.5, floorThick: 0.3, door },
    features,
  );
  return {
    ...room,
    materials: [{ color: MATERIAL_COLOR, specular: MATERIAL_SPECULAR }],
    instances: [],
    origin: p.origin,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "greatHall",
      seed: p.seed,
    },
  };
}
