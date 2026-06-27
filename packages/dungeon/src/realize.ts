import * as binding from "@furnace/core/binding";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import type { ShapeDescriptor } from "@furnace/core/physics";
import * as physics from "@furnace/core/physics";
import * as shader from "@furnace/core/shader";
import { mat4, quat, vec3 } from "@furnace/core/transform";
import type {
  ArchetypeGeometry,
  MaterialDescriptor,
  MaterialPosture,
  RegionData,
} from "./region.ts";

/** An addressable dynamic scatter prop: the rigid body realize created. The seam future
 *  interaction verbs (pickup/throw/query) target — a record, not an anonymous body, so it
 *  can grow metadata without reshaping callers. */
export type DynamicProp = { body: physics.Body };

const PROP_FRICTION = 0.8;
const PROP_LINEAR_DAMPING = 0.2;
const PROP_ANGULAR_DAMPING = 0.4;

/** Creates one GPU material per distinct descriptor, shared across regions. Caller owns it
 *  (outlives the regions); `destroy()` frees every material + binding it created. The lit
 *  shader is a context-cached built-in (shared, owned by the context), so it is NOT freed here. */
export class MaterialCache {
  private readonly entries = new Map<
    string,
    { mat: material.Material; bind: binding.Binding }
  >();
  private readonly instancedEntries = new Map<
    string,
    { mat: material.Material; bind: binding.Binding }
  >();

  constructor(private readonly ctx: Context) {}

  /** Returns a cached GPU material for the given descriptor, creating it on first use.
   *
   *  NOT safe for CONCURRENT calls with the same descriptor key: the check-then-await-
   *  then-set window means two concurrent same-key calls both miss the cache and each
   *  allocate a binding+material (only the last is retained — the rest leak). Callers
   *  must realize regions SEQUENTIALLY (`for ... await`), never `Promise.all`. */
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

  /** Returns a cached INSTANCED GPU material for `(descriptor, posture)`, creating it on
   *  first use. `emissive` → `unlitInstanced` (color only; glows via bloom); `lit` →
   *  `litInstanced` (color + specular). Kept separate from {@link get} so region MESHES
   *  keep using the non-instanced lit material while scatter groups use the instanced
   *  variants. Same sequential-call caveat as {@link get}: callers must realize regions
   *  SEQUENTIALLY (`for ... await`), never `Promise.all`. */
  async getInstanced(
    d: MaterialDescriptor,
    posture: MaterialPosture,
  ): Promise<material.Material> {
    const key = `${posture}:${JSON.stringify(d)}`;
    const hit = this.instancedEntries.get(key);
    if (hit) return hit.mat;
    const entry =
      posture === "emissive"
        ? await this.makeEmissiveInstanced(d)
        : await this.makeLitInstanced(d);
    this.instancedEntries.set(key, entry);
    return entry.mat;
  }

  private async makeEmissiveInstanced(
    d: MaterialDescriptor,
  ): Promise<{ mat: material.Material; bind: binding.Binding }> {
    const shd = await shader.unlitInstanced(this.ctx);
    const bind = binding.create(this.ctx, shd);
    binding.set(this.ctx, bind, { color: d.color });
    const mat = await material.create(this.ctx, { shader: shd, binding: bind });
    return { mat, bind };
  }

  private async makeLitInstanced(
    d: MaterialDescriptor,
  ): Promise<{ mat: material.Material; bind: binding.Binding }> {
    const shd = await shader.litInstanced(this.ctx);
    const bind = binding.create(this.ctx, shd);
    binding.set(this.ctx, bind, { color: d.color, specular: d.specular });
    const mat = await material.create(this.ctx, { shader: shd, binding: bind });
    return { mat, bind };
  }

