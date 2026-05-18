import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileNativeCrate } from "../../src/internal/rust.ts";

test("compileNativeCrate: throws a helpful error when the manifest does not exist", async () => {
  await expect(
    compileNativeCrate({
      manifestPath: resolve(import.meta.dir, "does-not-exist/Cargo.toml"),
      profile: "release",
      outBinaryDir: resolve(import.meta.dir, "tmp"),
      binaryName: "nope",
    }),
  ).rejects.toThrow(/manifest/i);
});
