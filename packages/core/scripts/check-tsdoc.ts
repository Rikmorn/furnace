import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { checkTsdocForModule, type TsdocViolation } from "./internal/index.ts";

const PKG_ROOT = resolve(import.meta.dir, "..");
const SRC_ROOT = resolve(PKG_ROOT, "src");

function collectModuleIndices(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(SRC_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = resolve(SRC_ROOT, entry.name, "index.ts");
    if (!existsSync(indexPath)) continue;
    out.push(indexPath);
  }
  return out;
}

function formatViolation(v: TsdocViolation): string {
  const rel = v.declarationFile.replace(
    `${resolve(PKG_ROOT, "..", "..")}/`,
    "",
  );
  return `  ✗ ${rel}:${v.line} — export \`${v.exportName}\` lacks TSDoc`;
}

const indices = collectModuleIndices();
const all: TsdocViolation[] = [];
for (const idx of indices) {
  all.push(...checkTsdocForModule(idx));
}

if (all.length === 0) {
  console.log("check-tsdoc: 0 violations across", indices.length, "modules");
  process.exit(0);
}

const byFile = new Map<string, TsdocViolation[]>();
for (const v of all) {
  const list = byFile.get(v.declarationFile) ?? [];
  list.push(v);
  byFile.set(v.declarationFile, list);
}

for (const list of byFile.values()) {
  for (const v of list) console.error(formatViolation(v));
}
console.error(
  `\ncheck-tsdoc: ${all.length} violation(s) across ${byFile.size} file(s)`,
);
process.exit(1);
