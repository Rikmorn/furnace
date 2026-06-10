import type { Camera } from "../camera/types.ts";
import type { Mesh } from "../mesh/types.ts";
import type { SceneSettings } from "./builtins.ts";

/**
 * A serialized furnace scene document (text-JSON shape). Component and
 * resource entries are open (`unknown`) — the registry is the authority on
 * what is valid; `validateDocument` proves every entry against its
 * registered schema at the load boundary.
 */
export type SceneDocument = {
  version: number;
  settings?: SceneSettings;
  resources?: {
    geometries?: Record<string, unknown>;
    shaders?: Record<string, unknown>;
    materials?: Record<string, unknown>;
  };
  entities: EntityDoc[];
};

/** An entity: a stable id + a map of typed components (`type → params`). */
export type EntityDoc = {
  id: string;
  components: Record<string, unknown>;
};

/** The live result of loading a scene: render inputs + a teardown that frees everything loaded. */
export type LoadedScene = {
  meshes: Mesh[];
  camera: Camera;
  settings: SceneSettings;
  destroy: () => void;
};
