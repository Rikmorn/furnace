import { watch } from "chokidar";

/**
 * Watch one file; invoke `onChange` on content change OR deletion (the
 * consumer re-reads the file and distinguishes by the read result). Returns
 * an unwatch function. Injected into the session as a capability so tests
 * drive file-change semantics deterministically with a fake.
 */
export type WatchFile = (
  path: string,
  onChange: () => Promise<void>,
) => () => void;

/** Production adapter: chokidar v4 (pure JS over node:fs since v4 dropped fsevents). */
export const chokidarWatchFile: WatchFile = (path, onChange) => {
  const watcher = watch(path, {
    ignoreInitial: true,
    // Editors save in bursts / atomic renames; wait for the file to settle.
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
  });
  watcher.on("change", () => void onChange());
  watcher.on("unlink", () => void onChange());
  return () => {
    void watcher.close();
  };
};

/** Watch a directory tree; invoke `onChange` on any add/change/unlink beneath it.
 *  Injected into the server as a capability (tests use a fake — chokidar timing
 *  never gates a test). Returns an unwatch function. */
export type WatchDir = (dir: string, onChange: () => void) => () => void;

/** Production adapter: chokidar v4 recursive watch, node_modules/dist ignored. */
export const chokidarWatchDir: WatchDir = (dir, onChange) => {
  const watcher = watch(dir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
    ignored: (p: string) => p.includes("node_modules") || p.includes("/dist/"),
  });
  watcher.on("all", () => onChange());
  return () => {
    void watcher.close();
  };
};
