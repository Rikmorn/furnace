import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/context-types.ts";
import type { LoadedScene, SceneDocument } from "./types.ts";

/**
 * Load a serialized scene document into live core objects.
 *
 * @param ctx - the GPU context to create resources in
 * @param doc - the parsed scene document
 * @returns the loaded scene's render inputs + a `destroy` that frees everything created
 * @throws {FurnaceError} if the document fails boundary validation
 */
export async function loadScene(
  ctx: Context,
  doc: SceneDocument,
): Promise<LoadedScene> {
  void ctx;
  void doc;
  throw new FurnaceError("not implemented");
}
