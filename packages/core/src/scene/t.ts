import { z } from "zod";
import type { Geometry } from "../geometry/index.ts";
import type { Material } from "../material/index.ts";
import type { Shader } from "../shader/types.ts";

/** The fixed, dependency-ordered resource tables of a scene document. */
export const TABLE_ORDER = ["geometries", "shaders", "materials"] as const;

/** Name of a scene resource table. */
export type TableName = (typeof TABLE_ORDER)[number];

/** The live handle type a resource table stores, by table name. */
export type TableHandle<T extends TableName> = T extends "geometries"
  ? Geometry
  : T extends "shaders"
    ? Shader
    : Material;

/**
 * Furnace field semantics carried on a zod schema via `.meta({ furnace })`:
 * how the load boundary and the editor inspector interpret the field beyond
 * its plain JSON shape.
 */
export type FurnaceMeta =
  | { kind: "vec2" | "vec3" | "vec4" | "quat" | "color" }
  | { kind: "resource"; table: TableName }
  | { kind: "ref"; requires: readonly string[] };

/**
 * A zod string schema standing for a resource id into table `T`. The phantom
 * `_furnaceTable` (optional, never set at runtime — same pattern as
 * `Binding<L>.__layout`) lets `ResolvedParamsOf` map the field to its live
 * handle type on the build side.
 */
export interface ResourceSchema<T extends TableName> extends z.ZodString {
  readonly _furnaceTable?: T;
}

/**
 * A zod string schema standing for an entity id whose target must carry the
 * components `R`. Reserved M6 seam: validated at the load boundary in M2,
 * resolved to a typed entity handle by the behavior runtime in M6.
 */
export interface EntityRefSchema<R extends readonly string[]>
  extends z.ZodString {
  readonly _furnaceRefRequires?: R;
}

/** A 2-component vector param: `[x, y]`. */
export function vec2() {
  return z.tuple([z.number(), z.number()]).meta({ furnace: { kind: "vec2" } });
}

/** A 3-component vector param: `[x, y, z]`. */
export function vec3() {
  return z
    .tuple([z.number(), z.number(), z.number()])
    .meta({ furnace: { kind: "vec3" } });
}

/** A 4-component vector param: `[x, y, z, w]`. For RGBA color fields use {@link color} instead. */
export function vec4() {
  return z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .meta({ furnace: { kind: "vec4" } });
}

/**
 * An RGBA color param: `[r, g, b, a]` (same wire shape as {@link vec4}).
 * Distinct `furnace.kind: "color"` so the editor inspector renders a color
 * picker rather than four raw number inputs; the load boundary treats it
 * exactly as a vec4. Channels are in the engine's working color space (see
 * `docs/reference/engine-conventions.md §color`).
 */
export function color() {
  return z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .meta({ furnace: { kind: "color" } });
}

/** A rotation quaternion param: `[x, y, z, w]`. */
export function quat() {
  return z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .meta({ furnace: { kind: "quat" } });
}

/**
 * A resource-reference param: serialized as an id string into `table`,
 * boundary-validated to resolve, and handed to `build` as the live handle
 * (`bx.params.<field>` IS the `Geometry`/`Shader`/`Material`).
 */
export function resource<T extends TableName>(table: T): ResourceSchema<T> {
  return z.string().meta({ furnace: { kind: "resource", table } });
}

/**
 * An entity-reference param (reserved M6 seam): serialized as an entity-id
 * string; the load boundary validates the target exists and carries every
 * component in `requires`. M2 does not resolve it further.
 */
export function ref<const R extends readonly string[]>(
  ...requires: R
): EntityRefSchema<R> {
  return z.string().meta({ furnace: { kind: "ref", requires } });
}
