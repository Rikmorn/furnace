import { watch } from "chokidar";

/** Watch a directory tree; invoke `onChange` on any add/change/unlink beneath it.
 *  Injected into the server as a capability (tests use a fake — chokidar timing
 *  never gates a test). Returns an unwatch function. */
export type WatchDir = (dir: string, onChange: () => void) => () => void;

/** Production adapter: chokidar v4 recursive watch (pure JS over node:fs since v4
 *  dropped fsevents), node_modules/dist ignored. */
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
