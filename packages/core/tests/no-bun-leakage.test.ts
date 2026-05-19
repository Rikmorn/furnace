import { test } from "bun:test";
import { resolve } from "node:path";
import { Glob } from "bun";

test("core's public surface has no Bun coupling", async () => {
  // Anchor the scan to the core package root so the test works regardless of
  // the cwd `bun test` is invoked from (workspace root, package dir, etc).
  const packageRoot = resolve(import.meta.dir, "..");
  const scanPatterns = ["src/**/*.ts"];
  const offenders: { file: string; line: number; snippet: string }[] = [];
  // Flags any of:
  //   - `Bun.` (global usage)
  //   - `from "bun"` or `from "bun:..."` (imports)
  //   - `import "bun"` or `import "bun:..."`
  const leakagePattern =
    /\bBun\.|from\s+["']bun(:[^"']+)?["']|import\s+["']bun(:[^"']+)?["']/;

  for (const pattern of scanPatterns) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: packageRoot })) {
      const text = await Bun.file(resolve(packageRoot, file)).text();
      text.split("\n").forEach((line, i) => {
        if (leakagePattern.test(line)) {
          offenders.push({ file, line: i + 1, snippet: line.trim() });
        }
      });
    }
  }

  if (offenders.length > 0) {
    const report = offenders
      .map((o) => `  ${o.file}:${o.line} → ${o.snippet}`)
      .join("\n");
    throw new Error(`core's public surface must not use Bun APIs:\n${report}`);
  }
});
