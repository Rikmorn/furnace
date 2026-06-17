import * as binding from "@furnace/core/binding";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import { vec3 } from "@furnace/core/transform";

/** An axis-aligned box: world-space center + full extents (size along x,y,z).
 *  Doubles as a collider AABB (Task 8). */
export type Box = {
  center: [number, number, number];
  size: [number, number, number];
};

/** A corridor (z from 0 to -16, 3 wide, 3 tall) opening into a cave chamber
 *  (z from -16 to -32, 12 wide, 6 tall). Boxes are walls/floor/ceiling. */
export const LEVEL_BOXES: Box[] = [
  // --- corridor floor + ceiling ---
  { center: [0, 0, -8], size: [3, 0.2, 16] },
  { center: [0, 3, -8], size: [3, 0.2, 16] },
  // corridor walls (east wall split to leave a doorway into the side branch, gap z=-8.5..-11.5)
  { center: [-1.5, 1.5, -8], size: [0.2, 3, 16] },
  { center: [1.5, 1.5, -4.25], size: [0.2, 3, 8.5] },
  { center: [1.5, 1.5, -13.75], size: [0.2, 3, 4.5] },
  // --- cave chamber floor + ceiling ---
  // cave chamber floor — split to leave a 4x4 pit opening (x -2..2, z -22..-26)
  // for the generated grotto you descend into. The opening is smaller than the
  // bowl's mouth so there's trimesh floor under every point of the hole.
  { center: [0, 0, -19], size: [12, 0.2, 6] }, // chamber front floor (z -16..-22): solid base under the generated bumpy chamber sheet so the controller can cross the seam
  { center: [0, 0, -29], size: [12, 0.2, 6] }, // back strip  (z -26..-32)
  { center: [-4, 0, -24], size: [4, 0.2, 4] }, // left strip  (x -6..-2, z -22..-26)
  { center: [4, 0, -24], size: [4, 0.2, 4] }, // right strip (x 2..6, z -22..-26)
  { center: [0, 6, -24], size: [12, 0.2, 16] },
  // chamber walls
  { center: [-6, 3, -24], size: [0.2, 6, 16] },
  { center: [6, 3, -24], size: [0.2, 6, 16] },
  { center: [0, 3, -32], size: [12, 6, 0.2] }, // back wall
  // chamber front wall with the corridor doorway (two side pillars)
  { center: [-4, 3, -16], size: [4, 6, 0.2] },
  { center: [4, 3, -16], size: [4, 6, 0.2] },
  // --- a few stalactite-ish props (scaled boxes for now) ---
  { center: [-3, 4.5, -22], size: [0.4, 3, 0.4] },
  { center: [3.5, 4.8, -27], size: [0.5, 2.4, 0.5] },
  // --- side branch off the corridor (opens east at z≈-10) ---
  { center: [3, 0, -10], size: [6, 0.2, 3] }, // branch floor
  { center: [3, 3, -10], size: [6, 0.2, 3] }, // branch ceiling
  { center: [3, 1.5, -8.5], size: [6, 3, 0.2] }, // branch south wall
  { center: [3, 1.5, -11.5], size: [6, 3, 0.2] }, // branch north wall
  // (no east end wall — the branch's east end opens into the second chamber)
  // --- second (east) chamber the branch leads into ---
  // east chamber floor — split to leave a 2x2 shaft hole (x 12..14, z -5..-7)
  // in the NE corner (clear of the pillar/slab) for the vertical shaft you drop down.
  { center: [8.5, 0, -10], size: [7, 0.2, 12] }, // west of hole (x 5..12)
  { center: [14.5, 0, -10], size: [1, 0.2, 12] }, // east of hole (x 14..15)
  { center: [13, 0, -4.5], size: [2, 0.2, 1] }, // north of hole (z -4..-5)
  { center: [13, 0, -11.5], size: [2, 0.2, 9] }, // south of hole (z -7..-16)
  { center: [10, 6, -10], size: [10, 6, 0.2] }, // back-ish detail handled by walls below
  { center: [10, 3, -4], size: [10, 6, 0.2] }, // south wall
  { center: [10, 3, -16], size: [10, 6, 0.2] }, // north wall
  { center: [15, 3, -10], size: [0.2, 6, 12] }, // east wall
  // (no west wall — the side branch joins the chamber here, over the x=5..6 overlap)
  // --- immovable features (presence that STOPS you) ---
  { center: [9, 1, -8], size: [1, 2, 1] }, // a standing pillar
  { center: [11.5, 0.6, -12], size: [2.4, 1.2, 1.2] }, // a fallen slab
];