  /** Frees every material and binding this cache created (non-instanced and instanced).
   *  Does NOT free the shared lit/instanced shaders (context-owned built-ins). */
  destroy(): void {
    for (const e of this.entries.values()) {
      material.destroy(this.ctx, e.mat);
      binding.destroy(this.ctx, e.bind);
    }
    this.entries.clear();
    for (const e of this.instancedEntries.values()) {
      material.destroy(this.ctx, e.mat);
      binding.destroy(this.ctx, e.bind);
    }
    this.instancedEntries.clear();
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
): Promise<{
  meshes: mesh.Mesh[];
  instanced: mesh.InstancedMesh[];
  dynamicProps: DynamicProp[];
  update: () => void;
  destroy: () => void;
}> {
  for (const m of data.meshes) {
    if (m.material < 0 || m.material >= data.materials.length) {
      throw new Error(
        `realizeRegion: material index ${m.material} out of range`,
      );
    }
  }
  for (const g of data.instances) {
    if (g.material < 0 || g.material >= data.materials.length) {
      throw new Error(
        `realizeRegion: instance group material index ${g.material} out of range`,
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

  // Scatter instance groups → one InstancedMesh (+ one archetype geometry) each. Group
  // material indices were validated above, and empty groups are skipped before any alloc,
  // so the createInstanced call below can't strand a buffer on a late throw. The collider /
  // dynamic-body creation that runs AFTER createInstanced is setup-loud (createBody only
  // throws on programmer error), so it doesn't reintroduce a strand risk. Sequential
  // (`for ... await`) because `getInstanced` is async and the MaterialCache is not
  // concurrency-safe.
  const ownedInstanced: { im: mesh.InstancedMesh; geo: geometry.Geometry }[] =
    [];
  const dynamicProps: DynamicProp[] = [];
  const dynamicGroups: {
    im: mesh.InstancedMesh;
    bodies: physics.Body[];
    transforms: Float32Array;
    scales: number[];
  }[] = [];
  for (const g of data.instances) {
    const count = g.transforms.length / 16;
    if (count === 0) continue; // createInstanced rejects count 0; skip before allocating
    const geo = archetypeGeometry(ctx, g.geometry);
    const mat = await matCache.getInstanced(
      data.materials[g.material] as MaterialDescriptor,
      g.posture,
    );
    const im = mesh.createInstanced(ctx, {
      geometry: geo,
      material: mat,
      count,
    });
    mesh.setInstanceMatrices(ctx, im, g.transforms);
    for (let i = 0; i < count; i++) {
      mesh.setInstanceTint(ctx, im, i, [
        g.tints[i * 4] as number,
        g.tints[i * 4 + 1] as number,
        g.tints[i * 4 + 2] as number,
        g.tints[i * 4 + 3] as number,
      ]);
    }
    if (g.collision === "solid" && g.placements) {
      for (const p of g.placements) {
        physics.createBody(ctx, world, {
          type: "static",
          shape: colliderFor(g.geometry, p.scale),
          position: p.position,
          rotation: p.rotation,
        });
      }
    }
    if (g.collision === "dynamic" && g.placements) {
      const bodies = g.placements.map((p) =>
        physics.createBody(ctx, world, {
          type: "dynamic",
          shape: colliderFor(g.geometry, p.scale),
          position: p.position,
          rotation: p.rotation,
          friction: PROP_FRICTION,
          linearDamping: PROP_LINEAR_DAMPING,
          angularDamping: PROP_ANGULAR_DAMPING,
        }),
      );
      for (const b of bodies) dynamicProps.push({ body: b });
      dynamicGroups.push({
        im,
        bodies,
        transforms: g.transforms,
        scales: g.placements.map((p) => p.scale),
      });
    }
    ownedInstanced.push({ im, geo });
  }

  // Per-frame sync of dynamic instanced meshes from their bodies. Rewrites each group's
  // mat4 buffer IN PLACE (it is the GPU upload source) from the body's pose + the stored
  // per-instance scale, then re-uploads. No-op when the region has no dynamic groups.
  const tp = vec3.create();
  const tr = quat.create();
  const sv = vec3.create();
  const m = mat4.create();
  const update = (): void => {
    for (const dg of dynamicGroups) {
      for (let i = 0; i < dg.bodies.length; i++) {
        physics.getBodyTranslation(ctx, dg.bodies[i] as physics.Body, tp);
        physics.getBodyRotation(ctx, dg.bodies[i] as physics.Body, tr);
        sv.fill(dg.scales[i] as number);
        mat4.fromRotationTranslationScale(m, tr, tp, sv);
        dg.transforms.set(m, i * 16);
      }
      mesh.setInstanceMatrices(ctx, dg.im, dg.transforms);
    }
  };

  return {
    meshes: owned.map((o) => o.mesh),
    instanced: ownedInstanced.map((o) => o.im),
    dynamicProps,
    update,
    destroy: () => {
      for (const o of owned) {
        mesh.destroy(ctx, o.mesh);
        geometry.destroy(ctx, o.geo);
      }
      for (const o of ownedInstanced) {
        mesh.destroyInstanced(ctx, o.im);
        geometry.destroy(ctx, o.geo);
      }
    },
  };
}

/** Resolve a scatter archetype to a unit GPU primitive (per-group-owned — cross-group /
 *  cross-region geometry sharing is deferred). The per-instance transforms place and scale
 *  these unit primitives. */
function archetypeGeometry(
  ctx: Context,
  a: ArchetypeGeometry,
): geometry.Geometry {
  if (a.primitive === "sphere") return geometry.sphere(ctx, { radius: 0.5 });
  if (a.primitive === "cylinder")
    return geometry.cylinder(ctx, { radius: 0.5, height: 1 });
  return geometry.cube(ctx, { size: 1 });
}

/** A static/dynamic collider for a scatter archetype, uniform-scaled to match the
 *  rendered unit primitive (which spans ±0.5). Primitive shapes only (no trimesh) so
 *  scatter colliders are free of the internal-edge ghost-collision class. */
function colliderFor(a: ArchetypeGeometry, scale: number): ShapeDescriptor {
  const h = 0.5 * scale;
  if (a.primitive === "sphere") return { ball: h };
  if (a.primitive === "cylinder")
    return { cylinder: { halfHeight: h, radius: h } };
  return { cuboid: [h, h, h] };
}
