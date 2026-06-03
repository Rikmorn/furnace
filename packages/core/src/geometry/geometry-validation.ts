import { FurnaceError } from "../errors.ts";
import type { GeometryData } from "./types.ts";

/**
 * Guard a positive, finite dimension (radius, height, size). Setup-loud:
 * throws `FurnaceError` on zero, negative, or non-finite values before any
 * vertex math or GPU work runs.
 */
export function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new FurnaceError(`${name} must be a finite number > 0, got ${value}`);
  }
}

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
