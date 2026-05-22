export class FurnaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FurnaceError";
  }
}
