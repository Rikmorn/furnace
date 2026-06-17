import type { Camera } from "../camera/types.ts";
import type { Ambient, Light } from "../frame/index.ts";
import type { Context } from "../gpu/context-types.ts";
import type { Mesh } from "../mesh/types.ts";
import type { World } from "../physics/index.ts";
import type { Effect } from "../post/index.ts";
import type { SceneSettings } from "./builtins.ts";

/** Options passed to {@link loadScene} (all optional). */
export type LoadSceneOptions = {
  /**
   * Build the scene's rigid bodies into this existing world instead of
   * creating (and owning) a new one. The injected world is NOT destroyed by
   * the returned `destroy`. This is the composition seam for loading a region
   * fragment into a live game world.
   */
  world?: World;
};

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
    textures?: Record<string, unknown>;
    shaders?: Record<string, unknown>;
    materials?: Record<string, unknown>;
    effects?: Record<string, unknown>;
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
  /** Lights projected from `light` entities (direction derived from transform rotation). */
  lights: Light[];
  /** Scene hemisphere ambient term, if a settings/ambient source set one (Task 10). */
  ambient?: Ambient;
  /** Post-processing effect chain projected from the scene (Task 10). */
  effects: Effect[];
  /** Physics world, lazily created when a `rigidBody` entity is present (Task 11). */
  world?: World;
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
  /**
   * Returns the 8 world-space AABB corners (a `Float32Array` of length 24)
   * for the entity's mesh(es), or `null` if the entity has no renderable
   * mesh. Corners reflect the mesh's current model matrix — call after a
   * render (or `setEntityTransform` + render) to get an up-to-date box.
   *
   * Corner bit layout: bit0=x, bit1=y, bit2=z (index `c` uses
   * `wmax.x` when `c & 1`, `wmax.y` when `c & 2`, `wmax.z` when `c & 4`).
   */
  entityBoxCorners: (entityId: string) => Float32Array | null;
  /**
   * Fast-path transform poke (no rebuild): applies the supplied position,
   * rotation, and/or scale to the entity's mesh(es). Omitted fields are left
   * unchanged. Silent no-op for unknown `entityId` or stale mesh handles.
   *
   * Intended for continuous drag-scrub and gizmo preview — avoids the
   * component rebuild overhead of `rebuildEntity` for pure transform changes.
   */
  setEntityTransform: (
    entityId: string,
    transform: {
      position?: readonly [number, number, number];
      rotation?: readonly [number, number, number, number];
      scale?: readonly [number, number, number];
    },
  ) => void;
  /** GPU id-buffer pick: render an id pass over the scene meshes and read back
   *  the entity id under the NDC cursor (`[-1,1]`, Y-up). null = background.
   *  Renders on demand (call on click), ~one frame of readback latency. */
  pick: (
    ctx: Context,
    cam: Camera,
    ndcX: number,
    ndcY: number,
  ) => Promise<string | null>;
};
