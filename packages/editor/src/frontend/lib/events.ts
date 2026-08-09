// packages/editor/src/frontend/lib/events.ts
import type { SessionRequest } from "../../shared/wire.ts";

/** The daemon's SSE feed events (mirror of the daemon's DaemonEvent union).
 *
 *  The last three are ADDRESSED to one connection rather than broadcast — the daemon's
 *  union says why — but nothing on this side changes for that: the frame, the listener
 *  and the mirror discipline are identical. `claim-lost`'s `world` is `string | null`
 *  because a session can be authoring the untitled scratch, which is the same nullable
 *  the chrome's own `WorldState.name` carries.
 *
 *  THE LAST ARM IS NOT A MIRROR — it is the same type. `SessionRequest` lives in
 *  `shared/wire.ts` and the daemon composes its arm from it too, so the backchannel's
 *  request frame is the one event both sides IMPORT. The other five are still hand-written
 *  on each side; `shared/wire.ts` argues why they were not retrofitted, and files it. */
export type ServerEvent =
  | { type: "bundle-outdated" }
  | { type: "generation-baked"; files: number }
  | { type: "worlds-changed" }
  | { type: "session-token"; token: string }
  | { type: "claim-lost"; world: string | null }
  | ({ type: "session-request" } & SessionRequest);

/** The subscription list, and the SECOND hand-maintained mirror in this file: an
 *  `EventSource` delivers only the names it was asked for, so a daemon event type
 *  missing from here is not a type error, it is an event that silently never arrives.
 *
 *  IT STOPPED BEING PROSE IN FOUNDATIONS T4b. This array used to be guarded by the
 *  paragraph above and nothing else — `tests/events.test.ts` pinned the two UNIONS against
 *  each other, which cannot see a list of strings. It now carries a type-level pin of its
 *  own in that same file, mutual with `ServerEvent["type"]`, so a new arm without a row
 *  here fails `bun run typecheck` instead of shipping an event nobody receives. The export
 *  exists for that pin; nothing in the chrome reads it but `subscribeEvents` below. */
export const EVENT_TYPES = [
  "bundle-outdated",
  "generation-baked",
  "worlds-changed",
  "session-token",
  "claim-lost",
  "session-request",
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
