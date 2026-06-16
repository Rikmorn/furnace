// packages/dungeon/src/props.ts
import * as binding from "@furnace/core/binding";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as physics from "@furnace/core/physics";
import * as shader from "@furnace/core/shader";
import { quat, vec3 } from "@furnace/core/transform";

const COUNT = 12;
const HALF = 0.25; // prop half-extent (a 0.5 cube)

type Prop = { mesh: mesh.Mesh; body: physics.Body };

export type Props = {
  meshes: mesh.Mesh[];
  update: () => void;
  destroy: () => void;
};

/** Build ~a dozen dynamic cuboid props in `world`, clustered (and lightly stacked)
 *  in the east chamber so the player can shove them and watch them fall/settle.
 *  Each prop's mesh follows its body each frame via {@link Props.update}. */
export async function buildProps(
  ctx: Context,
  world: physics.World,
): Promise<Props> {
  const cube = geometry.cube(ctx, { size: HALF * 2 });
  const lit = await shader.lit(ctx);
  const bind = binding.create(ctx, lit);
  binding.set(ctx, bind, {
    color: [0.45, 0.4, 0.35, 1], // weathered crate/rubble
    specular: [0.05, 0.05, 0.05, 16],
  });
  const mat = await material.create(ctx, { shader: lit, binding: bind });

  // Deterministic placement (no Math.random — vary by index). Cluster + a small stack.
  const props: Prop[] = Array.from({ length: COUNT }, (_, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const px = 8 + col * 0.6 + (row % 2) * 0.2;
    const pz = -9 - row * 0.6;
    const py = HALF + 0.02 + (i % 3) * (HALF * 2.05); // some resting, some stacked
    const m = mesh.create(ctx, { geometry: cube, material: mat });
    mesh.setPosition(ctx, m, vec3.fromValues(px, py, pz));
    const body = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { cuboid: [HALF, HALF, HALF] },
      position: [px, py, pz],
      friction: 0.8,
    });
    return { mesh: m, body };
  });

  const p = vec3.create();
  const r = quat.create();
  const update = (): void => {
    for (const prop of props) {
      physics.getBodyTranslation(ctx, prop.body, p);
      physics.getBodyRotation(ctx, prop.body, r);
      mesh.setPosition(ctx, prop.mesh, p);
      mesh.setRotation(ctx, prop.mesh, r);
    }
  };

  const destroy = (): void => {
    for (const prop of props) {
      mesh.destroy(ctx, prop.mesh);
      physics.destroyBody(ctx, prop.body);
    }
    material.destroy(ctx, mat);
    binding.destroy(ctx, bind);
    geometry.destroy(ctx, cube);
  };

  return { meshes: props.map((x) => x.mesh), update, destroy };
}
