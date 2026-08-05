// packages/dungeon/scripts/bake-default-world.ts
// Bake the committed default FIELD world (v2 artifact) the game boots at runtime:
// a purpose-built minimal recipe — a pillared masonry hall, a masonry wall slab, a
// short tunnel north, and an organic cave with a mossed mouth — written into the
// tracked `worlds/default/`.
//
// The recipe is the SPEC: everything below is seeded and params-determined, so a
// re-bake writes byte-identical files. A `git status` diff after a re-bake is a
// determinism bug, not a re-roll. Nothing here may read the clock, `Math.random`,
// or the environment.
//
// The world exists to exercise the runtime loader end to end, so the file set is
// deliberately complete: density chunks, per-class `.fmesh` buckets including a kit
// BACKING bucket, `.mat` siblings (from the paint op's indexed materials), kit
// instance files, the embedded 4-class material table, and the op log the editor's
// field/legacy classifier keys on.
//
// Run (from packages/dungeon): bun run bake:default
import { rm } from "node:fs/promises";
import { join } from "node:path";
import * as field from "@furnace/core/field";
import { AGENT } from "../src/agent/walkability.ts";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const WORLD_NAME = "default";
const WORLD_DIR = join(PACKAGE_ROOT, "worlds", WORLD_NAME);

/** Hard ceiling on the committed bake. The default world is a fixture every clone
 *  carries and every boot fetches — it earns its bytes by being small. */
const MAX_BAKED_BYTES = 1024 * 1024;

/** The canonical committed catalog: two plain organics (rock, dirt), one accent
 *  organic (moss-stone) and one kit class (masonry) carrying its {@link
 *  field.KitStyle}. Class ids ARE array indices — `validateMaterialTable` enforces
 *  it. `dirt` is authored but unused by this recipe: the table is the world's
 *  palette, and a paint/fill op can reach for it without a re-bake of the catalog. */
const MATERIALS: field.MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.62, 0.6, 0.58, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.45, 0.36, 0.26, 1] },
    {
      id: 2,
      name: "moss-stone",
      kind: "organic",
      color: [0.38, 0.52, 0.42, 1],
    },
    {
      id: 3,
      name: "masonry",
      kind: "kit",
      color: [0.55, 0.53, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.34, 0.32, 0.3, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
};

const MAT_MOSS_STONE = 2;
const MAT_MASONRY = 3;

/** The built-kit lattice pitch (m) — the unit the hall generator's `*Cells` params
 *  count, and the grid every kit-class write must land on. */
const CELL = 0.5;

// ─── the hall (structure) ───

const HALL_ORIGIN: [number, number, number] = [0, 0, 0];
const HALL_WIDTH_CELLS = 10;
const HALL_HEIGHT_CELLS = 6;
const HALL_DEPTH_CELLS = 10;
const HALL_PILLAR_SPACING_CELLS = 3;
/** The hall's structure is params-determined; the seed is recorded provenance only
 *  (`usesSeed: false` on the generator def). */
const HALL_SEED = 1;
/** Half the hall's north doorway (m). The generator's doorway is 4 coarse cells
 *  wide and auto-centres on its wall when no offset is given, so with an EVEN
 *  `HALL_WIDTH_CELLS` it is centred on the hall's own x centre — which is what lets
 *  the tunnel below derive its lane from the hall footprint alone. */
const DOOR_HALF_WIDTH = 2 * CELL;

/** The hall's world AABB. The generator anchors its stamp at `region.min` snapped
 *  down to the lattice and grows a `dims + 2` masonry shell around the interior, so
 *  the footprint is fully determined by the origin and the three cell counts. */
function hallFootprint(): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const span = (cells: number): number => (cells + 2) * CELL;
  return {
    min: HALL_ORIGIN,
    max: [
      HALL_ORIGIN[0] + span(HALL_WIDTH_CELLS),
      HALL_ORIGIN[1] + span(HALL_HEIGHT_CELLS),
      HALL_ORIGIN[2] + span(HALL_DEPTH_CELLS),
    ],
  };
}

/** The walkable floor plane (m): the top face of the hall shell's one-cell floor
 *  band. The cave and the tunnel are placed to land on this SAME plane, so the
 *  whole world is one level and no traversal depends on a step-up. */
const FLOOR_Y = HALL_ORIGIN[1] + CELL;

