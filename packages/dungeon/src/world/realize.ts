// packages/dungeon/src/world/realize.ts
// The GPU-material side of world loading: the descriptor-keyed {@link MaterialCache} every
// loaded world's meshes and instanced groups draw with, plus the {@link DynamicProp} record on
// the `LoadedWorld` contract. `world-loader.ts` owns the loading itself.
import * as binding from "@furnace/core/binding";
import type { Context } from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import type * as physics from "@furnace/core/physics";
import * as shader from "@furnace/core/shader";
import type { MaterialDescriptor, MaterialPosture } from "./region.ts";

/** An addressable dynamic prop: a rigid body a loaded world hands back. The seam future
 *  interaction verbs (pickup/throw/query) target — a record, not an anonymous body, so it
 *  can grow metadata without reshaping callers. */
export type DynamicProp = { body: physics.Body };

/** Creates one GPU material per distinct descriptor, shared across a world's draws. Caller owns
 *  it (outlives the draws); `destroy()` frees every material + binding it created. The lit
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
   *  must request materials SEQUENTIALLY (`for ... await`), never `Promise.all`. */
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
   *  `litInstanced` (color + specular). Kept separate from {@link get} so the surface MESHES
   *  keep using the non-instanced lit material while kit and placement groups use the
   *  instanced variants. Same sequential-call caveat as {@link get}: callers must request
   *  materials SEQUENTIALLY (`for ... await`), never `Promise.all`. */
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
