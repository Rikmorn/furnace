import * as binding from "@furnace/core/binding";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as physics from "@furnace/core/physics";
import * as shader from "@furnace/core/shader";
import { vec3 } from "@furnace/core/transform";
import type { MaterialDescriptor, RegionData } from "./region.ts";

/** Creates one GPU material per distinct descriptor, shared across regions. Caller owns it
 *  (outlives the regions); `destroy()` frees every material + binding it created. The lit
 *  shader is a context-cached built-in (shared, owned by the context), so it is NOT freed here. */
export class MaterialCache {
  private readonly entries = new Map<
    string,
    { mat: material.Material; bind: binding.Binding }
  >();

  constructor(private readonly ctx: Context) {}

  /** Returns a cached GPU material for the given descriptor, creating it on first use. */
  async get(d: MaterialDescriptor): Promise<material.Material> {
    const key = JSON.stringify(d);
    const hit = this.entries.get(key);
    if (hit) return hit.mat;
    const shd = await shader.lit(this.ctx);
    const bind = binding.create(this.ctx, shd);
    binding.set(this.ctx, bind, { color: d.color, specular: d.specular });
    const mat = await material.create(this.ctx, { shader: shd, binding: bind });
    this.entries.set(key, { mat, bind });
    return mat;
  }

  /** Frees every material and binding this cache created. Does NOT free the shared lit shader. */
  destroy(): void {
    for (const e of this.entries.values()) {
      material.destroy(this.ctx, e.mat);
      binding.destroy(this.ctx, e.bind);
    }
    this.entries.clear();
  }
}

/** Build a region's GPU meshes + static colliders into `world`. Bodies are freed by
 *  `physics.destroyWorld`; the returned `destroy()` frees this region's meshes/geometries
 *  (NOT the world, NOT the matCache). Setup-loud: throws on a bad material index BEFORE any
 *  GPU allocation. NOTE: async because materials are created via `shader.lit`. */
export async function realizeRegion(
  ctx: Context,
  world: physics.World,
  matCache: MaterialCache,
  data: RegionData,
): Promise<{ meshes: mesh.Mesh[]; destroy: () => void }> {
  for (const m of data.meshes) {
    if (m.material < 0 || m.material >= data.materials.length) {
      throw new Error(
        `realizeRegion: material index ${m.material} out of range`,
      );
    }
  }

  const mats = await Promise.all(data.materials.map((d) => matCache.get(d)));

  const owned: { mesh: mesh.Mesh; geo: geometry.Geometry }[] = [];
  for (const m of data.meshes) {
    const geo =
      "custom" in m.geometry
        ? geometry.create(ctx, m.geometry.custom)
        : geometry.cube(ctx, { size: 1 });
    const handle = mesh.create(ctx, {
      geometry: geo,
      material: mats[m.material] as material.Material,
    });
    mesh.setPosition(
      ctx,
      handle,
      vec3.fromValues(m.position[0], m.position[1], m.position[2]),
    );
    if ("box" in m.geometry) {
      const s = m.geometry.box;
      mesh.setScale(
        ctx,
        handle,
        vec3.fromValues(s[0] as number, s[1] as number, s[2] as number),
      );
    } else if (m.scale) {
      mesh.setScale(
        ctx,
        handle,
        vec3.fromValues(
          m.scale[0] as number,
          m.scale[1] as number,
          m.scale[2] as number,
        ),
      );
    }
    owned.push({ mesh: handle, geo });
  }

  for (const c of data.colliders) {
    physics.createBody(ctx, world, {
      type: "static",
      shape: c.shape,
      position: c.position,
    });
  }

  return {
    meshes: owned.map((o) => o.mesh),
    destroy: () => {
      for (const o of owned) {
        mesh.destroy(ctx, o.mesh);
        geometry.destroy(ctx, o.geo);
      }
    },
  };
}
