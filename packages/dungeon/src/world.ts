// packages/dungeon/src/world.ts
// The hand-written 2.2.5a proof graph: the authored level pinned as a collision phantom,
// the branching cave wing, two cave-side ground rooms, two elevated rooms (ramp + stairs),
// and a NEW ground-level `landing` room that closes a TWO-HOP descending cycle
// (upperA → landing via forced descending stairs, then landing → hallA via a flat closing
// corridor). Topology is authored; PLACEMENT comes out of layoutWorld — no GATE-TUNE world
// positions. Will be shared by main.ts and the traversal GPU harness (wired in later
// tasks) so they can't drift.
// 2.2.5b replaces this file's authored topology with a generated graph.
//
// Why the two-hop shape (not a direct upperA→hallA descent): a straight descending
// connector between the chamber-elevated upperA and the cave-seated hallA has to cross the
// authored east wall / cave geometry and mate two far-apart, mis-angled doors — it cannot
// close (proven in Task 7's first BLOCK). The `landing` room sits in the OPEN VOID east of
// the authored x=15 wall: the descent drops into that void (nothing to clip but landing
// itself), and the flat closing corridor then joins two EAST-side ground rooms — no wall
// crossing on either hop.
import { create as makeRng } from "@furnace/core/rng";
import { aabbOfBoxes } from "./aabb.ts";
import { CHAMBER_DOOR, LEVEL_BOXES } from "./level.ts";
import type { Connection, RegionData } from "./region.ts";
import { GENERATOR_VERSION } from "./region.ts";
import type { DoorSpec } from "./themes/box-room.ts";
import { cave } from "./themes/cave.ts";
import { greatHall } from "./themes/great-hall.ts";
import { pillarHall } from "./themes/pillar-hall.ts";
import type { WorldGraph } from "./world-graph.ts";

export const WORLD_SEED = "world-1";

// Elevated-room portals on the authored 2nd chamber's floor (x[5,15], z[-16,-4], open
// top; east wall x=15 tops at y=6; the z=-10 detail wall spans x[5,15], y[3,9]).
// Both climbs run EAST (+X) over the east wall. UPPER_PORTAL_A is at z=-8 (NOT the
// intuitive z=-6): the cave-wing connector's clearance inflates its shoulder ±1.9 m on
// BOTH horizontal axes and bulges to z≈-5.9 at CHAMBER_DOOR, so a z=-6 ramp collides with
// it; z=-8 clears it (ramp z-max -6.6 < -5.9) and clears the pillar/detail-wall in Y.
// GATE-TUNE.
const UPPER_PORTAL_A: Connection = {
  position: [7, 0, -8],
  facing: [1, 0, 0],
  width: 2,
  height: 3,
  kind: "door",
};
const UPPER_PORTAL_B: Connection = {
  position: [7, 0, -13],
  facing: [1, 0, 0],
  width: 2,
  height: 3,
  kind: "door",
};
const UPPER_HEIGHT = 10; // upperA floor clears the authored envelope top (y≈9) — GATE-TUNE
// upperB is stacked ABOVE upperA (both climb +X from the small chamber, so their wide
// footprints overlap in XZ; separating them in Y is the only fit). At equal heights the two
// rooms envelope-overlap; hd 17 clears upperA's ceiling (~y15). GATE-TUNE.
const UPPER_HEIGHT_B = 17;

// upperA's second door (its loop door). Side "N": upperA seats at yaw 90° (fixed by its S
// seat door mating the ramp), which maps local +Z ("N") → world +X — so this door faces
// EAST and the descent to `landing` runs into the open void beyond the x=15 wall (a "-Z" or
// "E" door here would send the descent south/back into the authored envelope). GATE-TUNE.
const SECOND_DOOR_A: DoorSpec = {
  side: "N",
  offset: 0,
  width: 1.6,
  height: 2.8,
};
// hallA's second door (the flat closing edge mates it to `landing`). GATE-TUNE.
const SECOND_DOOR_HALL: DoorSpec = {
  side: "N",
  offset: 0,
  width: 1.6,
  height: 2.8,
};
// `landing`'s two doors. The SEAT door (bPortal 0) receives the descending stairs; its
// height 5 is deliberately >= the pillarHall max room height (3.5 + 1.5) so the door spans
// the FULL wall (no lintel). A descending connector arrives ABOVE the room floor, so its
// clearance headroom would clip a normal door's lintel/ceiling; a full-height seat door
// removes the lintel and (via headroom = 5) lets the connector's portal-exemption reach the
// ceiling, so the descent seats clean. The CLOSE door (bPortal 1) mates the flat corridor to
// hallA. GATE-TUNE.
const LANDING_SEAT_DOOR: DoorSpec = {
  side: "N",
  offset: 0,
  width: 2,
  height: 5,
};
const LANDING_CLOSE_DOOR: DoorSpec = {
  side: "E",
  offset: 0,
  width: 1.6,
  height: 2.8,
};

/** The authored level as a pinned collision phantom: EMPTY meshes/instances (main.ts
 *  realizes the level itself, as always), but REAL colliders + bounds so the placer
 *  treats authored geometry as first-class obstacles, and the portals other pieces
 *  attach to. Single-sourced from LEVEL_BOXES — cannot drift from what main.ts builds. */
