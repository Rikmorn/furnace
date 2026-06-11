import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import fg from "fast-glob";
import { EditorError } from "./errors.ts";

/** Directories never scanned for scenes. */
const SCAN_IGNORE = ["**/node_modules/**", "**/dist/**", "**/.git/**"];

/** List project-relative scene-file paths matching `pattern`, sorted. */
export function listScenes(root: string, pattern: string): Promise<string[]> {
  return fg(pattern, { cwd: root, ignore: SCAN_IGNORE, dot: false }).then(
    (paths) => paths.sort(),
  );
}

/**
 * Read + parse a scene file by project-relative path. The resolved path must
 * stay inside `root` — the daemon serves exactly one project, never the
 * filesystem at large.
 */
export async function readScene(
  root: string,
  relPath: string,
): Promise<unknown> {
  const abs = resolve(root, relPath);
  if (relative(root, abs).startsWith("..")) {
    throw new EditorError(
      "outside-root",
      `scene path "${relPath}" is outside the project root`,
    );
  }
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch (err) {
    const code =
      err instanceof Error && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (code === "ENOENT") {
      throw new EditorError("not-found", `scene file "${relPath}" not found`);
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new EditorError(
      "unreadable",
      `scene file "${relPath}" could not be read: ${detail}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new EditorError(
      "invalid-json",
      `scene file "${relPath}" is not valid JSON: ${detail}`,
    );
  }
}
