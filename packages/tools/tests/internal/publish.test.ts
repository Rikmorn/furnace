import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emitDeclarations,
  stageAssets,
  stageTypeScript,
  synthesisePackageJson,
} from "../../src/internal/publish.ts";

test("stageTypeScript: copies .ts files preserving directory structure", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "furnace-stage-ts-"));
  try {
    const from = join(tmp, "src");
    const to = join(tmp, "out");
    await mkdir(join(from, "lib"), { recursive: true });
    await writeFile(join(from, "index.ts"), "export const a = 1;\n");
    await writeFile(join(from, "lib", "util.ts"), "export const b = 2;\n");
    await writeFile(
      join(from, "lib", "util.test.ts"),
      "/* should be excluded */\n",
    );

    await stageTypeScript({ from, to });

    expect(await Bun.file(join(to, "index.ts")).text()).toBe(
      "export const a = 1;\n",
    );
    expect(await Bun.file(join(to, "lib/util.ts")).text()).toBe(
      "export const b = 2;\n",
    );
    expect(await Bun.file(join(to, "lib/util.test.ts")).exists()).toBe(false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("stageTypeScript: throws a helpful error when source directory does not exist", async () => {
  await expect(
    stageTypeScript({
      from: join(tmpdir(), "furnace-stage-ts-does-not-exist-xyz"),
      to: join(tmpdir(), "furnace-stage-ts-out-xyz"),
    }),
  ).rejects.toThrow(/source directory not found/i);
});

test("emitDeclarations: emits .d.ts files for a small TS project", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "furnace-emit-dts-"));
  try {
    const srcDir = join(tmp, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "index.ts"),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture content
      "export const greet = (n: string): string => `hi ${n}`;\n",
    );

    const baseConfig = join(tmp, "base-tsconfig.json");
    await writeFile(
      baseConfig,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ESNext",
          module: "Preserve",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: true,
          skipLibCheck: true,
        },
      }),
    );

    const outDir = join(tmp, "types");
    await emitDeclarations({ srcDir, outDir, baseConfig });

    const dts = await Bun.file(join(outDir, "index.d.ts")).text();
    expect(dts).toContain("greet");
    expect(dts).toContain("string");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("stageAssets: throws a helpful error when source directory does not exist", async () => {
  await expect(
    stageAssets({
      from: join(tmpdir(), "furnace-assets-does-not-exist-xyz"),
      to: join(tmpdir(), "furnace-assets-out-xyz"),
      files: ["README.md"],
    }),
  ).rejects.toThrow(/source directory not found/i);
});

test("stageAssets: copies listed files; skips missing ones with a warning return", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "furnace-assets-"));
  try {
    const from = join(tmp, "src");
    const to = join(tmp, "out");
    await mkdir(from, { recursive: true });
    await writeFile(join(from, "README.md"), "# Hello\n");
    await writeFile(join(from, "LICENSE"), "MIT\n");

    const result = await stageAssets({
      from,
      to,
      files: ["README.md", "LICENSE", "CHANGELOG.md"],
    });

    expect(await Bun.file(join(to, "README.md")).text()).toBe("# Hello\n");
    expect(await Bun.file(join(to, "LICENSE")).text()).toBe("MIT\n");
    expect(await Bun.file(join(to, "CHANGELOG.md")).exists()).toBe(false);
    expect(result.copied).toEqual(["README.md", "LICENSE"]);
    expect(result.missing).toEqual(["CHANGELOG.md"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("synthesisePackageJson: drops private, scripts, devDependencies; applies overrides", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "furnace-pkgjson-"));
  try {
    const inputPath = join(tmp, "package.json");
    const outputPath = join(tmp, "out", "package.json");
    await writeFile(
      inputPath,
      JSON.stringify({
        name: "@furnace/core",
        version: "0.0.0",
        private: true,
        type: "module",
        exports: { ".": "./src/index.ts" },
        scripts: { build: "bun scripts/build.ts" },
        devDependencies: { "@furnace/tools": "workspace:*" },
      }),
    );

    await synthesisePackageJson({
      workspaceManifest: inputPath,
      outPath: outputPath,
      overrides: {
        exports: {
          ".": { types: "./types/index.d.ts", default: "./src/index.ts" },
        },
        files: ["src/**", "types/**"],
      },
    });

    const result = JSON.parse(await Bun.file(outputPath).text());
    expect(result.name).toBe("@furnace/core");
    expect(result.version).toBe("0.0.0");
    expect(result.type).toBe("module");
    expect(result.private).toBeUndefined();
    expect(result.scripts).toBeUndefined();
    expect(result.devDependencies).toBeUndefined();
    expect(result.exports["."].types).toBe("./types/index.d.ts");
    expect(result.files).toEqual(["src/**", "types/**"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