function authoredPhantom(): RegionData {
  return {
    meshes: [],
    colliders: LEVEL_BOXES.map((b) => ({
      shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
      position: b.center,
    })),
    materials: [],
    connections: [CHAMBER_DOOR, UPPER_PORTAL_A, UPPER_PORTAL_B],
    instances: [],
    origin: [0, 0, 0],
    bounds: aabbOfBoxes(LEVEL_BOXES),
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "authored",
      seed: "authored",
    },
  };
}

/** Resolve a cave's two branch mouths by FACING (position-independent, so it survives seed
 *  changes): the +X (east) mouth deterministically anchors the loop hall; the +Z (north)
 *  mouth carries hallB. The cave entrance is ALSO `kind:"tunnel-mouth"` (facing -Z), so
 *  mouths must be picked by facing, never by "first tunnel-mouth". Setup-loud if the seed's
 *  cave lacks a distinct +X and +Z mouth. */
function caveMouths(caveRegion: RegionData): { east: number; north: number } {
  const east = caveRegion.connections.findIndex(
    (c) => c.kind === "tunnel-mouth" && c.facing[0] === 1,
  );
  const north = caveRegion.connections.findIndex(
    (c) => c.kind === "tunnel-mouth" && c.facing[2] === 1,
  );
  if (east < 0 || north < 0 || east === north) {
    throw new Error(
      `world: cave lacks distinct +X/+Z mouths (east=${east}, north=${north}) — pick a WORLD_SEED that yields both`,
    );
  }
  return { east, north };
}

/** Build the 2.2.5a world graph. Regions generate in LOCAL frame (origin [0,0,0]) —
 *  layoutWorld owns all world placement. */
export function buildWorldGraph(seed: string): WorldGraph {
  const rng = makeRng(seed);
  const caveRegion = cave({
    theme: "cave",
    seed: rng.derive("cave").float().toString(),
    origin: [0, 0, 0],
  });
  const { east, north } = caveMouths(caveRegion);
  const hallA = pillarHall({
    theme: "pillarHall",
    seed: `${seed}-hallA`,
    origin: [0, 0, 0],
    doors: [
      { side: "S", offset: 0, width: 1.6, height: 2.8 },
      SECOND_DOOR_HALL,
    ],
  });
  const hallB = greatHall({
    theme: "greatHall",
    seed: `${seed}-hallB`,
    origin: [0, 0, 0],
  });
  const upperA = pillarHall({
    theme: "pillarHall",
    seed: `${seed}-upA`,
    origin: [0, 0, 0],
    doors: [{ side: "S", offset: 0, width: 2, height: 2.8 }, SECOND_DOOR_A],
  });
  const upperB = pillarHall({
    theme: "pillarHall",
    seed: `${seed}-upB`,
    origin: [0, 0, 0],
  });
  const landing = pillarHall({
    theme: "pillarHall",
    seed: `${seed}-landing`,
    origin: [0, 0, 0],
    doors: [LANDING_SEAT_DOOR, LANDING_CLOSE_DOOR],
  });

  return {
    nodes: [
      {
        id: "authored",
        region: authoredPhantom(),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "cave", region: caveRegion, theme: "cave" },
      { id: "hallA", region: hallA, theme: "pillarHall" },
      { id: "hallB", region: hallB, theme: "greatHall" },
      { id: "upperA", region: upperA, theme: "pillarHall" },
      { id: "upperB", region: upperB, theme: "pillarHall" },
      { id: "landing", region: landing, theme: "pillarHall" },
    ],
    edges: [
      {
        a: "authored",
        b: "cave",
        aPortal: 0,
        bPortal: 0,
        lengthRange: [7, 10],
      },
      { a: "cave", b: "hallA", aPortal: east, bPortal: 0, lengthRange: [2, 6] },
      {
        a: "cave",
        b: "hallB",
        aPortal: north,
        bPortal: 0,
        lengthRange: [2, 6],
      },
      {
        a: "authored",
        b: "upperA",
        aPortal: 1,
        bPortal: 0,
        lengthRange: [8, 13],
        heightDelta: UPPER_HEIGHT,
      },
      {
        a: "authored",
        b: "upperB",
        aPortal: 2,
        bPortal: 0,
        lengthRange: [8, 13],
        heightDelta: UPPER_HEIGHT_B,
        kind: "stairs",
      },
      // Descending hop: forced stairs drop upperA (y≈10) down to the ground `landing`
      // (heightDelta b-above-a = -10). Seats landing in the void east of x=15. Marked
      // `open`: a guardrailed open-air stair descent — the visual gate exercises both
      // enclosure styles (every other edge defaults to the closed tube).
      {
        a: "upperA",
        b: "landing",
        aPortal: 1,
        bPortal: 0,
        lengthRange: [8, 16],
        heightDelta: -10,
        kind: "stairs",
        enclosure: "open",
      },
      // Flat closing hop: landing → hallA on the ground (no heightDelta). This is the
      // cycle-closing edge — hallA already seated off the cave, landing off upperA.
      { a: "landing", b: "hallA", aPortal: 1, bPortal: 1 },
    ],
  };
}
