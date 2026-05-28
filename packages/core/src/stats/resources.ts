export type ResourceKind =
  | "mesh"
  | "material"
  | "geometry"
  | "effect"
  | "buffer"
  | "texture";

/**
 * Internal — type-only export so other `@furnace/core` modules can
 * reference the discriminated union accepted by `_registerResource`. NOT
 * part of the consumer API: it is re-exported from `stats/index.ts`
 * alongside the engine-internal `_*` hooks for in-repo callers only.
 *
 * Variants without a `bytes` field (`mesh`, `material`, `geometry`,
 * `effect`) contribute to `Snapshot.resources` counts. The `buffer` and
 * `texture` variants carry `bytes` and contribute to
 * `Snapshot.memory.bufferBytes` / `textureBytes` respectively.
 */
export type ResourceInfo =
  | { kind: "mesh" }
  | { kind: "material" }
  | { kind: "geometry" }
  | { kind: "effect" }
  | { kind: "buffer"; bytes: number }
  | { kind: "texture"; bytes: number };

/**
 * Internal — type-only export so other `@furnace/core` modules can hold
 * the opaque handle returned by `_registerResource` and pass it back to
 * `_unregisterResource` on `destroy`. NOT part of the consumer API:
 * re-exported from `stats/index.ts` alongside the engine-internal `_*`
 * hooks for in-repo callers only.
 *
 * `kind` mirrors the input `ResourceInfo.kind`; `bytes` is `0` for
 * count-only kinds and the registered byte total for `buffer`/`texture`.
 */
export type ResourceHandle = Readonly<{
  kind: ResourceKind;
  bytes: number;
}>;

export type ResourceRegistry = {
  entries: Set<ResourceHandle>;
  counts: {
    meshes: number;
    materials: number;
    geometries: number;
    effects: number;
  };
  memory: { bufferBytes: number; textureBytes: number };
};

export function createResourceRegistry(): ResourceRegistry {
  return {
    entries: new Set(),
    counts: { meshes: 0, materials: 0, geometries: 0, effects: 0 },
    memory: { bufferBytes: 0, textureBytes: 0 },
  };
}

export function registerResource(
  r: ResourceRegistry,
  info: ResourceInfo,
): ResourceHandle {
  const bytes = "bytes" in info ? info.bytes : 0;
  const handle = Object.freeze({ kind: info.kind, bytes });
  r.entries.add(handle);
  switch (info.kind) {
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
    case "buffer":
      r.memory.bufferBytes += info.bytes;
      break;
    case "texture":
      r.memory.textureBytes += info.bytes;
      break;
  }
  return handle;
}

export function unregisterResource(
  r: ResourceRegistry,
  handle: ResourceHandle,
): void {
  if (!r.entries.delete(handle)) return; // unknown handle: silent
  switch (handle.kind) {
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
    case "buffer":
      r.memory.bufferBytes -= handle.bytes;
      break;
    case "texture":
      r.memory.textureBytes -= handle.bytes;
      break;
  }
}

/**
 * Increment count or memory totals for `kind` by `bytes`. New single-writer
 * API (RM-4): used by the resource manager for slot-kind counts and by every
 * site that creates a `GPUBuffer` / `GPUTexture` for `buffer`/`texture` bytes.
 * Does NOT touch `entries` (the leak-warn fallback was replaced by per-kind
 * count check in RM-4).
 *
 * For `mesh`/`material`/`geometry`/`effect`: increments the per-kind count;
 * `bytes` is ignored (caller passes `0`).
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
    case "buffer":
      r.memory.bufferBytes -= bytes;
      break;
    case "texture":
      r.memory.textureBytes -= bytes;
      break;
  }
}
