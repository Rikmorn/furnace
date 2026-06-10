import type { z } from "zod";
import { FurnaceError } from "../errors.ts";
import {
  type ComponentRegistration,
  getComponent,
  getResourceKind,
  getSettingsSchema,
  type ResourceRegistration,
} from "./registry.ts";
import { fieldFurnaceMeta, parseOrThrow } from "./schema.ts";
import { TABLE_ORDER, type TableName } from "./t.ts";
import type { SceneDocument } from "./types.ts";

/** The scene-format version this engine build writes and loads. */
export const CURRENT_SCENE_VERSION = 1;

/** Tables whose entries may omit `kind`; the named default applies. */
const TABLE_DEFAULT_KIND: Partial<Record<TableName, string>> = {
  materials: "standard",
};

/**
 * Split a raw resource entry into its kind discriminator + params.
 * @throws {FurnaceError} on a non-object entry or a missing kind with no table default.
 */
export function splitKind(
  table: TableName,
  id: string,
  entry: unknown,
): { kind: string; params: Record<string, unknown> } {
  if (typeof entry !== "object" || entry === null) {
    throw new FurnaceError(`scene: ${table} "${id}" must be an object`);
  }
  const { kind, ...params } = entry as { kind?: unknown } & Record<
    string,
    unknown
  >;
  const resolved = kind ?? TABLE_DEFAULT_KIND[table];
  if (typeof resolved !== "string") {
    throw new FurnaceError(`scene: ${table} "${id}" is missing its "kind"`);
  }
  return { kind: resolved, params };
}

function isTableName(key: string): key is TableName {
  return (TABLE_ORDER as readonly string[]).includes(key);
}

/** Resource-ref fields must point at ids present in the document. */
function checkResourceRefs(
  reg: ComponentRegistration | ResourceRegistration,
  parsed: Record<string, unknown>,
  doc: SceneDocument,
  where: string,
): void {
  for (const [key, field] of Object.entries(reg.shape)) {
    // Boundary cast: zod v4 types ZodRawShape values as the internal `$ZodType`
    // base; `fieldFurnaceMeta` takes the public `ZodType` (same runtime object).
    const meta = fieldFurnaceMeta(field as z.ZodType);
    if (meta?.kind !== "resource") continue;
    const id = parsed[key];
    if (id === undefined) continue;
    if (
      !(typeof id === "string" && id in (doc.resources?.[meta.table] ?? {}))
    ) {
      throw new FurnaceError(
        `scene: ${where} references unknown ${meta.table} "${String(id)}" at "${key}"`,
      );
    }
  }
}

/** Entity-ref fields (the reserved M6 seam): target exists + carries required components. */
function checkEntityRefs(
  reg: ComponentRegistration,
  parsed: Record<string, unknown>,
  entityIndex: Map<string, Record<string, unknown>>,
  where: string,
): void {
  for (const [key, field] of Object.entries(reg.shape)) {
    // Boundary cast: zod v4 types ZodRawShape values as the internal `$ZodType`
    // base; `fieldFurnaceMeta` takes the public `ZodType` (same runtime object).
    const meta = fieldFurnaceMeta(field as z.ZodType);
    if (meta?.kind !== "ref") continue;
    const id = parsed[key];
    if (id === undefined) continue;
    const target = typeof id === "string" ? entityIndex.get(id) : undefined;
    if (!target) {
      throw new FurnaceError(
        `scene: ${where} field "${key}" references unknown entity "${String(id)}"`,
      );
    }
    for (const required of meta.requires) {
      if (!(required in target)) {
        throw new FurnaceError(
          `scene: ${where} field "${key}" requires entity "${String(id)}" to carry "${required}"`,
        );
      }
    }
  }
}

/**
 * Validate a scene document at the load boundary against the registry.
 * Throws on the first problem so the loader never reaches GPU work with a
 * malformed document ("parse, don't validate" — everything downstream is
 * trusted). Checks: version, settings schema, resource table/kind/params/refs,
 * entity-id uniqueness, component registration/params/refs (including
 * `t.ref` target-and-requires — the reserved M6 seam).
 *
 * @param doc - the parsed scene document
 * @throws {FurnaceError} naming the failing entity/component/table/kind/field
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

  parseOrThrow(getSettingsSchema(), doc.settings ?? {}, "settings");

  for (const [table, entries] of Object.entries(doc.resources ?? {})) {
    if (!isTableName(table))
      throw new FurnaceError(`scene: unknown resource table "${table}"`);
    for (const [id, entry] of Object.entries(entries ?? {})) {
      const { kind, params } = splitKind(table, id, entry);
      const reg = getResourceKind(table, kind);
      if (!reg) {
        throw new FurnaceError(
          `scene: ${table} "${id}" has unregistered kind "${kind}"`,
        );
      }
      const parsed = parseOrThrow(reg.schema, params, `${table} "${id}"`);
      checkResourceRefs(reg, parsed, doc, `${table} "${id}"`);
    }
  }

  const entityIndex = new Map<string, Record<string, unknown>>();
  for (const entity of doc.entities) {
    if (entityIndex.has(entity.id)) {
      throw new FurnaceError(`scene: duplicate entity id "${entity.id}"`);
    }
    entityIndex.set(entity.id, entity.components);
  }

  for (const entity of doc.entities) {
    for (const [name, raw] of Object.entries(entity.components)) {
      const reg = getComponent(name);
      if (!reg) {
        throw new FurnaceError(
          `scene: entity "${entity.id}" component "${name}" is not registered (is its extension imported?)`,
        );
      }
      const where = `entity "${entity.id}" component "${name}"`;
      const parsed = parseOrThrow(reg.schema, raw, where);
      checkResourceRefs(reg, parsed, doc, where);
      checkEntityRefs(reg, parsed, entityIndex, where);
    }
  }
}
