import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chokidarWatchDir } from "../src/daemon/watch.ts";

test("chokidarWatchDir fires onChange for a file added under the dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "furnace-watchdir-"));
  let hits = 0;
  let resolveChanged!: () => void;
  const changed = new Promise<void>((r) => {
    resolveChanged = r;
  });
  const unwatch = chokidarWatchDir(dir, () => {
    hits++;
    resolveChanged();
  });
  // chokidar needs a beat to install the watcher before the write.
  await new Promise((r) => setTimeout(r, 300));
  writeFileSync(join(dir, "ext.ts"), "export const x = 1;\n");
  await changed;
  unwatch();
  expect(hits).toBeGreaterThan(0);
}, 10_000);
