// packages/dungeon/src/built.ts
// Masonry collar/cap builders for organic cave mouths (the built↔organic seam's built side).
// The built-interface kit (Slice 2.2.5b-B1). Doctrine: organic pieces PRESENT built
// door-class portals, so every seam collapses to the proven built↔built case. A collar
// is 4 oversized masonry boxes forming a rectangular sleeve whose edges bury themselves
// in the surrounding rock — interpenetration does the masking (no CSG), so it needs no
// isosurface knowledge beyond "the bore fits inside `envelope`". Mining engineering
// grounds the idiom AND the names: a "portal" is the built structure at a tunnel mouth,
// a "collar" its framing (docs/research/2026-07-03-dungeon-2.2.5b-b1-built-interfaces.md §1).
import { quat, vec3 } from "@furnace/core/transform";
import { aabbOfBoxes, type Box, transformAabb } from "./aabb.ts";
import type { Aabb, Connection, Vec3 } from "./region.ts";

const COLLAR_EMBED = 0.8; // depth sunk into the bore, along −facing (m) — GATE-TUNE
const COLLAR_PROUD = 0.4; // depth proud of the rock face, along +facing (m) — GATE-TUNE
const COLLAR_MARGIN = 0.3; // mask margin past the bore envelope (m) — GATE-TUNE
const JAMB_MIN = 0.3; // minimum jamb thickness (m) — GATE-TUNE
const LINTEL_MIN = 0.3; // minimum lintel band height (m) — GATE-TUNE
const SILL_T = 0.3; // sill slab thickness (m), top flush with the mouth floor
const YAW_EPS = 1e-9; // below this, treat the mouth facing as cardinal (no rotation quat)

/** Collar sizing inputs: the presented door and the organic cross-section to mask. */
export type CollarOpts = {
  opening: { width: number; height: number };
  envelope: { width: number; height: number };
};

/** A collar box, yaw-rotated when the mouth facing is off-cardinal. */
export type CollarBox = Box & { rotation?: [number, number, number, number] };

/** Build a masonry collar seated at an organic mouth: two jambs, a lintel, and a sill
 *  forming a sleeve `COLLAR_EMBED + COLLAR_PROUD` deep, oversized past `envelope` so
 *  every edge buries in rock. Returns the boxes (caller frame), the presented
 *  door-class portal at the collar's MID-DEPTH (the "portal sits at the centre of its
 *  wall's thickness" convention — flush connector ends bury half the collar depth,
 *  sealed by construction), and a conservative caller-frame AABB. */
export function mouthCollar(
  mouth: Connection,
  opts: CollarOpts,
): { boxes: CollarBox[]; door: Connection; bounds: Aabb } {
  const { opening, envelope } = opts;
  const outerW = Math.max(
    envelope.width + 2 * COLLAR_MARGIN,
    opening.width + 2 * JAMB_MIN,
  );
  const outerH = Math.max(
    envelope.height + COLLAR_MARGIN,
    opening.height + LINTEL_MIN,
  );
  const depth = COLLAR_EMBED + COLLAR_PROUD;
  const zc = (COLLAR_PROUD - COLLAR_EMBED) / 2;
  const jambW = (outerW - opening.width) / 2;
  const lintelH = outerH - opening.height;
  const local: Box[] = [
    {
      center: [-(opening.width / 2 + jambW / 2), outerH / 2, zc],
      size: [jambW, outerH, depth],
    },
    {
      center: [opening.width / 2 + jambW / 2, outerH / 2, zc],
      size: [jambW, outerH, depth],
    },
    {
      center: [0, opening.height + lintelH / 2, zc],
      size: [outerW, lintelH, depth],
    },
    { center: [0, -SILL_T / 2, zc], size: [outerW, SILL_T, depth] },
  ];
  const yaw = Math.atan2(mouth.facing[0], mouth.facing[2]);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let rotation: [number, number, number, number] | undefined;
  if (Math.abs(yaw) > YAW_EPS) {
    const q = quat.fromAxisAngle(quat.create(), vec3.fromValues(0, 1, 0), yaw);
    rotation = [q[0], q[1], q[2], q[3]] as [number, number, number, number];
  }
  const xf = (p: Vec3): Vec3 => [
    p[0] * c + p[2] * s + mouth.position[0],
    p[1] + mouth.position[1],
    -p[0] * s + p[2] * c + mouth.position[2],
  ];
  const boxes: CollarBox[] = local.map((b) => {
    const out: CollarBox = { center: xf(b.center), size: b.size };
    if (rotation) out.rotation = rotation;
    return out;
  });
  const door: Connection = {
    position: xf([0, 0, zc]),
    facing: [...mouth.facing],
    width: opening.width,
    height: opening.height,
    kind: "door",
  };
  return {
    boxes,
    door,
    bounds: transformAabb(aabbOfBoxes(local), yaw, mouth.position),
  };
}

/** Seal a collared door with a full-depth masonry plug — the "cap" for a generated mouth
 *  the topology didn't use (Warframe caps ≅ DunGen blockers). One box spanning exactly the
 *  presented opening (the collar's jambs/lintel/sill already frame it) and the collar's
 *  full sleeve depth, centred on the door portal (which sits at collar mid-depth). The
 *  capped opening stops being a navigable Connection — the caller removes it from
 *  `connections` and folds these boxes into the region's meshes + colliders. */
export function mouthCap(door: Connection): { boxes: CollarBox[] } {
  const depth = COLLAR_EMBED + COLLAR_PROUD;
  const yaw = Math.atan2(door.facing[0], door.facing[2]);
  let rotation: [number, number, number, number] | undefined;
  if (Math.abs(yaw) > YAW_EPS) {
    const q = quat.fromAxisAngle(quat.create(), vec3.fromValues(0, 1, 0), yaw);
    rotation = [q[0], q[1], q[2], q[3]] as [number, number, number, number];
  }
  const box: CollarBox = {
    center: [
      door.position[0],
      door.position[1] + door.height / 2,
      door.position[2],
    ],
    size: [door.width, door.height, depth],
  };
  if (rotation) box.rotation = rotation;
  return { boxes: [box] };
}
