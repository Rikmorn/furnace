export type ResourceKind =
  | "mesh"
  | "material"
  | "geometry"
  | "effect"
  | "shader"
  | "binding"
  | "buffer"
  | "texture";

export type ResourceRegistry = {
  counts: {
    meshes: number;
    materials: number;
    geometries: number;
    effects: number;
    shaders: number;
    bindings: number;
  };
  memory: { bufferBytes: number; textureBytes: number };
};

export function createResourceRegistry(): ResourceRegistry {
  return {
    counts: {
      meshes: 0,
      materials: 0,
      geometries: 0,
      effects: 0,
      shaders: 0,
      bindings: 0,
    },
    memory: { bufferBytes: 0, textureBytes: 0 },
  };
}

/**
 * Increment count or memory totals for `kind` by `bytes`. Single-writer
 * API (RM-4): used by the resource manager for slot-kind counts and by every
 * site that creates a `GPUBuffer` / `GPUTexture` for `buffer`/`texture` bytes.
 *
 * For `mesh`/`material`/`geometry`/`effect`/`shader`: increments the per-kind
 * count; `bytes` is ignored (caller passes `0`).
 * For `buffer`/`texture`: adds `bytes` to the matching memory total; counts
 * are not maintained for these kinds.
 */
export function recordAlloc(
  r: ResourceRegistry,
  kind: ResourceKind,
  bytes: number,
): void {
  switch (kind) {
    case "mesh":
      r.counts.meshes++;
      break;
    case "material":
      r.counts.materials++;
      break;
    case "geometry":
      r.counts.geometries++;
      break;
    case "effect":
      r.counts.effects++;
      break;
    case "shader":
      r.counts.shaders++;
      break;
    case "binding":
      r.counts.bindings++;
      break;
    case "buffer":
      r.memory.bufferBytes += bytes;
      break;
    case "texture":
      r.memory.textureBytes += bytes;
      break;
  }
}

/**
 * Decrement count or memory totals for `kind` by `bytes`. Symmetric to
 * {@link recordAlloc}; callers pass the same byte value at destroy as alloc.
 */
export function recordDestroy(
  r: ResourceRegistry,
  kind: ResourceKind,
  bytes: number,
): void {
  switch (kind) {
    case "mesh":
      r.counts.meshes--;
      break;
    case "material":
      r.counts.materials--;
      break;
    case "geometry":
      r.counts.geometries--;
      break;
    case "effect":
      r.counts.effects--;
      break;
    case "shader":
      r.counts.shaders--;
      break;
    case "binding":
      r.counts.bindings--;
      break;
    case "buffer":
      r.memory.bufferBytes -= bytes;
      break;
    case "texture":
      r.memory.textureBytes -= bytes;
      break;
  }
}
