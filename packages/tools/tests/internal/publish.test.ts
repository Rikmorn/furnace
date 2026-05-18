import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageTypeScript } from "../../src/internal/publish.ts";

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
