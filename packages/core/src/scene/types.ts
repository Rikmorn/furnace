import type { Camera } from "../camera/types.ts";
import type { Mesh } from "../mesh/types.ts";

/** A serialized furnace scene document (text-JSON shape). Slice 1 subset. */
export type SceneDocument = {
  version: number;
  settings?: SceneSettings;
  resources?: ResourceTable;
  entities: EntityDoc[];
};

/** Scene-level render/world globals. Slice 1: clearColor only. */
export type SceneSettings = {
  clearColor?: [number, number, number, number];
};

/** Id-keyed resource tables, instantiated in dependency order (geometries → shaders → materials). */
export type ResourceTable = {
  geometries?: Record<string, GeometryResource>;
  shaders?: Record<string, ShaderResource>;
  materials?: Record<string, MaterialResource>;
};

/** A geometry resource, discriminated by `kind`. Slice 1: cube only. */
export type GeometryResource = { kind: "cube" };

/** A shader resource referencing a built-in by `kind`. Slice 1: unlit only. */
export type ShaderResource = { kind: "unlit" };

/** A material: a shader ref + inline uniform `params` (matching the shader's layout). */
export type MaterialResource = {
  shader: string;
  params?: { color?: [number, number, number, number] };
};

/** An entity: a stable id + a map of typed components. */
export type EntityDoc = {
  id: string;
  components: ComponentMap;
};

/** The components an entity may carry. Slice 1: transform, meshRenderer, camera. */
export type ComponentMap = {
  transform?: TransformParams;
  meshRenderer?: MeshRendererParams;
  camera?: CameraParams;
};

/** Local transform. Rotation is a quaternion [x,y,z,w]; omitted fields default to identity. */
export type TransformParams = {
  position?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
};

/** Renders an entity: references a geometry resource and a material resource by id. */
export type MeshRendererParams = { geometry: string; material: string };

/** Camera params (non-spatial only; pose comes from the entity's transform). Slice 1: perspective. */
export type CameraParams = {
  kind: "perspective";
  aspect: number;
  fovYRad?: number;
  near?: number;
  far?: number;
};

/** The live result of loading a scene: render inputs + a teardown that frees everything loaded. */
export type LoadedScene = {
  meshes: Mesh[];
  camera: Camera;
  settings: SceneSettings;
  destroy: () => void;
};
