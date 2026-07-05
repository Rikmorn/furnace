// packages/dungeon/src/locus.ts
// Pure candidate-locus math for the placement engine: continuous seeded sampling of the
// annular cone a connector can reach (replacing the B2-era 5-length × 7-yaw grid whose
// position poverty was the measured placement-wall root cause), plus the pair-feasibility
// predicate used for forward checking. No occupancy, no RegionData — Connections in,
// candidate target portals out.
import type { Rng } from "@furnace/core/rng";
import type { Connection, Vec3 } from "./region.ts";

/** Straight connectors mate portals facing within 60° of the line between them (both
 *  ends). Moved from layout.ts — the geometric contract is locus math. */
export const FACING_MIN = Math.cos(Math.PI / 3);
/** Sampling half-window on the seating bearing (≤ the 60° facing cone). GATE-TUNE. */
export const MAX_BEARING_OFF = Math.PI / 4;
/** Default per-(binding, refinement) sample count. GATE-TUNE. */
export const LOCUS_SAMPLES = 24;

/** One candidate seating: the world portal the node's bound portal will join onto.
 *  `join(target, nodePortal)` then fixes the piece placement (yaw slaved to mating). */
export type SeatCandidate = { target: Connection };

/** Do two placed portals face each other within the straight-connector cones, at a
 *  horizontal run inside `lengthRange`? The forward-checking primitive (and route
 *  pre-filter). Vertical delta is NOT checked here — edges carry exact heights. */
export function pairFeasible(
  a: Connection,
  b: Connection,
  lengthRange: [number, number],
): boolean {
  const dx = b.position[0] - a.position[0];
  const dz = b.position[2] - a.position[2];
  const run = Math.hypot(dx, dz);
  if (run < lengthRange[0] - 1e-9 || run > lengthRange[1] + 1e-9) return false;
  if (run < 1e-6) return false;
  const dirX = dx / run;
  const dirZ = dz / run;
  const fa = a.facing[0] * dirX + a.facing[2] * dirZ;
  const fb = -(b.facing[0] * dirX + b.facing[2] * dirZ);
  return fa >= FACING_MIN && fb >= FACING_MIN;
}

/** Rotate a horizontal unit facing by `off` about Y (Ry convention, matches connect.ts). */
function bear(facing: Vec3, off: number): Vec3 {
  const c = Math.cos(off);
  const s = Math.sin(off);
  return [facing[0] * c + facing[2] * s, 0, -facing[0] * s + facing[2] * c];
}

/** Seeded stratified samples over the annular cone reachable from `parent`: bearing in
 *  ±MAX_BEARING_OFF, length in `lengthRange`, height at exactly `dhSigned`. The FIRST
 *  candidate is canonical (shortest length, dead ahead) so simple worlds are stable
 *  run-to-run; the rest are stratified with in-stratum jitter. The returned target's
 *  facing is the outward bearing — `join` seats the node portal exactly opposite, so the
 *  b-side facing check passes by construction and the a-side passes because the bearing
 *  window is inside the cone. */
export function sampleSeatLoci(
  parent: Connection,
  lengthRange: [number, number],
  dhSigned: number,
  rng: Rng,
  n: number,
): SeatCandidate[] {
  const [lo, hi] = lengthRange;
  const mk = (off: number, len: number): SeatCandidate => {
    const dir = bear(parent.facing, off);
    return {
      target: {
        position: [
          parent.position[0] + dir[0] * len,
          parent.position[1] + dhSigned,
          parent.position[2] + dir[2] * len,
        ],
        facing: dir,
        width: parent.width,
        height: parent.height,
        kind: "door",
      },
    };
  };
  const out: SeatCandidate[] = [mk(0, lo)];
  // Stratify: ~sqrt layout over (bearing × length) so both axes get coverage.
  const nB = Math.max(2, Math.round(Math.sqrt(n)));
  const nL = Math.max(2, Math.ceil(n / nB));
  for (let i = 0; i < nB; i++) {
    for (let j = 0; j < nL; j++) {
      const u = (i + rng.float()) / nB;
      const v = (j + rng.float()) / nL;
      out.push(
        mk(-MAX_BEARING_OFF + u * 2 * MAX_BEARING_OFF, lo + v * (hi - lo)),
      );
    }
  }
  return out;
}
