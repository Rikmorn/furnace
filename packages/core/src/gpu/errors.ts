import { FurnaceError } from "../errors.ts";

export { FurnaceError };

/**
 * Thrown for WebGPU-specific failures: no adapter / device, missing canvas
 * context, use-after-`dispose`, and other GPU-domain setup or escape-hatch
 * misuse. Extends {@link FurnaceError}.
 */
export class FurnaceGpuError extends FurnaceError {
  constructor(message: string) {
    super(message);
    this.name = "FurnaceGpuError";
  }
}
