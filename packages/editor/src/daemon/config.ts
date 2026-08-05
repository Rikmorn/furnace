import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const editorSchema = z.strictObject({
  extensions: z.string().optional(),
});

// Top level belongs to the furnace CLI (identity/source/window/…): parse
// loosely — those fields are not ours to validate. The `editor` block is
// ours: strict, so a typo'd key fails loud.
const configSchema = z.object({ editor: editorSchema.optional() });

/** Editor-relevant project configuration (subset of furnace.config.json). */
export type EditorConfig = z.infer<typeof editorSchema>;

/**
 * Load the project's `furnace.config.json` from `root`, applying defaults when
 * absent. Malformed JSON fails loud — a file named in the error message.
 *
 * **Namespacing contract:** `furnace.config.json` is shared with the `furnace`
 * CLI (Rust). Top-level fields (`identity`, `source`, `window`, …) belong to
 * the CLI and are parsed loosely — the editor does not validate them. The
 * `"editor"` block is the editor's own namespace and is parsed strictly: a
 * typo'd key inside `editor` throws loud (setup-loud policy). If the `editor`
 * block is absent, all editor settings fall back to defaults.
 */
export function loadConfig(root: string): EditorConfig {
  const path = join(root, "furnace.config.json");
  if (!existsSync(path)) return editorSchema.parse({});
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`furnace.config.json is not valid JSON: ${detail}`);
  }
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue?.path.length ? ` at "${issue.path.join(".")}"` : "";
    throw new Error(
      `furnace.config.json invalid${location}: ${issue?.message ?? "unknown"}`,
    );
  }
  return result.data.editor ?? editorSchema.parse({});
}
