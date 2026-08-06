import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The daemon + field-host source must stay Node-portable: no Bun APIs.
// (Internal tests/scripts may use Bun freely — this scans src/ only.)
const SRC = join(import.meta.dir, "..", "src");
const BUN_PATTERNS = [
  /\bBun\./,
  /from\s+["']bun(:[^"']+)?["']/,
  /import\s+["']bun(:[^"']+)?["']/,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("editor src/ contains no Bun-API usage (Node-portable contract)", () => {
  const offenders = walk(SRC).filter((f) => {
    const text = readFileSync(f, "utf8");
    return BUN_PATTERNS.some((re) => re.test(text));
  });
  expect(offenders).toEqual([]);
});
