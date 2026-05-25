import type { Context } from "@furnace/core/gpu";
import * as stats from "@furnace/core/stats";

export const overlay = $state({
  fps: 0,
  frameMsLast: 0,
  frameMsMean: 0,
  drawCalls: 0,
  triangles: 0,
  meshes: 0,
  materials: 0,
  geometries: 0,
  memoryMiB: 0,
  uncapturedErrors: 0,
});

const BYTES_PER_MIB = 1024 * 1024;

/** Subscribe overlay state to ctx's stats stream. Throws if ctx is already disposed. */
export function subscribeOverlay(ctx: Context): () => void {
  return stats.onFrame(ctx, (snap) => {
    overlay.fps = snap.frame.fps;
    overlay.frameMsLast = snap.frame.ms.last;
    overlay.frameMsMean = snap.frame.ms.mean;
    overlay.drawCalls = snap.gpu.drawCalls;
    overlay.triangles = snap.gpu.triangles;
    overlay.meshes = snap.resources.meshes;
    overlay.materials = snap.resources.materials;
    overlay.geometries = snap.resources.geometries;
    overlay.memoryMiB = snap.memory.total / BYTES_PER_MIB;
    overlay.uncapturedErrors = snap.gpu.uncapturedErrors;
  });
}
