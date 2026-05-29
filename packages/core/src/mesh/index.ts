// TEMPORARY back-compat — removed in Task 9c once consumers/tests migrate to @furnace/core/geometry.
export {
  cube as cubeGeometry,
  plane as planeGeometry,
} from "../geometry/factories/index.ts";
export {
  create as createGeometry,
  destroy as destroyGeometry,
} from "../geometry/geometry.ts";
export type { Geometry, GeometryData } from "../geometry/types.ts";
export {
  create,
  destroy,
  getPosition,
  getRotation,
  getScale,
  setMaterial,
  setPosition,
  setRotation,
  setScale,
} from "./mesh.ts";
export type { Mesh } from "./types.ts";
