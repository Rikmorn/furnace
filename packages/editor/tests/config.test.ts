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
  expect(cfg).toEqual({ extensions: undefined });
});

test("CLI-owned top-level fields are tolerated (the hello-world collision)", () => {
  const root = tempRoot();
  writeFileSync(
    join(root, "furnace.config.json"),
    JSON.stringify({
      identity: { name: "x", bundleId: "c.x", version: "0.0.0" },
      source: "src/",
      window: { title: "x", width: 1, height: 1 },
      editor: { extensions: "src/editor-extensions.ts" },
    }),
  );
  expect(loadConfig(root).extensions).toBe("src/editor-extensions.ts");
});

test("absent editor block falls back to defaults even with CLI fields present", () => {
  const root = tempRoot();
  writeFileSync(
    join(root, "furnace.config.json"),
    JSON.stringify({ source: "src/" }),
  );
  expect(loadConfig(root)).toEqual({ extensions: undefined });
});

test("unknown fields INSIDE the editor block fail loud (setup-loud policy)", () => {
  const root = tempRoot();
  writeFileSync(
    join(root, "furnace.config.json"),
    JSON.stringify({ editor: { extensiosn: "typo/**" } }),
  );
  expect(() => loadConfig(root)).toThrow(/extensiosn/);
});

test("malformed JSON fails loud with the file named", () => {
  const root = tempRoot();
  writeFileSync(join(root, "furnace.config.json"), "{ not json");
  expect(() => loadConfig(root)).toThrow(/furnace\.config\.json/);
});
