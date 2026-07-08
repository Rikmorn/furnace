// Which resources a selection references — drives the inspector's resource FILTER: with
// an entity selected, only the resources it (transitively) uses are shown, so the panel
// stays scannable at the single-wing-doc scale (a bake has dozens of materials).
//
// A "reference" is a resource-kind schema field (t.resource(table) → furnace.kind
// "resource" + table) holding a resource id. References close transitively: an entity's
// meshRenderer references a material; that material references a shader.
import { resolveKind } from "../kind.ts";
import type { JsonSchemaNode } from "../types.ts";
import { splitResourceEntry } from "./resource-kind.ts";

/** A resolved resource reference: which table and which id within it. */
export type ResourceRef = { table: string; id: string };

/**
 * Collect every resource reference in `value`, matched against its object `schema`.
 * Recurses into nested object properties. Empty/missing ref ids are skipped.
 */
export function collectResourceRefs(
  schema: JsonSchemaNode | undefined,
  value: unknown,
): ResourceRef[] {
  if (!schema?.properties || typeof value !== "object" || value === null)
    return [];
  const record = value as Record<string, unknown>;
  return Object.entries(schema.properties).flatMap(([key, fieldSchema]) => {
    const fieldValue = record[key];
    const kind = resolveKind(fieldSchema);
    if (kind === "resource") {
      const table = fieldSchema.furnace?.table;
      if (
        typeof table === "string" &&
        typeof fieldValue === "string" &&
        fieldValue !== ""
      ) {
        return [{ table, id: fieldValue }];
      }
      return [];
    }
    if (kind === "object") return collectResourceRefs(fieldSchema, fieldValue);
    return [];
  });
}

type Reflection = {
  components: Record<string, JsonSchemaNode>;
  resources: Record<string, Record<string, JsonSchemaNode>>;
};

type Resources =
  | { [table: string]: Record<string, unknown> | undefined }
  | undefined;

const refKey = (r: ResourceRef): string => `${r.table}:${r.id}`;

/**
 * The set of `"table:id"` keys the selected entities reference, transitively closed over
 * resource-to-resource references. Empty when the selection references no resources.
 */
export function referencedResourceKeys(
  selected: readonly { components: Record<string, unknown> }[],
  reflection: Reflection,
  resources: Resources,
): Set<string> {
  const seen = new Set<string>();
  const queue: ResourceRef[] = [];
  const enqueue = (refs: ResourceRef[]): void => {
    for (const ref of refs) {
      if (!seen.has(refKey(ref))) {
        seen.add(refKey(ref));
        queue.push(ref);
      }
    }
  };

  for (const entity of selected) {
    for (const [name, params] of Object.entries(entity.components)) {
      enqueue(collectResourceRefs(reflection.components[name], params));
    }
  }

  while (queue.length > 0) {
    const ref = queue.shift();
    if (!ref) break;
    const entry = resources?.[ref.table]?.[ref.id];
    if (entry === undefined) continue;
    const { kind, params } = splitResourceEntry(
      ref.table,
      entry as Record<string, unknown>,
    );
    enqueue(
      collectResourceRefs(reflection.resources[ref.table]?.[kind], params),
    );
  }

  return seen;
}
