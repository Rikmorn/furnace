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
const FLOOR_TOP = 0.1; // chamber2 floor top (box [10,0,-10] size[10,0.2,12])
const REST_Y = FLOOR_TOP + HALF; // 0.35 — a prop resting on the floor
const STACK_COUNT = 4; // a 4-high tower to topple
const STACK_X = 7;
const STACK_Z = -10;

type Prop = { mesh: mesh.Mesh; body: physics.Body };

export type Props = {
  meshes: mesh.Mesh[];
  bodies: physics.Body[];
  update: () => void;
  destroy: () => void;
};

/** Build a dozen dynamic cuboid props in `world`: a 4-high tower to topple plus
 *  an 8-prop floor cluster, in the east chamber so the player can shove them and
 *  watch them fall/settle. Each prop's mesh follows its body each frame via
 *  {@link Props.update}. */
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

  // Deterministic placement (no Math.random — vary by index): a 4-high tower
  // to topple, plus an 8-prop floor cluster. All rest cleanly on the chamber2
  // floor, clear of the immovable pillar (x≥8.5) and slab (x≥10.3).
  const props: Prop[] = Array.from({ length: COUNT }, (_, i) => {
    let px: number;
    let py: number;
    let pz: number;
    if (i < STACK_COUNT) {
      px = STACK_X;
      pz = STACK_Z;
      py = REST_Y + i * (HALF * 2 + 0.01); // stacked, tiny gap to settle
    } else {
      const j = i - STACK_COUNT; // 0..7
      const col = j % 4;
      const row = Math.floor(j / 4);
      px = 6.5 + col * 0.6; // centres 6.5..8.3
      pz = -11 - row * 0.7; // centres -11..-11.7 — south of the pillar (z≥-8.5) and west of the slab (x≥10.3), so clear of both features
      py = REST_Y;
    }
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

  return {
    meshes: props.map((x) => x.mesh),
    bodies: props.map((x) => x.body),
    update,
    destroy,
  };
}
