// tests/_helpers/world-fixtures.ts
import { HALL_PRESETS } from "../../src/themes/hall.ts";
import type { WorldSpec } from "../../src/world-spec.ts";

/** hall-a (pillarHall + south door) ↔ derived cave via a collar-bore. */
export const HALL_CAVE: WorldSpec = {
  name: "hall-cave",
  regions: [
    {
      id: "hall-a",
      class: "grid-built",
      algorithm: "hall",
      params: {
        ...HALL_PRESETS.pillarHall,
        doors: [{ wall: "south", offset: 3 }],
      },
      seed: "t:h",
      placement: { translation: [0, 0, 0], yaw: 0 },
    },
    {
      id: "cave-b",
      class: "field-organic",
      algorithm: "cave",
      params: { mouths: 1 },
      seed: "t:c",
      placement: { translation: [0, 0, 0], yaw: 0 },
    },
  ],
  connectors: [
    {
      id: "bore-1",
      kind: "collar-bore",
      a: ["hall-a", 0],
      b: ["cave-b", 0],
      seed: "t:b",
    },
  ],
  startRegion: "hall-a",
};

/** two boxRoom halls joined by a stair corridor (b-end derived, 1.5 m up). */
export const TWO_HALLS: WorldSpec = {
  name: "two-halls",
  regions: [
    {
      id: "hall-a",
      class: "grid-built",
      algorithm: "hall",
      params: {
        ...HALL_PRESETS.boxRoom,
        doors: [{ wall: "north", offset: 2 }],
      },
      seed: "t:a",
      placement: { translation: [0, 0, 0], yaw: 0 },
    },
    {
      id: "hall-b",
      class: "grid-built",
      algorithm: "hall",
      params: {
        ...HALL_PRESETS.boxRoom,
        doors: [{ wall: "south", offset: 2 }],
      },
      seed: "t:b",
      placement: { translation: [0, 0, 0], yaw: 0 }, // derived
    },
  ],
  connectors: [
    {
      id: "corr-1",
      kind: "corridor",
      a: ["hall-a", 0],
      b: ["hall-b", 0],
      seed: "t:corr",
      params: { length: 6, deltaY: 1.5 },
    },
  ],
  startRegion: "hall-a",
};
