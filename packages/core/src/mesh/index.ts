export { cubeGeometry, planeGeometry } from "./factories";
export { createGeometry, destroyGeometry } from "./geometry.ts";
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
export type { Geometry, GeometryData, Mesh } from "./types.ts";
