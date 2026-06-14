import { z } from "zod";
import { FurnaceError } from "../errors.ts";
import type { FurnaceMeta, TableHandle, TableName } from "./t.ts";

/**
 * Maps a raw param shape to its build-side type: `t.resource` fields become
 * live handles (`TableHandle`), nested `z.ZodObject` fields are mapped
 * recursively (so refs inside them — like `texture.texture` — become handles
 * too, optionality preserved), and everything else keeps its document-side
 * inferred type. The phantom `_furnaceTable` on `ResourceSchema` drives the
 * mapping; `t.ref` fields stay id strings (M6 resolves them).
 */
export type ResolvedParamsOf<
  S extends z.ZodRawShape,
  Doc = z.infer<z.ZodObject<S>>,
> = {
  [K in keyof Doc]: ResolveField<K extends keyof S ? S[K] : never, Doc[K]>;
};

type FurnaceTableOf<S> = S extends { _furnaceTable?: infer T }
  ? [T] extends [TableName]
    ? T
    : never
  : never;

type ResolveField<S, V> = [FurnaceTableOf<S>] extends [never]
  ? S extends z.ZodOptional<infer Inner>
    ? [FurnaceTableOf<Inner>] extends [never]
      ? // Optional nested object: recurse over its shape, re-adding `undefined`.
        Inner extends z.ZodObject<infer NestedShape>
        ? ResolvedParamsOf<NestedShape> | undefined
        : V
      : TableHandle<FurnaceTableOf<Inner>> | undefined
    : // Required nested object: recurse over its shape.
      S extends z.ZodObject<infer NestedShape>
      ? ResolvedParamsOf<NestedShape>
      : V
  : TableHandle<FurnaceTableOf<S>>;

/**
 * Read the furnace meta off a shape field, unwrapping `.optional()`.
 * Returns `undefined` for plain zod fields.
 */
export function fieldFurnaceMeta(field: z.ZodType): FurnaceMeta | undefined {
  let s = field;
  while (s instanceof z.ZodOptional) s = s.unwrap() as z.ZodType;
  const meta = s.meta();
  return (meta as { furnace?: FurnaceMeta } | undefined)?.furnace;
}

/**
 * Unwrap `.optional()` and return the inner `z.ZodObject` if the field is one
 * (directly or optional-wrapped); `undefined` for any other zod type. Used to
 * decide whether `resolveParams` should recurse into a nested object shape.
 */
function asNestedObject(field: z.ZodType): z.ZodObject | undefined {
  let s = field;
  while (s instanceof z.ZodOptional) s = s.unwrap() as z.ZodType;
  return s instanceof z.ZodObject ? s : undefined;
}

/**
 * Swap boundary-validated resource-id strings for live handles via `lookup`.
 * Walks the shape's fields: a `t.resource` field becomes its live handle;
 * a nested `z.ZodObject` field (optionally `.optional()`) is resolved
 * recursively against its own shape (so nested refs like
 * `material.texture.texture` resolve at any depth). Plain fields, arrays,
 * tuples, and `t.ref` fields pass through untouched.
 */
export function resolveParams(
  shape: z.ZodRawShape,
  parsed: Record<string, unknown>,
  lookup: (table: TableName, id: string) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed };
  for (const [key, field] of Object.entries(shape)) {
    const value = out[key];
    if (value === undefined) continue;
    // Boundary cast: zod v4 types ZodRawShape values as the internal `$ZodType`
    // base; the helpers take the public `ZodType` (same runtime object).
    const fieldType = field as z.ZodType;
    const meta = fieldFurnaceMeta(fieldType);
    if (meta?.kind === "resource") {
      // Boundary cast: `parsed` was produced by safeParse against this shape; a
      // resource field is z.string(), so this value is a string post-validation.
      out[key] = lookup(meta.table, value as string);
      continue;
    }
    const nested = asNestedObject(fieldType);
    if (nested && typeof value === "object" && value !== null) {
      // Boundary cast: a nested-object field validated to an object; recurse so
      // resource refs inside it (at any depth) resolve against its own shape.
      out[key] = resolveParams(
        nested.shape,
        value as Record<string, unknown>,
        lookup,
      );
    }
  }
  return out;
}

/**
 * Parse `value` against `schema`, translating the first zod issue into a
 * `FurnaceError` locating the failure: `scene: <where> invalid at "<path>": <message>`.
 */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  value: unknown,
  where: string,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    throw new FurnaceError(
      `scene: ${where} invalid at "${path}": ${issue?.message ?? "unknown issue"}`,
    );
  }
  return result.data;
}
