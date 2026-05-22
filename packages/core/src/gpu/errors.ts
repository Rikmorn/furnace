import { FurnaceError } from "../errors.ts";

export { FurnaceError };

export class FurnaceGpuError extends FurnaceError {
  constructor(message: string) {
    super(message);
    this.name = "FurnaceGpuError";
  }
}
