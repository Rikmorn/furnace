/**
 * The inspector module's public, LIBRARY-AGNOSTIC contract. The chrome consumes
 * the inspector ONLY through <SchemaForm> (index.tsx) + these types. Input is
 * standard JSON Schema (+ a top-level `furnace` field-semantics key) + N target
 * values + change callbacks; output is rendered controls — the same shape a form
 * library would consume, so a future swap touches only this directory. See the
 * M5A spec §A.
 *
 * NOTE: this module must not value-import @furnace/core (frontend leakage scan).
 * JSON Schema nodes are plain data from introspect(); the quat↔euler math is
 * hand-rolled in lib/euler.ts.
 */
export type JsonSchemaNode = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode | JsonSchemaNode[];
  /**
   * Furnace field semantics. zod's `.meta({ furnace })` is hoisted by
   * `z.toJSONSchema` to the NODE ROOT (verified against zod 4 output) — it is
   * NOT nested under a `meta` wrapper. Read it from here.
   */
  furnace?: { kind: string; table?: string; requires?: readonly string[] };
  [key: string]: unknown;
};

export type FieldKind =
  | "number"
  | "string"
  | "boolean"
  | "enum"
  | "vec2"
  | "vec3"
  | "vec4"
  | "quat"
  | "color"
  | "resource"
  | "ref"
  | "object"
  | "unknown";

/** Props every field renderer receives. `values` holds the N selected targets' values for this field. */
export type FieldProps = {
  schema: JsonSchemaNode;
  values: unknown[];
  onPreview: (next: unknown[]) => void;
  onCommit: (next: unknown[]) => void;
  onCancel: () => void;
  path: string;
};

export type FieldRenderer = (props: FieldProps) => import("react").ReactElement;
