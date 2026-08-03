import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Glob } from "bun";

export interface BunLeakageOffender {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Scans `src/**\/*.ts` under `packageRoot` for Bun API usage.
 *
 * Co-located test files (`*.test.ts`, including `*.gpu.test.ts`) are skipped:
 * internal tests are explicitly allowed to use Bun APIs (`bun:test`,
 * `Bun.file`, etc). The shipped-surface boundary is the publish manifest, not
 * the source directory — `stageTypeScript` in
 * `packages/core/scripts/internal/publish.ts` already excludes `.test.ts`
 * files when staging sources into `dist/`, so a test file living under
 * `src/` never reaches consumers even though it sits next to shipped code.
 */
export async function scanForBunLeakage(
  packageRoot: string,
): Promise<BunLeakageOffender[]> {
  const scanPatterns = ["src/**/*.ts"];
  const offenders: BunLeakageOffender[] = [];
  // Flags any of:
  //   - `Bun.` (global usage)
  //   - `from "bun"` or `from "bun:..."` (imports)
  //   - `import "bun"` or `import "bun:..."`
  const leakagePattern =
    /\bBun\.|from\s+["']bun(:[^"']+)?["']|import\s+["']bun(:[^"']+)?["']/;

  for (const pattern of scanPatterns) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: packageRoot })) {
      // Co-located tests never ship — see doc comment above.
      if (file.endsWith(".test.ts")) continue;
      const text = await Bun.file(resolve(packageRoot, file)).text();
      text.split("\n").forEach((line, i) => {
        if (leakagePattern.test(line)) {
          offenders.push({ file, line: i + 1, snippet: line.trim() });
        }
      });
    }
  }

  return offenders;
}

test("core's public surface has no Bun coupling", async () => {
  // Anchor the scan to the core package root so the test works regardless of
  // the cwd `bun test` is invoked from (workspace root, package dir, etc).
  const packageRoot = resolve(import.meta.dir, "..");
  const offenders = await scanForBunLeakage(packageRoot);

  if (offenders.length > 0) {
    const report = offenders
      .map((o) => `  ${o.file}:${o.line} → ${o.snippet}`)
      .join("\n");
    throw new Error(`core's public surface must not use Bun APIs:\n${report}`);
  }
});

test("the leakage scan ignores co-located test files, which may use Bun APIs", async () => {
  const root = await mkdtemp(join(tmpdir(), "furnace-leak-scan-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "clean.ts"), "export const x = 1;\n");
    await writeFile(
      join(root, "src", "clean.test.ts"),
      'import { Glob } from "bun";\nexport const y = Glob;\n',
    );
    expect(await scanForBunLeakage(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
