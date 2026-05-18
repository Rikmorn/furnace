import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { $ } from "bun";

export interface CompileNativeCrateOptions {
  manifestPath: string;
  profile: "release" | "debug";
  outBinaryDir: string;
  binaryName: string;
}

export async function compileNativeCrate(
  opts: CompileNativeCrateOptions,
): Promise<string> {
  const manifestPath = resolve(opts.manifestPath);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `compileNativeCrate: manifest not found at ${manifestPath}`,
    );
  }

  const profileFlag = opts.profile === "release" ? ["--release"] : [];
  await $`cargo build ${profileFlag} --manifest-path ${manifestPath}`;

  const crateDir = dirname(manifestPath);
  const targetDir = resolve(crateDir, "../../../target", opts.profile);
  const exeSuffix = process.platform === "win32" ? ".exe" : "";
  const sourceBinary = join(targetDir, `${opts.binaryName}${exeSuffix}`);

  if (!existsSync(sourceBinary)) {
    throw new Error(
      `compileNativeCrate: expected binary not found at ${sourceBinary}`,
    );
  }

  await mkdir(opts.outBinaryDir, { recursive: true });
  const destBinary = join(opts.outBinaryDir, `${opts.binaryName}${exeSuffix}`);
  await copyFile(sourceBinary, destBinary);
  return destBinary;
}
