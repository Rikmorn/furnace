import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chokidarWatchDir, chokidarWatchFile } from "../src/daemon/watch.ts";

test("chokidarWatchFile fires onChange for a content change", async () => {
  const dir = mkdtempSync(join(tmpdir(), "furnace-watch-"));
  const file = join(dir, "w.scene.json");
  writeFileSync(file, '{"a":1}');
  let hits = 0;
  let resolveChanged!: () => void;
  const changed = new Promise<void>((r) => {
    resolveChanged = r;
  });
  const unwatch = chokidarWatchFile(file, () => {
    hits++;
    resolveChanged();
    return Promise.resolve();
  });
  // chokidar needs a beat to install the watcher before the write.
  await new Promise((r) => setTimeout(r, 300));
  writeFileSync(file, '{"a":2}');
  await changed;
  unwatch();
  expect(hits).toBeGreaterThan(0);
}, 10_000);

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
