import type { EntityDoc, SceneDocument } from "@furnace/core/scene";
import { EditorError } from "./errors.ts";

/**
 * Pure structural edits on a SceneDocument. Each function mutates the document
 * it is given IN PLACE — by contract the caller (session.apply) hands in a
 * private clone and runs the registry's whole-document validation afterwards;
 * these functions only enforce target-existence preconditions. Missing targets
 * throw EditorError("validation-failed") — same code as post-edit validation
 * failures, since both mean "this edit doesn't apply to this document".
 */

export type ResourceTable = "geometries" | "shaders" | "materials";

function requireEntity(doc: SceneDocument, id: string): EntityDoc {
  const entity = doc.entities.find((e) => e.id === id);
  if (!entity) {
    throw new EditorError("validation-failed", `entity "${id}" does not exist`);
  }
  return entity;
}

function freeEntityId(doc: SceneDocument): string {
  const used = new Set(doc.entities.map((e) => e.id));
  let n = 1;
  while (used.has(`entity-${n}`)) n++;
  return `entity-${n}`;
}

/** Append an entity; returns its (possibly generated) id. */
export function addEntity(
  doc: SceneDocument,
  input: { id?: string; components?: Record<string, unknown> },
): string {
  const id = input.id ?? freeEntityId(doc);
  if (doc.entities.some((e) => e.id === id)) {
    throw new EditorError("validation-failed", `entity "${id}" already exists`);
  }
  doc.entities.push({ id, components: input.components ?? {} });
  return id;
}

export function removeEntity(doc: SceneDocument, id: string): void {
  const index = doc.entities.findIndex((e) => e.id === id);
  if (index === -1) {
    throw new EditorError("validation-failed", `entity "${id}" does not exist`);
  }
  doc.entities.splice(index, 1);
}

/** Add-or-replace the whole component value on an entity. */
export function setComponent(
  doc: SceneDocument,
  entity: string,
  component: string,
  params: Record<string, unknown>,
): void {
  requireEntity(doc, entity).components[component] = params;
}

export function removeComponent(
  doc: SceneDocument,
  entity: string,
  component: string,
): void {
  const target = requireEntity(doc, entity);
  if (!(component in target.components)) {
    throw new EditorError(
      "validation-failed",
      `entity "${entity}" has no component "${component}"`,
    );
  }
  delete target.components[component];
}

/** Add-or-replace a resource entry (entry carries `kind` + params, document shape). */
export function setResource(
  doc: SceneDocument,
  table: ResourceTable,
  id: string,
  entry: Record<string, unknown>,
): void {
  doc.resources ??= {};
  const table_ = doc.resources[table] ?? {};
  doc.resources[table] = table_;
  table_[id] = entry;
}

export function removeResource(
  doc: SceneDocument,
  table: ResourceTable,
  id: string,
): void {
  const entries = doc.resources?.[table];
  if (!entries || !(id in entries)) {
    throw new EditorError(
      "validation-failed",
      `${table} "${id}" does not exist`,
    );
  }
  delete entries[id];
}

/** Whole-object settings replace (omit → reset to defaults at validation). */
export function setSettings(doc: SceneDocument, settings: unknown): void {
  // Boundary cast: the envelope carries settings as unknown; the post-edit
  // validateDocument pass proves it against the registry's settings schema.
  doc.settings = settings as SceneDocument["settings"];
}
