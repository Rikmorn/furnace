import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRegistryLoader } from "../src/daemon/registry-bundle.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "mini-project");

test("loads validateDocument + introspect from the consumer's core, with extensions registered", async () => {
  const loader = createRegistryLoader(FIXTURE, "src/editor-extensions.ts");
  const reg = await loader.current();
  expect(reg.CURRENT_SCENE_VERSION).toBe(1);
  // fixtureGlow is registered by the fixture extension — Branch A in the daemon.
  expect(JSON.stringify(reg.introspect())).toContain("fixtureGlow");
  // A valid document passes…
  expect(() =>
    reg.validateDocument({
      version: 1,
      entities: [{ id: "e", components: { fixtureGlow: { intensity: 2 } } }],
    }),
  ).not.toThrow();
  // …and a schema violation throws with the registry's own message.
  expect(() =>
    reg.validateDocument({
      version: 1,
      entities: [{ id: "e", components: { fixtureGlow: { intensity: "x" } } }],
    }),
  ).toThrow(/fixtureGlow/);
});

test("current() caches; reload() builds fresh", async () => {
  const loader = createRegistryLoader(FIXTURE, "src/editor-extensions.ts");
  const a = await loader.current();
  expect(await loader.current()).toBe(a);
  expect(await loader.reload()).not.toBe(a);
});

test("a broken extensions entry fails with extension-build-failed and diagnostics", async () => {
  // In-workspace temp root so esbuild can resolve @furnace/core (workspace
  // node_modules) and then hit the genuinely-missing extension import — the
  // same pattern as server.test.ts's broken-engine test.
  const root = mkdtempSync(join(import.meta.dir, "fixtures", "broken-reg-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "broken.ts"),
      'import { nope } from "./missing.ts";',
    );
    const loader = createRegistryLoader(root, "src/broken.ts");
    await expect(loader.current()).rejects.toMatchObject({
      code: "extension-build-failed",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
