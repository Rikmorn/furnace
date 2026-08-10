/**
 * The inspector module's public, LIBRARY-AGNOSTIC contract. The chrome consumes
 * the inspector ONLY through <SchemaForm> (index.tsx) + these types. Input is
 * standard JSON Schema (+ a top-level `furnace` field-semantics key) + the
 * target's value + change callbacks; output is rendered controls — the same
 * shape a form library would consume, so a future swap touches only this
 * directory. See the M5A spec §A.
 *
 * NOTE: this module must not value-import @furnace/core (frontend leakage scan).
 * JSON Schema nodes are plain data from introspect(); the quat↔euler math is
 * hand-rolled in lib/euler.ts. The one `@furnace/core` reference below is an
 * `import type`, which that scan excludes by design (its rules carry a `type`
 * lookahead) and which is erased before the bundle exists.
 */
import type { FurnaceMeta } from "@furnace/core/registry";

export type JsonSchemaNode = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode | JsonSchemaNode[];
  /**
   * Furnace field semantics. zod's `.meta({ furnace })` is hoisted by
   * `z.toJSONSchema` to the NODE ROOT (verified against zod 4 output) — it is
   * NOT nested under a `meta` wrapper. Read it from here.
   *
   * **IT IS CORE'S TYPE SINCE T4c, NOT A SECOND DECLARATION OF IT.** The key has
   * three writers (`field/generators.ts`, `scatter.ts`, `cave.ts`) and two readers
   * (this inspector, and the MCP door shipping a generator's `paramSchema` to an
   * agent), and the copy that used to live here was the only type in the workspace
   * — so a misspelt member on the WRITING side simply rendered no suffix and
   * nothing failed. `FurnaceMeta` is declared beside the `z` those sites build
   * with, each site now spells `satisfies FurnaceMeta`, and this reader takes the
   * same declaration rather than agreeing with it by review. Every member is
   * optional and `kind` is `string` for the reasons stated there.
   */
  furnace?: FurnaceMeta;
  /** JSON Schema default value, emitted by zod `.default()` — used by field renderers to seed display when the doc omits the field. */
  default?: unknown;
  [key: string]: unknown;
};

export type FieldKind =
  | "number"
  /** A bounded number with a long run of notches (D-25): range + scrubby label +
   *  an exact text input. Chosen by SHAPE, not by a `furnace.kind` — see
   *  `resolveKind`. */
  | "slider"
  /** A bounded number a handful of notches wide: ± over the exact input. */
  | "stepper"
  /** An enum small enough to show every member at once. */
  | "segmented"
  | "string"
  | "boolean"
  | "enum"
  | "vec2"
  | "vec3"
  | "vec4"
  | "quat"
  | "color"
  | "object"
  | "unknown";

/** Props every field renderer receives. `value` is the target's value for this field. */
export type FieldProps = {
  schema: JsonSchemaNode;
  value: unknown;
  onPreview: (next: unknown) => void;
  onCommit: (next: unknown) => void;
  onCancel: () => void;
  path: string;
};

export type FieldRenderer = (props: FieldProps) => import("react").ReactElement;
