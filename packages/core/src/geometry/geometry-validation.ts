import { FurnaceError } from "../errors.ts";
import type { GeometryData } from "./types.ts";

export function validateGeometryData(data: GeometryData): void {
  if (data.positions.length % 3 !== 0) {
    throw new FurnaceError("positions length must be a multiple of 3");
  }
  const vertexCount = data.positions.length / 3;
  if (data.normals.length !== vertexCount * 3) {
    throw new FurnaceError("normals must have one vec3 per position");
  }
  if (data.uvs.length !== vertexCount * 2) {
    throw new FurnaceError("uvs must have one vec2 per position");
  }
}
