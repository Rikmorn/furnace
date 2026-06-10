import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/daemon/config.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "furnace-editor-test-"));
}

test("defaults when furnace.config.json is absent", () => {
  const cfg = loadConfig(tempRoot());
  expect(cfg).toEqual({ scenes: "**/*.scene.json", extensions: undefined });
});

test("reads scenes + extensions from furnace.config.json", () => {
  const root = tempRoot();
  writeFileSync(
    join(root, "furnace.config.json"),
    JSON.stringify({
      scenes: "assets/**/*.scene.json",
      extensions: "src/editor-extensions.ts",
    }),
  );
  const cfg = loadConfig(root);
  expect(cfg.scenes).toBe("assets/**/*.scene.json");
  expect(cfg.extensions).toBe("src/editor-extensions.ts");
});

test("unknown fields fail loud (setup-loud policy)", () => {
  const root = tempRoot();
  writeFileSync(
    join(root, "furnace.config.json"),
    JSON.stringify({ scense: "typo/**" }),
  );
  expect(() => loadConfig(root)).toThrow(/scense/);
});

test("malformed JSON fails loud with the file named", () => {
  const root = tempRoot();
  writeFileSync(join(root, "furnace.config.json"), "{ not json");
  expect(() => loadConfig(root)).toThrow(/furnace\.config\.json/);
});
