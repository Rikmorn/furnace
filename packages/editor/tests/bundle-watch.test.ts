import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../src/daemon/server.ts";
import type { WatchDir } from "../src/daemon/watch.ts";

describe("bundle-outdated over SSE", () => {
  test("a source change under the extensions dir emits bundle-outdated to subscribers", async () => {
    let fire: (() => void) | undefined;
    const fakeWatchDir: WatchDir = (_dir, onChange) => {
      fire = onChange;
      return () => {
        // No real watcher to tear down — this fake never starts one.
      };
    };

    const root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-watch-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "furnace.config.json"),
        JSON.stringify({ editor: { extensions: "src/ext.ts" } }),
      );
      writeFileSync(join(root, "src", "ext.ts"), "export const ext = 1;\n");

      const server = await startServer({
        root,
        port: 0,
        watchDir: fakeWatchDir,
      });
      try {
        const res = await fetch(`http://127.0.0.1:${server.port}/api/events`);
        if (!res.body) throw new Error("SSE response has no body");
        const reader = res.body.getReader();
        await reader.read(); // ": connected" preamble

        expect(fire).toBeDefined();
        if (!fire) throw new Error("watchDir onChange was never captured");
        fire();

        const { value } = await reader.read();
        const frame = new TextDecoder().decode(value);
        expect(frame).toContain("event: bundle-outdated");
      } finally {
        server.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});
