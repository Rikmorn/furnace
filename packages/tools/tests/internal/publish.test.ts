import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emitDeclarations,
  stageTypeScript,
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
