export class FurnaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FurnaceError";
  }
}

export class FurnaceGpuError extends FurnaceError {
  constructor(message: string) {
    super(message);
    this.name = "FurnaceGpuError";
  }
}
