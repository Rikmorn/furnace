export type ResourceKind =
  | "mesh"
  | "material"
  | "geometry"
  | "effect"
  | "buffer"
  | "texture";

export type ResourceInfo =
  | { kind: "mesh" }
  | { kind: "material" }
  | { kind: "geometry" }
  | { kind: "effect" }
  | { kind: "buffer"; bytes: number }
  | { kind: "texture"; bytes: number };

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
