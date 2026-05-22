import { FurnaceError } from "../errors.ts";

export class FurnaceInputError extends FurnaceError {
  override readonly name = "FurnaceInputError";
}
