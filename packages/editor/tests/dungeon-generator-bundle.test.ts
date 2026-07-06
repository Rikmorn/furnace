import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createEngineBundler } from "../src/daemon/bundle.ts";

const DUNGEON_ROOT = resolve(import.meta.dir, "../../dungeon");

describe("P3: project-first bundling reaches the dungeon's generators", () => {
  test("the dungeon's editor-extensions entry (importing world/layout/realize) bundles browser-clean", async () => {
    const bundler = await createEngineBundler(
      DUNGEON_ROOT,
      "src/editor-extensions.ts",
    );
    try {
      const result = await bundler.build();
      // The probe's claim: esbuild resolves + transforms the generator import graph
      // (world.ts → layout/topology/themes/realize → @furnace/core) from the dungeon
      // root with zero browser-incompatible imports. A resolve/parse failure => ok:false.
      expect(result).toEqual({ ok: true, code: expect.any(String) });
    } finally {
      await bundler.dispose();
    }
  }, 30_000);
});
