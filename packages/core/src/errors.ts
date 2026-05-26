/**
 * Base class for engine-domain errors thrown by `@furnace/core`.
 *
 * Subclassed by module-specific error types (`FurnaceGpuError`,
 * `FurnaceInputError`, …). Consumers wanting to catch any engine-thrown
 * error regardless of module can branch on `instanceof FurnaceError`;
 * narrower handling branches on the subclass.
 */
export class FurnaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FurnaceError";
  }
}
