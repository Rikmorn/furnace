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
