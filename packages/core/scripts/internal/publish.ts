import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
  /** Extra ambient declaration files (absolute paths) to include in the
   *  ephemeral tsconfig so ambient types resolve even from a temp directory.
   *  Use when the base config references types that won't resolve from tmp. */
  extraDeclarationFiles?: string[];
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
  for (const file of opts.extraDeclarationFiles ?? []) {
    if (!existsSync(file)) {
      throw new Error(
        `emitDeclarations: ambient declaration file not found at ${file}`,
      );
    }
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
          // allowImportingTsExtensions is compatible with emitDeclarationOnly.
          // Re-enable it so source files using .ts import extensions compile.
          allowImportingTsExtensions: true,
          // types in the base config (bun, @webgpu/types) resolve relative to
          // the workspace root, not a temp dir — clear them for the emit pass.
          types: [],
          outDir,
          rootDir: srcDir,
        },
        include: [join(srcDir, "**/*.ts")],
        files: opts.extraDeclarationFiles ?? [],
      }),
    );
    await $`bunx tsc --project ${tempTsconfig}`;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export interface StageAssetsOptions {
  from: string;
  to: string;
  files: string[];
}

export interface StageAssetsResult {
  copied: string[];
  missing: string[];
}

export async function stageAssets(
  opts: StageAssetsOptions,
): Promise<StageAssetsResult> {
  const from = resolve(opts.from);
  const to = resolve(opts.to);

  if (!existsSync(from)) {
    throw new Error(`stageAssets: source directory not found at ${from}`);
  }

  await mkdir(to, { recursive: true });

  const copied: string[] = [];
  const missing: string[] = [];

  for (const file of opts.files) {
    const src = join(from, file);
    if (!existsSync(src)) {
      missing.push(file);
      continue;
    }
    const dst = join(to, file);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
    copied.push(file);
  }

  return { copied, missing };
}

export interface SynthesisePackageJsonOptions {
  workspaceManifest: string;
  outPath: string;
  overrides?: Record<string, unknown>;
}

const DROPPED_KEYS = ["private", "scripts", "devDependencies"] as const;

export async function synthesisePackageJson(
  opts: SynthesisePackageJsonOptions,
): Promise<void> {
  const workspaceManifest = resolve(opts.workspaceManifest);
  const outPath = resolve(opts.outPath);

  if (!existsSync(workspaceManifest)) {
    throw new Error(
      `synthesisePackageJson: workspace manifest not found at ${workspaceManifest}`,
    );
  }

  const raw = await readFile(workspaceManifest, "utf8");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `synthesisePackageJson: manifest at ${workspaceManifest} is not valid JSON — ${detail}`,
    );
  }

  for (const key of DROPPED_KEYS) {
    delete manifest[key];
  }

  if (opts.overrides) {
    for (const [key, value] of Object.entries(opts.overrides)) {
      manifest[key] = value;
    }
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
