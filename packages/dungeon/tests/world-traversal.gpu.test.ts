// W1 Task 8 — THE PROBE. The slice's fail-fast reason to exist in this order: walk the
// player capsule cave A → tunnel → cave B on the FULL default-world collider set, built
// exactly as the game builds it (`loadWorld` against an IN-MEMORY bake, NOT a hand-picked
// subset — the 2.2.1 lesson: subset repros hide the seam wedge). It converts the
// region↔connector seam class into a hard headless assert: NO WEDGE/STALL, NO GHOST-LAUNCH,
// NO FALL-THROUGH — forward, reverse, and along both tunnel walls. It is WALK-IN, not
// drop-in: dropping a capsule rests it on top and hides the wedge, so this drives the real
// CharacterMover along the path across the two cave↔tunnel seams. The shared drive loop +
// world-loading fixture live in `_helpers/walk-fixture.ts`; `tunnelPortals` + the four lanes
// stay here (default-world-specific).
import { expect, test } from "bun:test";
import type { WorldManifest } from "../src/bake.ts";
import type { Connection, Vec3 } from "../src/region.ts";
import { DEFAULT_WORLD } from "../src/world-spec.ts";
import { bunWebGpuAvailable, ensureBunWebGpu } from "./_helpers/gpu-fixture.ts";
import {
  along,
  REST_OFFSET,
  runWalk,
  SPAWN_RISE,
  WALL_HUG_ITERS,
  WALL_HUG_OFFSET,
  withLoadedWorld,
} from "./_helpers/walk-fixture.ts";

await ensureBunWebGpu();

/** The tunnel's two placed portals + its axis, from the baked manifest. `a` is cave A's door
 *  (facing OUTWARD toward the tunnel), `b` is cave B's door; `dir = a.facing` is the cardinal
 *  tunnel axis pointing A → B. */
function tunnelPortals(manifest: WorldManifest): {
  a: Connection;
  b: Connection;
  dir: Vec3;
} {
  const c = manifest.connectors[0];
  if (!c) throw new Error("world-traversal: manifest has no connector");
  return { a: c.a, b: c.b, dir: [c.a.facing[0], c.a.facing[1], c.a.facing[2]] };
}

// Probe (i): forward walk cave A → tunnel → cave B, from the game spawn.
test.skipIf(!bunWebGpuAvailable())(
  "forward walk cave A -> tunnel -> cave B: no wedge/launch/fall-through, enters cave B",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest, loaded }) => {
      const { a, b, dir } = tunnelPortals(manifest);
      const bAlong = along(b.position, dir);
      const res = runWalk(ctx, world, {
        start: loaded.playerStart, // the baked game spawn (2 m inside cave A, on the axis)
        dir,
        stopAlong: bAlong + 4, // cave B's far side
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 4,
      });
      // ENTERED cave B: advanced past cave B's door along the axis.
      expect(res.advanced).toBeGreaterThan(bAlong + 2);
    });
  },
);

// Probe (ii): reverse walk cave B → cave A.
test.skipIf(!bunWebGpuAvailable())(
  "reverse walk cave B -> cave A: no wedge/launch/fall-through, enters cave A",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, b, dir } = tunnelPortals(manifest);
      const revDir: Vec3 = [-dir[0], -dir[1], -dir[2]];
      // Spawn ~2 m inside cave B (along +dir past its door), raised to rest height.
      const start: Vec3 = [
        b.position[0] + dir[0] * 2,
        b.position[1] + REST_OFFSET + SPAWN_RISE,
        b.position[2] + dir[2] * 2,
      ];
      const aAlongRev = along(a.position, revDir); // cave A's door along the reverse axis
      const res = runWalk(ctx, world, {
        start,
        dir: revDir,
        stopAlong: aAlongRev + 4, // cave A's far side
        floorY: b.position[1] - 1,
        ceilY: b.position[1] + 4,
      });
      // ENTERED cave A: advanced past cave A's door along the reverse axis.
      expect(res.advanced).toBeGreaterThan(aAlongRev + 2);
    });
  },
);

// Probe (iii): wall-hug lanes — two forward walks offset ±WALL_HUG_OFFSET perpendicular to the
// axis, so the capsule crosses both connector↔region seams off-centre. Each lane runs in its
// OWN freshly-loaded world: the cave dressing is shovable, so a shared world would let one lane
// displace obstacles for the next, masking that lane's real path.
for (const sign of [1, -1]) {
  test.skipIf(!bunWebGpuAvailable())(
    `wall-hug lane (${sign > 0 ? "+" : "-"}) crosses both seams off-centre: no wedge/launch, reaches the cave B exit`,
    async () => {
      await withLoadedWorld(
        DEFAULT_WORLD,
        ({ ctx, world, manifest, loaded }) => {
          const { a, b, dir } = tunnelPortals(manifest);
          const perp: Vec3 = [-dir[2], 0, dir[0]]; // unit perpendicular cardinal
          const bAlong = along(b.position, dir);
          const start: Vec3 = [
            loaded.playerStart[0] + perp[0] * WALL_HUG_OFFSET * sign,
            loaded.playerStart[1],
            loaded.playerStart[2] + perp[2] * WALL_HUG_OFFSET * sign,
          ];
          const res = runWalk(ctx, world, {
            start,
            dir,
            stopAlong: bAlong + 1, // just into cave B past the tunnel exit
            floorY: a.position[1] - 1,
            ceilY: a.position[1] + 4,
            maxIters: WALL_HUG_ITERS,
          });
          // Slid the full tunnel off-centre: reached the exit near cave B's door.
          expect(res.advanced).toBeGreaterThan(bAlong - 1);
        },
      );
    },
  );
}
