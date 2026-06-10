import { z } from "zod";
import { FurnaceError } from "../errors.ts";
import type { FurnaceMeta, TableHandle, TableName } from "./t.ts";

/**
 * Maps a raw param shape to its build-side type: `t.resource` fields become
 * live handles (`TableHandle`), everything else keeps its document-side
 * inferred type (optionality preserved). The phantom `_furnaceTable` on
 * `ResourceSchema` drives the mapping; `t.ref` fields stay id strings (M6
 * resolves them).
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
      ? V
      : TableHandle<FurnaceTableOf<Inner>> | undefined
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
 * Swap boundary-validated resource-id strings for live handles via `lookup`.
 * Walks top-level shape fields only (nested objects carry no refs in v1).
 * Plain fields and `t.ref` fields pass through untouched.
 */
export function resolveParams(
  shape: z.ZodRawShape,
  parsed: Record<string, unknown>,
  lookup: (table: TableName, id: string) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed };
  for (const [key, field] of Object.entries(shape)) {
    // Boundary cast: zod v4 types ZodRawShape values as the internal `$ZodType`
    // base; `fieldFurnaceMeta` takes the public `ZodType` (same runtime object).
    const meta = fieldFurnaceMeta(field as z.ZodType);
    if (meta?.kind === "resource" && out[key] !== undefined) {
      // Boundary cast: `parsed` was produced by safeParse against this shape; a
      // resource field is z.string(), so this value is a string post-validation.
      out[key] = lookup(meta.table, out[key] as string);
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
