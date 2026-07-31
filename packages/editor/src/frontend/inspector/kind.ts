import { numericSchema, stepSpan } from "./lib/numeric-schema.ts";
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

/** Above this many members an enum stops fitting on one row and goes back to the
 *  Select. Four is the mock's own cap and it is what the palette width allows for
 *  word-length labels ("colonnade", "keep-existing-air"). */
const SEGMENTED_MAX_MEMBERS = 4;

/** At or below this many INTERVALS end to end, ± beats a slider: the whole range is a
 *  handful of presses, and a 120 px track would give each notch ~10 px of pointer
 *  precision. Above it the presses stop being a route and the track wins. */
const STEPPER_MAX_STEPS = 12;

/**
 * Resolve a schema node to a field kind. Order: furnace.kind → enum → numeric SHAPE →
 * JSON type → unknown.
 *
 * D-25's bounded-number and small-enum rules live HERE rather than inside the renderers,
 * and that placement is the point. The registry's contract is ONE lookup — `kind` in,
 * renderer out — so a `NumberField` that decided internally whether to draw a slider
 * would put two controls behind one entry and make the registry a liar about what it
 * maps. These are decisions about the schema's shape, which is exactly what this function
 * already does for `enum` and `type`; they are not new `furnace.kind` values, because a
 * schema should not have to ASK for a slider it structurally is one.
 */
export function resolveKind(schema: JsonSchemaNode): FieldKind {
  const furnace = schema.furnace?.kind;
  if (furnace && FURNACE_KINDS.has(furnace)) return furnace as FieldKind;
  if (Array.isArray(schema.enum) && schema.enum.length > 0)
    return schema.enum.length <= SEGMENTED_MAX_MEMBERS ? "segmented" : "enum";
  const bounded = numericSchema(schema);
  if (bounded !== null)
    return bounded.integral && stepSpan(bounded) <= STEPPER_MAX_STEPS
      ? "stepper"
      : "slider";
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "integer" || type === "number") return "number";
  if (type === "string") return "string";
  if (type === "boolean") return "boolean";
  if (type === "object" && schema.properties) return "object";
  return "unknown";
}