export type Level = { meshes: mesh.Mesh[]; boxes: Box[]; destroy: () => void };

/** Build the level: one shared cube geometry + a lit stone material, instanced
 *  as scaled/positioned boxes. Returns meshes (for render) + boxes (for collision). */
export async function buildLevel(ctx: Context): Promise<Level> {
  const cube = geometry.cube(ctx, { size: 1 });
  const lit = await shader.lit(ctx);
  const bind = binding.create(ctx, lit);
  // Matte stone: mid-grey albedo, near-zero specular.
  binding.set(ctx, bind, {
    color: [0.5, 0.5, 0.52, 1],
    specular: [0.02, 0.02, 0.02, 8],
  });
  const stone = await material.create(ctx, { shader: lit, binding: bind });

  const meshes = LEVEL_BOXES.map((b) => {
    const m = mesh.create(ctx, { geometry: cube, material: stone });
    mesh.setPosition(
      ctx,
      m,
      vec3.fromValues(b.center[0], b.center[1], b.center[2]),
    );
    mesh.setScale(ctx, m, vec3.fromValues(b.size[0], b.size[1], b.size[2]));
    return m;
  });

  const destroy = (): void => {
    for (const m of meshes) mesh.destroy(ctx, m);
    material.destroy(ctx, stone);
    binding.destroy(ctx, bind);
    geometry.destroy(ctx, cube);
  };
  return { meshes, boxes: LEVEL_BOXES, destroy };
}

export type Glow = {
  center: [number, number, number];
  color: [number, number, number];
  radius: number;
};
export const LEVEL_GLOWS: Glow[] = [
  { center: [0, 1.2, -30], color: [0.2, 2.6, 1.4], radius: 0.25 }, // eerie green-cyan at the back
  { center: [-4.5, 0.6, -26], color: [2.2, 1.0, 0.3], radius: 0.18 }, // amber (treasure?)
  { center: [4.2, 2.0, -28], color: [1.6, 0.4, 2.4], radius: 0.15 }, // violet
];

export async function buildGlows(
  ctx: Context,
): Promise<{ meshes: mesh.Mesh[]; destroy: () => void }> {
  const sphere = geometry.sphere(ctx, { radius: 1 });
  const unlit = await shader.unlit(ctx);
  // Track each glow's owned resources as a triple so destroy() is exact (no casts).
  const made: {
    mesh: mesh.Mesh;
    material: material.Material;
    binding: binding.Binding;
  }[] = [];
  for (const g of LEVEL_GLOWS) {
    const b = binding.create(ctx, unlit);
    binding.set(ctx, b, { color: [g.color[0], g.color[1], g.color[2], 1] });
    const mat = await material.create(ctx, { shader: unlit, binding: b });
    const m = mesh.create(ctx, { geometry: sphere, material: mat });
    mesh.setPosition(
      ctx,
      m,
      vec3.fromValues(g.center[0], g.center[1], g.center[2]),
    );
    mesh.setScale(ctx, m, vec3.fromValues(g.radius, g.radius, g.radius));
    made.push({ mesh: m, material: mat, binding: b });
  }
  const meshes = made.map((x) => x.mesh);
  const destroy = (): void => {
    for (const x of made) {
      mesh.destroy(ctx, x.mesh);
      material.destroy(ctx, x.material);
      binding.destroy(ctx, x.binding);
    }
    geometry.destroy(ctx, sphere);
  };
  return { meshes, destroy };
}
