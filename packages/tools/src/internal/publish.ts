import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Glob } from "bun";

export interface StageTypeScriptOptions {
  from: string;
  to: string;
}

export async function stageTypeScript(
  opts: StageTypeScriptOptions,
): Promise<void> {
  const from = resolve(opts.from);
  const to = resolve(opts.to);
  const glob = new Glob("**/*.ts");

  for await (const relative of glob.scan({ cwd: from })) {
    if (relative.endsWith(".test.ts")) continue;
    const src = join(from, relative);
    const dst = join(to, relative);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
  }
}
