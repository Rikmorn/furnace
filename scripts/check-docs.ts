// Docs-register integrity checks. Wired into `bun run check`.
// Canon for what these enforce: docs/reference/docs-system.md.
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

// <!-- derive: CMD -->VALUE<!-- /derive --> — VALUE is re-derived by running CMD
// (sh at repo root) and trimming. Deterministic commands only (sort, stable output).
// CMD comes from a TRACKED doc — same trust domain as the repo's own scripts.
const DERIVE_RE = /<!-- derive: (.+?) -->([\s\S]*?)<!-- \/derive -->/g;

export function checkDeriveMarkers(file: string, text: string): Violation[] {
  const out: Violation[] = [];
  for (const m of text.matchAll(DERIVE_RE)) {
    const cmd = m[1] ?? "";
    const recorded = (m[2] ?? "").trim();
    const line = text.slice(0, m.index).split("\n").length;
    const proc = Bun.spawnSync(["sh", "-c", cmd], { cwd: ROOT });
    if (proc.exitCode !== 0) {
      out.push({
        file,
        line,
        kind: "derive-error",
        detail: `\`${cmd}\` exited ${proc.exitCode}`,
      });
      continue;
    }
    const actual = proc.stdout.toString().trim();
    if (actual !== recorded) {
      out.push({
        file,
        line,
        kind: "derive-drift",
        detail: `\`${cmd}\`: expected ${actual}, doc says ${recorded}`,
      });
    }
  }
  return out;
}

const LIVE_REGISTERS = ["docs/backlog", "docs/reference", "docs/work"]; // docs/work lands in Task 10

export function collectLiveRegisterFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".md")) out.push(rel);
    }
  };
  for (const r of LIVE_REGISTERS) {
    if (existsSync(join(ROOT, r))) walk(r);
  }
  return out.sort();
}

if (import.meta.main) {
  const violations: Violation[] = [];
  for (const f of collectLiveRegisterFiles()) {
    const text = readFileSync(join(ROOT, f), "utf8");
    violations.push(
      ...scanDeadPaths(f, text),
      ...scanFileLineCitations(f, text),
      ...checkDeriveMarkers(f, text),
    );
  }
  if (violations.length > 0) {
    for (const v of violations)
      console.error(`${v.file}:${v.line} [${v.kind}] ${v.detail}`);
    console.error(`\ncheck-docs: ${violations.length} violation(s).`);
    process.exit(1);
  }
  console.log("check-docs: clean.");
}
