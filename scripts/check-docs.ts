// Docs-register integrity checks. Wired into `bun run check`.
// Canon for what these enforce: docs/reference/docs-system.md.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export type Violation = {
  file: string;
  line: number;
  kind: string;
  detail: string;
};

// Matches repo-relative source/doc paths. `<` `>` deliberately excluded so
// template placeholders like docs/backlog/<topic>/<slug>.md never match.
const PATH_RE =
  /(?:docs|packages)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|rs|md|wgsl|json|html|toml|css)\b/g;
// A path immediately followed by ` (gone)` (optionally closing a backtick) is a
// deliberate dead citation — the register records that something was deleted.
const GONE = /^`? \(gone\)/;

export function scanDeadPaths(
  file: string,
  text: string,
  exists: (p: string) => boolean = (p) => existsSync(join(ROOT, p)),
): Violation[] {
  const out: Violation[] = [];
  text.split("\n").forEach((line, i) => {
    if (/git show [0-9a-f]+[:^]/.test(line)) return; // commit-pinned, checked against history not the tree
    for (const m of line.matchAll(PATH_RE)) {
      const p = m[0];
      if (GONE.test(line.slice((m.index ?? 0) + p.length))) continue;
      if (!exists(p))
        out.push({ file, line: i + 1, kind: "dead-path", detail: p });
    }
  });
  return out;
}

// file.ts plus a line number → banned in live registers (line numbers are
// guaranteed rot; cite symbols instead).
const FILE_LINE_RE = /[A-Za-z0-9_./-]+\.(?:ts|tsx|rs|wgsl):\d+\b/g;

export function scanFileLineCitations(file: string, text: string): Violation[] {
  const out: Violation[] = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(FILE_LINE_RE)) {
      out.push({ file, line: i + 1, kind: "file-line-citation", detail: m[0] });
    }
  });
  return out;
}
