// packages/dungeon/src/themes/cave.ts (stub — real body in Task 3)
import type { RegionData, RegionParams } from "../region.ts";

/** TODO Task 3: real cave generator. Stub returns empty RegionData. */
export function cave(p: RegionParams): RegionData {
  return {
    meshes: [],
    colliders: [],
    materials: [],
    connections: [],
    origin: p.origin,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "cave",
      seed: p.seed,
    },
  };
}
