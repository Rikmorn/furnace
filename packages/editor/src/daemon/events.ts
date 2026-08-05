import type { ServerResponse } from "node:http";

const HEARTBEAT_MS = 15_000;

/** Everything the daemon broadcasts on its SSE feed. `bundle-outdated`
 *  = a source file under the extensions entry's directory changed; /engine.js will
 *  serve the fresh bundle on next fetch (it rebuilds per GET) — the browser just
 *  needs to know to reload. `generation-baked` = the browser uploaded a freshly
 *  baked world file set (via generation.bake) and the daemon wrote it to the project
 *  root; `files` is how many were written. `worlds-changed` = the worlds
 *  directory or its index changed (world.delete/rename/duplicate/makeDefault
 *  each raise it after their FS mutation succeeds); consumers should refetch
 *  world.list. */
export type DaemonEvent =
  | { type: "bundle-outdated" }
  | { type: "generation-baked"; files: number }
  | { type: "worlds-changed" };

/**
 * SSE broadcaster for daemon events. Events are notification-only dirty-bits:
 * consumers refetch the command that owns the changed state (e.g. world.list on
 * `worlds-changed`), so a slow consumer naturally coalesces N changes into one
 * refetch. No payload protocol beyond the event itself.
 */
export type EventHub = {
  emit(event: DaemonEvent): void;
  subscribe(res: ServerResponse): void;
  close(): void;
};

export function createEventHub(): EventHub {
  const subscribers = new Set<ServerResponse>();
  const heartbeat = setInterval(() => {
    for (const res of subscribers) res.write(": ping\n\n");
  }, HEARTBEAT_MS);
  // Heartbeats alone must not hold the process open.
  heartbeat.unref();

  return {
    emit(event) {
      const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const res of subscribers) res.write(frame);
    },
    subscribe(res) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      subscribers.add(res);
      res.on("close", () => subscribers.delete(res));
    },
    close() {
      clearInterval(heartbeat);
      for (const res of subscribers) res.end();
      subscribers.clear();
    },
  };
}
