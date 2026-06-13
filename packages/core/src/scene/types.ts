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
  /**
   * Rebuild a single entity in place from `doc`, reusing the loader's build
   * (no full reload). Tears down the entity's previous instances/meshes, builds
   * its components from `doc`, and swaps them into `meshes`/`camera`. The rest
   * of the scene is untouched. Editor live-preview seam (M5A); throws (caught by
   * the caller) if `doc`'s entity params are invalid. On an invalid rebuild it
   * throws **leaving the entity unchanged** (the replacement is built before the
   * old one is torn down — a transactional swap).
   *
   * **Precondition — resources are frozen at load time.** `rebuildEntity` reuses
   * the resource `lookup` built by `loadScene`; a `doc` whose `resources` differ
   * from the original loaded document is not supported (the lookup would throw on
   * any new or renamed resource id). In M5A the caller always passes the committed
   * doc with one component's fields overridden, so resources never change.
   *
   * **Precondition — camera entity keeps its camera component.** If `doc` drops
   * the camera component from the entity that contributed the scene's camera,
   * `camera` is left pointing at the torn-down camera. The inspector edits
   * component fields only and never removes components, so this is outside M5A
   * scope.
   */
  rebuildEntity: (entityId: string, doc: SceneDocument) => void;
  /** Replace scene settings (e.g. clearColor) without a rebuild; next render uses them. */
  setSettings: (settings: SceneSettings) => void;
};
