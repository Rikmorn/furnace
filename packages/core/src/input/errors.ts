import { FurnaceError } from "../errors.ts";

/**
 * Thrown for input-domain setup misuse — currently only by {@link attach}
 * when the module is already attached. Extends {@link FurnaceError}.
 */
export class FurnaceInputError extends FurnaceError {
  override readonly name = "FurnaceInputError";
}
