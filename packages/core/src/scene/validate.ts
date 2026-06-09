// packages/core/src/scene/validate.ts
import { FurnaceError } from "../errors.ts";
import type { SceneDocument } from "./types.ts";

/** The scene-format version this engine build writes and loads. */
export const CURRENT_SCENE_VERSION = 1;

/**
 * Validate a scene document at the load boundary. Throws on the first problem so the loader
 * never reaches GPU work with a malformed document ("parse, don't validate" — everything
 * downstream of this is trusted).
 *
 * @param doc - the parsed scene document
 * @throws {FurnaceError} on version mismatch, missing required fields, or a dangling resource ref
 */
export function validateDocument(doc: SceneDocument): void {
  if (doc.version !== CURRENT_SCENE_VERSION) {
    throw new FurnaceError(
      `scene: unsupported version ${doc.version} (this build loads version ${CURRENT_SCENE_VERSION})`,
    );
  }
  if (!Array.isArray(doc.entities)) {
    throw new FurnaceError(
      `scene: document is missing required field "entities" (must be an array)`,
    );
  }
  const geometries = doc.resources?.geometries ?? {};
  const shaders = doc.resources?.shaders ?? {};
  const materials = doc.resources?.materials ?? {};

  for (const [id, mat] of Object.entries(materials)) {
    if (!(mat.shader in shaders)) {
      throw new FurnaceError(
        `scene: material "${id}" references unknown shader "${mat.shader}"`,
      );
    }
  }
  for (const entity of doc.entities) {
    const mr = entity.components.meshRenderer;
    if (mr) {
      if (!(mr.geometry in geometries)) {
        throw new FurnaceError(
          `scene: entity "${entity.id}" references unknown geometry "${mr.geometry}"`,
        );
      }
      if (!(mr.material in materials)) {
        throw new FurnaceError(
          `scene: entity "${entity.id}" references unknown material "${mr.material}"`,
        );
      }
    }
  }
}
