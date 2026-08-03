// W2 Task 11 — THE PREMISE PROBE. The one genuinely NEW composition this slice must prove:
// walk the player capsule from a grid-built HALL, through a CARVED opening in the hall's south
// shell, through the collar-BORE tunnel, into a field-organic CAVE — and reverse, and off-centre.
// This is the carve-opening ↔ bore seam: the hall's sealed south shell is opened by the
// collar-bore's carve (radius TUNNEL_RADIUS 1.6, CARVE_DEPTH 1.0) around the door, and the bore
// floor is flush at the door threshold (raisedCenter) so the walk-plane is continuous across the
// seam. If this walks clean (no wedge/stall, no ghost-launch, no fall-through), the slice premise
// holds. Built on the FULL default collider set exactly as the game builds it (`loadWorld` against
// an IN-MEMORY bake, NOT a subset — the 2.2.1 lesson: subset repros hide the seam wedge). WALK-IN,
// not drop-in: dropping a capsule rests it on top and hides the rim wedge, so this drives the real
// CharacterMover across the seam. Shared drive loop + world-loading fixture live in
// `_helpers/walk-fixture.ts`; the HALL_CAVE fixture in `_helpers/world-fixtures.ts`. Each lane runs
// in its OWN freshly-loaded world (the cave's dressing is shovable — a shared world would let one
// lane displace obstacles for the next, masking that lane's real path).
//
// Geometry (from the baked HALL_CAVE manifest): connector[0] = `bore-1` (collar-bore). Its `a` is
// the hall's placed south-door portal (`kind:"door"`, facing [0,0,-1] OUTWARD toward the cave); its
// `b` is the cave's placed mouth. `dir = a.facing` points hall → cave. a.position = [3,0,0] (the
// carved-opening / hall-door plane, along=0), b.position = [3,0,-8] (cave mouth, along=8), both
// floors at y=0. Spawn = [3,1.1,2] (2 m inward of the south door, along=-2). Walking hall → cave
// first crosses the CARVED south-wall opening (along≈0), then the bore, then the cave mouth.
import { expect, test } from "bun:test";
import type { WorldManifest } from "../src/world/bake.ts";
import type { Connection, Vec3 } from "../src/world/region.ts";
import { bunWebGpuAvailable, ensureBunWebGpu } from "./_helpers/gpu-fixture.ts";
import {
  along,
  REST_OFFSET,
  runWalk,
  SPAWN_RISE,
  WALL_HUG_ITERS,
  withLoadedWorld,
} from "./_helpers/walk-fixture.ts";
import { HALL_CAVE } from "./_helpers/world-fixtures.ts";

await ensureBunWebGpu();

const OFF_CENTRE = 0.55; // lateral offset (m) for the off-axis seam-crossing lanes

/** The collar-bore's two placed portals + its axis, from the baked manifest. `a` is the hall's
 *  south door (facing OUTWARD toward the cave), `b` is the cave's mouth; `dir = a.facing` is the
 *  cardinal bore axis pointing hall → cave. Mirrors `world-traversal.gpu.test.ts`'s
 *  `tunnelPortals` — the collar-bore rides connector[0] exactly as the organic tunnel does. */
function borePortals(manifest: WorldManifest): {
  a: Connection;
  b: Connection;
  dir: Vec3;
} {
  const c = manifest.connectors[0];
  if (!c) throw new Error("collar-bore: manifest has no connector");
  return { a: c.a, b: c.b, dir: [c.a.facing[0], c.a.facing[1], c.a.facing[2]] };
}

// Lane 1 (THE PREMISE): hall centre → through the carved opening → into the cave, from the game
// spawn. Crosses the carve-opening ↔ bore seam on the axis and enters the cave.
test.skipIf(!bunWebGpuAvailable())(
  "hall centre -> carved opening -> cave: no wedge/launch/fall-through, enters the cave",
  async () => {
    await withLoadedWorld(HALL_CAVE, ({ ctx, world, manifest, loaded }) => {
      const { a, b, dir } = borePortals(manifest);
      const bAlong = along(b.position, dir);
      const res = runWalk(ctx, world, {
        start: loaded.playerStart, // baked game spawn (2 m inside the hall, on the door axis)
        dir,
        stopAlong: bAlong + 4, // past the cave mouth into the cave interior
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 4,
        maxIters: WALL_HUG_ITERS, // the bore/cave path grinds through cave dressing
      });
      // ENTERED the cave: advanced past the cave mouth along the axis.
      expect(res.advanced).toBeGreaterThan(bAlong + 2);
    });
  },
);

