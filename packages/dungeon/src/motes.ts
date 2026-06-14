import * as binding from "@furnace/core/binding";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import { vec3 } from "@furnace/core/transform";

const COUNT = 24;
const SPREAD = 4; // drift volume half-size around the player

export async function buildMotes(ctx: Context): Promise<{
  meshes: mesh.Mesh[];
  update: (center: [number, number, number], dt: number) => void;
  destroy: () => void;
}> {
  const dot = geometry.sphere(ctx, { radius: 0.012 });
  const unlit = await shader.unlit(ctx);
  const bind = binding.create(ctx, unlit);
  binding.set(ctx, bind, { color: [0.9, 0.8, 0.6, 1] });
  const mat = await material.create(ctx, {
    shader: unlit,
    binding: bind,
    blend: material.blend.additive,
  });

  // Deterministic offsets/phases (no Math.random — vary by index).
  const motes = Array.from({ length: COUNT }, (_, i) => {
    const m = mesh.create(ctx, { geometry: dot, material: mat });
    const phase = i * 1.37;
    const base: [number, number, number] = [
      Math.sin(i) * SPREAD,
      (i % 5) - 1,
      Math.cos(i * 1.7) * SPREAD,
    ];
    return { mesh: m, phase, base };
  });

  let t = 0;
  const update = (center: [number, number, number], dt: number): void => {
    t += dt;
    for (const mo of motes) {
      const x = center[0] + mo.base[0] + Math.sin(t * 0.3 + mo.phase) * 0.5;
      const y = 1.2 + mo.base[1] + Math.sin(t * 0.5 + mo.phase) * 0.4;
      const z = center[2] + mo.base[2] + Math.cos(t * 0.27 + mo.phase) * 0.5;
      mesh.setPosition(ctx, mo.mesh, vec3.fromValues(x, y, z));
    }
  };

  const meshes = motes.map((m) => m.mesh);
  const destroy = (): void => {
    for (const mo of motes) mesh.destroy(ctx, mo.mesh);
    material.destroy(ctx, mat);
    binding.destroy(ctx, bind);
    geometry.destroy(ctx, dot);
  };
  return { meshes, update, destroy };
}
