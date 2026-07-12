// tests/_helpers/world-fixtures.ts
import { HALL_PRESETS } from "../../src/themes/hall.ts";
import type { WorldSpec } from "../../src/world-spec.ts";

/** Two caves facing each other through one ORGANIC TUNNEL — the world that WAS `DEFAULT_WORLD`
 *  until W2 Task 14 promoted the gate world (halls + stair corridor + collar-bore cave) into that
 *  slot. Kept as a fixture because it is the ONLY `organic-tunnel` world under test: the
 *  cave↔cave join math (tunnel-length derivation off cave A's mouth, the phantom-facing
 *  correction that makes the two mouths face each other) is a live invariant of `world-build.ts`
 *  that the gate world no longer exercises. Cave B's placement is the derived-from-A placeholder. */
export const TWO_CAVES: WorldSpec = {
  name: "two-caves",
  regions: [
    {
      id: "cave-a",
      class: "field-organic",
      algorithm: "cave",
      params: { mouths: 1 },
      seed: "world-default:a",
      placement: { translation: [0, 0, 0], yaw: 0 },
    },
    {
      id: "cave-b",
      class: "field-organic",
      algorithm: "cave",
      params: { mouths: 1 },
      seed: "world-default:b",
      placement: { translation: [0, 0, 0], yaw: 0 }, // derived — see world-build.ts
    },
  ],
  connectors: [
    {
      id: "tunnel-1",
      kind: "organic-tunnel",
      a: ["cave-a", 0],
      b: ["cave-b", 0],
      seed: "world-default:t1",
    },
  ],
  startRegion: "cave-a",
};

/** hall-a (pillar-FREE hall + south door) ↔ derived cave via a collar-bore.
 *  Pillars are deliberately OFF: this fixture isolates the collar-bore SEAM,
 *  and its off-centre (±0.55) probe lanes must be clear of interior obstacles
 *  by design — pillar collision is `hall-walk.gpu.test.ts`'s job. (The old
 *  over-carving capsule had been EATING the pillar in these lanes' path, which
 *  is why they ever passed with a colonnade here.) */
export const HALL_CAVE: WorldSpec = {
  name: "hall-cave",
  regions: [
    {
      id: "hall-a",
      class: "grid-built",
      algorithm: "hall",
      params: {
        ...HALL_PRESETS.pillarHall,
        pillars: { kind: "none" },
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