// ─── the masonry wall slab (kit coverage) ───

/** A freestanding masonry panel spanning the hall's west aisle, from the west wall
 *  to the pillar row. Lattice-aligned on every face — `assertOpValid` REQUIRES that
 *  of a kit-class write, and the skinner needs it to emit whole panels. */
const SLAB_MIN: [number, number, number] = [CELL, FLOOR_Y, 6 * CELL];
const SLAB_MAX: [number, number, number] = [
  4 * CELL,
  FLOOR_Y + 4 * CELL,
  7 * CELL,
];

// ─── the cave (organic variety) ───

/** The cave's region, sized and placed so its sample span sits inside 3×1×2 chunks
 *  — the bake writes one 4 KB density file per touched chunk, so the region bounds
 *  ARE the size budget. `min[1]` is one cell below {@link FLOOR_Y} because the
 *  generator floor-anchors its chambers one cell above the region floor. */
const CAVE_MIN: [number, number, number] = [-4, FLOOR_Y - 0.25, 8];
const CAVE_MAX: [number, number, number] = [7.75, FLOOR_Y + 3.25, 15.75];
/** PICKED, not arbitrary: the mouth passage a seed carves inward from the south
 *  face angles toward whichever chamber is nearest, so some seeds put a rock nose
 *  square in front of the tunnel and a player walking straight out of it wedges a
 *  couple of metres in. Seed 8 was chosen by driving the real `CharacterMover`
 *  straight north out of the spawn on each candidate — it runs ~12.9 m before any
 *  wall, then ~4.8 m west and ~2.0 m east inside the chamber, and walks the whole
 *  way back. Re-roll this only against that same measurement. */
const CAVE_SEED = 8;
/** The south mouth's lateral offset (m from the region's min-x corner), chosen so
 *  the mouth lands on the hall's door lane. */
const CAVE_MOUTH_OFFSET_M = 7;

// ─── the tunnel (hall ↔ cave) ───

/** How far past the cave's south face the tunnel reaches (m) — deep enough to meet
 *  the mouth passage the cave carves inward from that face. */
const TUNNEL_REACH_M = 1;
/** Standing headroom the tunnel carves above {@link FLOOR_Y} (m). */
const TUNNEL_HEIGHT_M = 2.5;

// ─── the moss (indexed-material coverage) ───

/** The mossed patch around the cave mouth: a paint sphere over the tunnel end and
 *  the cave's first metres. Paint touches SOLID cells only, so it re-materials the
 *  surrounding rock without moving a single surface. Sized to stop short of the
 *  hall's north face, which is kit masonry — painting an organic class over it
 *  would silently un-skin that wall. */
const MOSS_RADIUS_M = 2.5;

// ─── the recipe ───

/** Applies the whole recipe to a fresh store + log, in the ONE order that makes it
 *  well-formed: the cave commits under `replace` (which overwrites its whole
 *  region), so the tunnel that punches through the cave's south face has to be dug
 *  AFTER it, and the moss that re-materials the tunnel walls after that. */
function buildDefaultWorld(): { store: field.FieldStore; log: field.OpLog } {
  const store = field.createFieldStore();
  const log = field.createOpLog();
  const hall = hallFootprint();

  field.commitGenerator(store, log, field.generatorById("hall"), {
    params: {
      width: HALL_WIDTH_CELLS,
      height: HALL_HEIGHT_CELLS,
      depth: HALL_DEPTH_CELLS,
      pillars: "colonnade",
      pillarSpacing: HALL_PILLAR_SPACING_CELLS,
      doorNorth: true,
      doorSouth: false,
      doorEast: false,
      doorWest: false,
    },
    seed: HALL_SEED,
    region: hall,
    policy: "replace",
    table: MATERIALS,
  });

  field.logApply(
    store,
    log,
    boxFill(SLAB_MIN, SLAB_MAX, MAT_MASONRY),
    MATERIALS,
  );

  field.commitGenerator(store, log, field.generatorById("cave"), {
    params: {
      theme: "organic",
      chambers: 3,
      chamberRadius: 3,
      verticality: 0.2,
      roughness: 0.6,
      extraLoops: 0,
      doorNorth: false,
      doorSouth: true,
      doorEast: false,
      doorWest: false,
      doorSouthOffset: CAVE_MOUTH_OFFSET_M,
    },
    seed: CAVE_SEED,
    region: { min: CAVE_MIN, max: CAVE_MAX },
    policy: "replace",
    table: MATERIALS,
  });

  const laneX = (hall.min[0] + hall.max[0]) / 2;
  field.logApply(
    store,
    log,
    boxDig(
      [laneX - DOOR_HALF_WIDTH, FLOOR_Y, hall.max[2] - CELL],
      [
        laneX + DOOR_HALF_WIDTH,
        FLOOR_Y + TUNNEL_HEIGHT_M,
        CAVE_MIN[2] + TUNNEL_REACH_M,
      ],
    ),
    MATERIALS,
  );

  field.logApply(
    store,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "paint",
      material: MAT_MOSS_STONE,
      shape: {
        kind: "sphere",
        center: [laneX, FLOOR_Y + 0.75, CAVE_MIN[2] + TUNNEL_REACH_M],
        radius: MOSS_RADIUS_M,
      },
    },
    MATERIALS,
  );

  return { store, log };
}

