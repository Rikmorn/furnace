import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const configSchema = z.strictObject({
  scenes: z.string().default("**/*.scene.json"),
  extensions: z.string().optional(),
});

/** Editor-relevant project configuration (subset of furnace.config.json). */
export type EditorConfig = z.infer<typeof configSchema>;

/**
 * Load the project's `furnace.config.json` from `root`, applying defaults when
 * absent. Unknown fields and malformed JSON fail loud — a misspelled config
 * key silently ignored is a debugging session nobody should have.
 */
export function loadConfig(root: string): EditorConfig {
  const path = join(root, "furnace.config.json");
  if (!existsSync(path)) return configSchema.parse({});
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
  return result.data;
}
