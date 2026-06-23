// packages/dungeon/src/themes/pillar-hall.ts (stub — real body in Task 5)
import type { RegionData, RegionParams } from "../region.ts";

/** TODO Task 5: real pillarHall generator. Stub returns empty RegionData. */
export function pillarHall(p: RegionParams): RegionData {
  return {
    meshes: [],
    colliders: [],
    materials: [],
    connections: [],
    origin: p.origin,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "pillarHall",
      seed: p.seed,
    },
  };
}
