// packages/editor/src/frontend/lib/events.ts

/** The daemon's SSE feed events (mirror of the daemon's DaemonEvent union). */
export type ServerEvent =
  | { type: "bundle-outdated" }
  | { type: "generation-baked"; files: number }
  | { type: "worlds-changed" };

const EVENT_TYPES = [
  "bundle-outdated",
  "generation-baked",
  "worlds-changed",
] as const;

/**
 * Subscribe to /api/events. `onOpen` fires on every (re)connect, so the caller can
 * refetch whatever it mirrors and catch up on events missed while disconnected.
 * Returns an unsubscribe function.
 */
export function subscribeEvents(handlers: {
  onOpen(): void;
  onEvent(event: ServerEvent): void;
}): () => void {
  const source = new EventSource("/api/events");
  source.onopen = () => handlers.onOpen();
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (e) => {
      // Boundary cast: the daemon emits exactly these JSON shapes per event
      // name (events.ts emit writes `event: <type>` + the serialized event).
      handlers.onEvent(JSON.parse((e as MessageEvent).data) as ServerEvent);
    });
  }
  return () => source.close();
}
