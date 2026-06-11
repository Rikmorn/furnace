import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FRONTEND = join(import.meta.dir, "..", "src", "frontend");
// Value-level references to engine code in the chrome would create a SECOND core
// instance next to the engine bundle's — the exact bug the project-first
// invariant exists to prevent. `import type` / `export type` are fine (erased).
const ENGINE = String.raw`["']@furnace\/core`;
const FORBIDDEN = [
  new RegExp(String.raw`^import\s+(?!type\b)[^;]*?from\s+${ENGINE}`, "m"), // value import
  new RegExp(String.raw`^import\s+${ENGINE}`, "m"), // side-effect import
  new RegExp(String.raw`^export\s+(?!type\b)[^;]*?from\s+${ENGINE}`, "m"), // value re-export
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

test("frontend has no value imports of @furnace/core (project-first invariant)", () => {
  const offenders = walk(FRONTEND).filter((f) => {
    const text = readFileSync(f, "utf8");
    return FORBIDDEN.some((re) => re.test(text));
  });
  expect(offenders).toEqual([]);
});
