// packages/editor/src/frontend/lib/events.ts

/** The daemon's SSE feed events (mirror of the daemon's DaemonEvent union).
 *
 *  The last two are ADDRESSED to one connection rather than broadcast — the daemon's
 *  union says why — but nothing on this side changes for that: the frame, the listener
 *  and the mirror discipline are identical. `claim-lost`'s `world` is `string | null`
 *  because a session can be authoring the untitled scratch, which is the same nullable
 *  the chrome's own `WorldState.name` carries. */
export type ServerEvent =
  | { type: "bundle-outdated" }
  | { type: "generation-baked"; files: number }
  | { type: "worlds-changed" }
  | { type: "session-token"; token: string }
  | { type: "claim-lost"; world: string | null };

/** The subscription list, and the SECOND hand-maintained mirror in this file: an
 *  `EventSource` delivers only the names it was asked for, so a daemon event type
 *  missing from here is not a type error, it is an event that silently never arrives.
 *  `tests/events.test.ts` holds the union half; this array is what the type-level pin
 *  cannot see, and every arm above must appear below. */
const EVENT_TYPES = [
  "bundle-outdated",
  "generation-baked",
  "worlds-changed",
  "session-token",
  "claim-lost",
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