/** A fill op over the axis-aligned box `min..max`, in the material `material`. */
function boxFill(
  min: [number, number, number],
  max: [number, number, number],
  material: number,
): field.BrushOp {
  return {
    id: 0,
    kind: "brush",
    effect: "fill",
    material,
    shape: box(min, max),
  };
}

/** A dig op over the axis-aligned box `min..max`. */
function boxDig(
  min: [number, number, number],
  max: [number, number, number],
): field.BrushOp {
  return { id: 0, kind: "brush", effect: "dig", shape: box(min, max) };
}

/** The brush's centre/half-extents spelling of an axis-aligned box. */
function box(
  min: [number, number, number],
  max: [number, number, number],
): field.BrushShape {
  return {
    kind: "box",
    center: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ],
    halfExtents: [
      (max[0] - min[0]) / 2,
      (max[1] - min[1]) / 2,
      (max[2] - min[2]) / 2,
    ],
  };
}

/** Where the player wakes up: on the hall floor, one half-metre in from the south
 *  wall's interior face, on the door lane, facing +Z — down the colonnade, through
 *  the doorway, toward the tunnel and the cave beyond. Derived from the hall's
 *  generated footprint and the agent catalog's own capsule, never from a literal:
 *  the capsule rests with its CENTRE `radius + halfHeight` above the floor it
 *  stands on, and spawning a touch above that lets the first frame settle rather
 *  than resolve a penetration. */
function playerSpawn(): { start: [number, number, number]; yaw: number } {
  const hall = hallFootprint();
  const restOffset = AGENT.capsule.radius + AGENT.capsule.halfHeight;
  const settleRise = 0.1;
  return {
    start: [
      (hall.min[0] + hall.max[0]) / 2,
      FLOOR_Y + restOffset + settleRise,
      hall.min[2] + CELL + 0.5,
    ],
    // The FpController's forward is (-sin yaw, ·, -cos yaw), so yaw π faces +Z.
    yaw: Math.PI,
  };
}

const byteLength = (contents: string | Uint8Array): number =>
  typeof contents === "string"
    ? new TextEncoder().encode(contents).byteLength
    : contents.byteLength;

const { store, log } = buildDefaultWorld();
const { start, yaw } = playerSpawn();
const files = field.bakeFieldWorld(store, log, MATERIALS, {
  name: WORLD_NAME,
  playerStart: start,
  playerYaw: yaw,
});

const total = files.reduce((sum, f) => sum + byteLength(f.contents), 0);
if (total > MAX_BAKED_BYTES) {
  throw new Error(
    `bake-default-world: ${total} bytes exceeds the ${MAX_BAKED_BYTES}-byte budget — shrink the recipe's regions, not the budget`,
  );
}

// Delete-then-write: the emitted file SET shifts whenever the recipe's chunk or
// bucket set does, and a blind write leaves the difference behind as tracked,
// never-fetched dead bytes.
await rm(WORLD_DIR, { recursive: true, force: true });
for (const file of files)
  await Bun.write(join(PACKAGE_ROOT, file.path), file.contents);

console.log(
  `baked "${WORLD_NAME}": ${files.length} file(s), ${total} bytes (budget ${MAX_BAKED_BYTES})`,
);
console.log(
  `  chunks ${store.chunks.size}, ops ${log.ops.length}, spawn [${start.join(", ")}] yaw ${yaw}`,
);
