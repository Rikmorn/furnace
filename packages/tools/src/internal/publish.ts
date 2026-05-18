import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { $, Glob } from "bun";

export interface StageTypeScriptOptions {
  from: string;
  to: string;
}

export async function stageTypeScript(
  opts: StageTypeScriptOptions,
): Promise<void> {
  const from = resolve(opts.from);
  const to = resolve(opts.to);
  if (!existsSync(from)) {
    throw new Error(`stageTypeScript: source directory not found at ${from}`);
  }
  const glob = new Glob("**/*.ts");

  for await (const relative of glob.scan({ cwd: from })) {
    if (relative.endsWith(".test.ts")) continue;
    const src = join(from, relative);
    const dst = join(to, relative);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
  }
}

export interface EmitDeclarationsOptions {
  srcDir: string;
  outDir: string;
  baseConfig: string;
}

export async function emitDeclarations(
  opts: EmitDeclarationsOptions,
): Promise<void> {
  const srcDir = resolve(opts.srcDir);
  const outDir = resolve(opts.outDir);
  const baseConfig = resolve(opts.baseConfig);

  if (!existsSync(srcDir)) {
    throw new Error(
      `emitDeclarations: source directory not found at ${srcDir}`,
    );
  }
  if (!existsSync(baseConfig)) {
    throw new Error(
      `emitDeclarations: base tsconfig not found at ${baseConfig}`,
    );
  }

  await mkdir(outDir, { recursive: true });

  // Ephemeral tsconfig so the emit-time include is narrower than typecheck.
  // Extending baseConfig keeps strict mode, moduleResolution, and related
  // settings consistent with the workspace tsconfig.
  const tmp = await mkdtemp(join(tmpdir(), "furnace-emit-dts-"));
  try {
    const tempTsconfig = join(tmp, "tsconfig.json");
    await writeFile(
      tempTsconfig,
      JSON.stringify({
        extends: baseConfig,
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          noEmit: false,
          outDir,
          rootDir: srcDir,
        },
        include: [join(srcDir, "**/*.ts")],
      }),
    );
    await $`bunx tsc --project ${tempTsconfig}`;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
