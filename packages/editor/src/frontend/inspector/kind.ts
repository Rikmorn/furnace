import type { FieldKind, JsonSchemaNode } from "./types.ts";

const FURNACE_KINDS = new Set([
  "vec2",
  "vec3",
  "vec4",
  "quat",
  "color",
  "resource",
  "ref",
]);

/** Resolve a schema node to a field kind. Order: furnace.kind → enum → JSON type → unknown. */
export function resolveKind(schema: JsonSchemaNode): FieldKind {
  const furnace = schema.meta?.furnace?.kind;
  if (furnace && FURNACE_KINDS.has(furnace)) return furnace as FieldKind;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return "enum";
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "integer" || type === "number") return "number";
  if (type === "string") return "string";
  if (type === "boolean") return "boolean";
  if (type === "object" && schema.properties) return "object";
  return "unknown";
}
