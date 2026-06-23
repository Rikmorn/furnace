// packages/dungeon/src/themes/great-hall.ts (stub — real body in Task 10)
import type { RegionData, RegionParams } from "../region.ts";

/** TODO Task 10: real greatHall generator. Stub returns empty RegionData. */
export function greatHall(p: RegionParams): RegionData {
  return {
    meshes: [],
    colliders: [],
    materials: [],
    connections: [],
    origin: p.origin,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "greatHall",
      seed: p.seed,
    },
  };
}
