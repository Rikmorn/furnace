// Mirrors core's TABLE_DEFAULT_KIND (validate.ts) — the frontend cannot import
// core, so the one default (materials → "standard") is duplicated here.
const DEFAULT_KIND: Record<string, string> = { materials: "standard" };

/** Split a resource entry into its kind discriminator + the params shown in the inspector. */
export function splitResourceEntry(
  table: string,
  entry: Record<string, unknown>,
): { kind: string; params: Record<string, unknown> } {
  const { kind, ...params } = entry as { kind?: unknown } & Record<
    string,
    unknown
  >;
  const resolved = typeof kind === "string" ? kind : DEFAULT_KIND[table];
  return { kind: resolved ?? "", params };
}