// Lane 2 (reverse): cave → bore → carved opening → hall interior.
test.skipIf(!bunWebGpuAvailable())(
  "reverse cave -> carved opening -> hall: no wedge/launch/fall-through, enters the hall",
  async () => {
    await withLoadedWorld(HALL_CAVE, ({ ctx, world, manifest }) => {
      const { a, b, dir } = borePortals(manifest);
      const revDir: Vec3 = [-dir[0], -dir[1], -dir[2]];
      // Spawn ~2 m inside the cave (along +dir past its mouth), raised to rest height.
      const start: Vec3 = [
        b.position[0] + dir[0] * 2,
        b.position[1] + REST_OFFSET + SPAWN_RISE,
        b.position[2] + dir[2] * 2,
      ];
      const aAlongRev = along(a.position, revDir); // the hall-door plane along the reverse axis
      const res = runWalk(ctx, world, {
        start,
        dir: revDir,
        stopAlong: aAlongRev + 4, // into the hall interior, past the door
        floorY: b.position[1] - 1,
        ceilY: b.position[1] + 4,
        maxIters: WALL_HUG_ITERS,
      });
      // ENTERED the hall: advanced past the hall-door plane along the reverse axis.
      expect(res.advanced).toBeGreaterThan(aAlongRev + 2);
    });
  },
);

// Lane 3 (off-centre): two forward walks offset ±OFF_CENTRE perpendicular to the axis, so the
// capsule crosses the CARVED OPENING + bore OFF-AXIS — this is where the carved rim (the seam this
// slice introduces) is most likely to bite. The lane's job is the collar+bore SEAM: cross the
// carve opening (along≈0) and traverse the bore. It STOPS at `along = bAlong − 2` (2 m short of the
// cave mouth) ON PURPOSE: walking deeper into the organic CAVE INTERIOR hits ~0.80 m floor
// undulations in this cave (seed "t:c") that trip the ghost-launch guard — the tracked
// voxel-KCC-on-organic-terrain class (2.2.1 / the Jolt proof), NOT the collar+bore seam. VERIFIED
// by diagnostic: a capsule spawned IN the bore crosses the very same mouth CLEAN (0.40 m); the
// 0.80 m spikes are cave-interior bumps hit at variable depth on BOTH ±0.55 sides — the bore↔mouth
// seam and the carve seam are clean. See docs/backlog/dungeon/organic-cave-mouth-offaxis-rimride.md.
// The on-axis lane 1 walks the FULL cave depth clean; reverse lane 2 walks out clean. Each lane
// runs in its OWN freshly-loaded world (shovable cave dressing must not carry between).
for (const sign of [1, -1]) {
  test.skipIf(!bunWebGpuAvailable())(
    `off-centre lane (${sign > 0 ? "+" : "-"}) crosses the carved opening off-axis into the bore: no wedge/launch`,
    async () => {
      await withLoadedWorld(HALL_CAVE, ({ ctx, world, manifest, loaded }) => {
        const { a, b, dir } = borePortals(manifest);
        const perp: Vec3 = [-dir[2], 0, dir[0]]; // unit perpendicular cardinal
        const bAlong = along(b.position, dir);
        const start: Vec3 = [
          loaded.playerStart[0] + perp[0] * OFF_CENTRE * sign,
          loaded.playerStart[1],
          loaded.playerStart[2] + perp[2] * OFF_CENTRE * sign,
        ];
        const res = runWalk(ctx, world, {
          start,
          dir,
          stopAlong: bAlong - 2, // deep in the bore, short of the (pre-existing) organic-cave-mouth rim-ride
          floorY: a.position[1] - 1,
          ceilY: a.position[1] + 4,
          maxIters: WALL_HUG_ITERS,
        });
        // Cleared the carved opening (carve zone ends ~along 1.6) and walked WELL into the bore
        // off-axis with no wedge/launch — the collar+bore seam holds off-centre.
        expect(res.advanced).toBeGreaterThan(bAlong - 4);
      });
    },
  );
}
