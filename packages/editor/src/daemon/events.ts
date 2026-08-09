import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ClaimKey } from "./claims.ts";

const HEARTBEAT_MS = 15_000;

/** Everything the daemon broadcasts on its SSE feed. `bundle-outdated`
 *  = a source file under the extensions entry's directory changed; /engine.js will
 *  serve the fresh bundle on next fetch (it rebuilds per GET) — the browser just
 *  needs to know to reload. `generation-baked` = the browser uploaded a freshly
 *  baked world file set (via generation.bake) and the daemon wrote it to the project
 *  root; `files` is how many were written. `worlds-changed` = the worlds
 *  directory or its index changed (world.delete/rename/duplicate/makeDefault
 *  each raise it after their FS mutation succeeds); consumers should refetch
 *  world.list.
 *
 *  THE LAST TWO ARE NOT BROADCASTS, and the union says so nowhere else, so it says it
 *  here (foundations T4b). `session-token` and `claim-lost` are written to ONE
 *  connection through {@link EventHub.emitTo}; delivering either to every subscriber
 *  would be a bug rather than noise — a broadcast token would hand every tab the name
 *  of every other tab's connection, and a broadcast `claim-lost` would blank the tab
 *  that just WON the world. What stays true for all five is the wire: one generic
 *  `event: <type>\ndata: <json>` frame, one hand-mirrored `ServerEvent` arm and one
 *  `EVENT_TYPES` row in `frontend/lib/events.ts` (an unlisted type is silently never
 *  delivered — `tests/events.test.ts` holds the type-level mirror pin).
 *
 *  `session-token` = "this connection is now named `token`", the FIRST frame every
 *  subscriber gets; see {@link EventHub.subscribe} for what the name is and is not for.
 *  `claim-lost` = another session took `world` from the connection this frame is
 *  addressed to (`daemon/claims.ts`). */
export type DaemonEvent =
  | { type: "bundle-outdated" }
  | { type: "generation-baked"; files: number }
  | { type: "worlds-changed" }
  | { type: "session-token"; token: string }
  | { type: "claim-lost"; world: ClaimKey };

/**
 * SSE broadcaster for daemon events. Events are notification-only dirty-bits:
 * consumers refetch the command that owns the changed state (e.g. world.list on
 * `worlds-changed`), so a slow consumer naturally coalesces N changes into one
 * refetch. No payload protocol beyond the event itself.
 *
 * Since foundations T4b the hub ALSO names its connections. That is not a second
 * responsibility bolted on: a token is a name for a subscriber, subscribers are what
 * this module owns, and the mint has to happen where the connection is created and be
 * forgotten where it dies — both of which are inside {@link EventHub.subscribe}.
 */
export type EventHub = {
  emit(event: DaemonEvent): void;
  /** Write one frame to ONE subscriber. Silently does nothing for a connection the hub
   *  no longer holds, which is the honest answer: a write to a closed response reaches
   *  nobody, and the caller (a claim that was just stolen, a request addressed to the
   *  claimed session) has no better recourse than to have missed it. */
  emitTo(connection: ServerResponse, event: DaemonEvent): void;
  /** Open one feed. Takes the REQUEST as well as the response, and that is not
   *  cosmetic — see the departure note inside for the measurement that forced it. */
  subscribe(req: IncomingMessage, res: ServerResponse): void;
  /** The live connection a token names, or undefined for a token this hub never minted
   *  or has since forgotten. Resolution is by live-table lookup, so a token outlives
   *  nothing — when the connection closes the name stops meaning anything at all. */
  connectionFor(token: string): ServerResponse | undefined;
  /** Be told when a subscriber's connection departs — the daemon's ONE liveness signal,
   *  and this is how anything else gets to hear it (`server.ts` wires the claim table's
   *  release to it).
   *
   *  EXACTLY ONCE per departure, which is a promise rather than an accident: `subscribe`
   *  watches `req` AND `res` because no single one of them fires on both runtimes, and
   *  Node raises both. A listener may therefore assume its handler runs once for a
   *  connection that has gone, and Task 3's pending-ask rejector will need that. */
  onClose(handler: (connection: ServerResponse) => void): void;
  close(): void;
};

/** One SSE frame. Every event type rides the same generic shape — the wire carries no
 *  per-type knowledge, which is why adding an arm is a union edit and not a protocol. */
function frameFor(event: DaemonEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createEventHub(): EventHub {
  const subscribers = new Set<ServerResponse>();
  const byToken = new Map<string, ServerResponse>();
  const closeHandlers: ((connection: ServerResponse) => void)[] = [];
  const heartbeat = setInterval(() => {
    for (const res of subscribers) res.write(": ping\n\n");
  }, HEARTBEAT_MS);
  // Heartbeats alone must not hold the process open.
  heartbeat.unref();

  return {
    emit(event) {
      const frame = frameFor(event);
      for (const res of subscribers) res.write(frame);
    },
    emitTo(connection, event) {
      if (!subscribers.has(connection)) return;
      connection.write(frameFor(event));
    },
    /**
     * Open one feed, and NAME it.
     *
     * WHAT THE TOKEN IS. A POST and this stream are different HTTP requests, so a
     * command that must act on behalf of *this* connection — `session.claim` and its
     * two siblings — has no way to say which one it is. The token is that way: an
     * opaque name minted here, written into this stream as its first frame, and echoed
     * back in the POST body, where `connectionFor` turns it into the very
     * `ServerResponse` object the claim table keys on. It is a name for a socket, the
     * way a file descriptor is a name for a file.
     *
     * WHAT IT IS NOT — and this half matters more, because a random 128-bit string
     * looks like a credential and is not one. **It authenticates nothing.** The daemon
     * binds 127.0.0.1 and serves one local single-user session; `origin.ts` argues at
     * length why it does not authenticate, and this changes none of it. The question a
     * token answers has N equally legitimate answers, one per open tab — *which* of my
     * subscribers are you, never *may* you. If one leaked, the holder would gain
     * exactly what a second tab already has by opening the editor: the ability to claim
     * or steal a world in a single-user local tool. Treating it as a secret with teeth
     * would invent an authorization boundary the daemon deliberately does not have, and
     * every later reader would then have to maintain the fiction.
     *
     * WHY IT IS NOT A SECOND THING TO STEAL, on `origin.ts`'s own threat model. The
     * attack that reaches this port is a page the user merely visited whose DNS answers
     * `127.0.0.1`. Obtaining a token means READING a response body: either this stream
     * or nothing, since it is written nowhere else. That page cannot open this stream —
     * `assertLoopbackOrigin` runs ahead of every branch and refuses it 403 before
     * `subscribe` is reached (pinned per-branch in `tests/server.test.ts`, the SSE case
     * asserting a JSON content-type precisely to prove no stream opened) — and it could
     * not read the body if it did, there being no CORS headers. So the token adds no
     * reachable surface. It is `randomUUID` rather than a counter for the ordinary
     * reason to prefer one: a guessable name would make the *unreachable* case
     * interesting, and CSPRNG bytes are free.
     *
     * WHY AN MCP CLIENT CAN NEVER PRESENT ONE. This function is the only mint, and it
     * is reachable only through `GET /api/events`. The mint is written INTO the stream
     * it opens, so receiving a token means holding that stream open; and resolution is
     * a live-table lookup, so a token whose stream has closed names nothing. The MCP
     * door (`/mcp`, T4b Task 5) never routes here and holds no stream — it is a guest,
     * and its calls read THROUGH a claimed session rather than holding one. The
     * guarantee is structural rather than a check: there is nothing to enforce, because
     * there is no path.
     *
     * WHY THE FIRST FRAME IS A REAL EVENT AND NOT THE `": connected"` LINE. It could
     * not have been: a line beginning `:` is an SSE COMMENT, and `EventSource` exposes
     * comments to JavaScript nowhere at all — they exist to keep proxies from timing the
     * connection out. A client cannot read a token that rides one.
     *
     * AND WHY DEPARTURE IS WATCHED ON BOTH `req` AND `res` — a correction, measured at
     * T4b Task 2 rather than reasoned, and the reason this function takes the request at
     * all. **`res.on("close", …)` NEVER FIRES UNDER BUN.** Node 22 raises it 2–5 ms after
     * a client disconnects; Bun 1.3.14 raises it never, by any route — raw socket
     * destroy, `fetch` abort or reader cancel. That is the runtime the editor is actually
     * started on (`bun ../editor/src/daemon/main.ts`, both `edit` scripts), so the
     * subscriber cleanup this line has carried since the daemon's first commit had been a
     * no-op in the live editor the whole time: a leak that showed as nothing, because
     * writing to a departed response is swallowed. The claim table cannot survive that —
     * a claim that never releases means every reload meets a steal prompt — so this is
     * fixed here rather than filed.
     *
     * `req.on("close")` fires on BOTH runtimes, within 2 ms, for both ways a real client
     * leaves (the browser closing an EventSource, and a test's `fetch` abort), and fires
     * on NEITHER while a client sits happily connected — probed at 600 ms with an open
     * stream, which is the false-positive direction that would matter. Both are wired
     * anyway, latched to run once, because betting the daemon's only liveness signal on
     * one runtime's event semantics is the bet that just lost.
     */
    subscribe(req, res) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      subscribers.add(res);
      const token = randomUUID();
      byToken.set(token, res);
      let departed = false;
      const depart = (): void => {
        if (departed) return;
        departed = true;
        subscribers.delete(res);
        byToken.delete(token);
        for (const handler of closeHandlers) handler(res);
      };
      res.on("close", depart);
      req.on("close", depart);
      res.write(frameFor({ type: "session-token", token }));
    },
    connectionFor(token) {
      return byToken.get(token);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
    close() {
      clearInterval(heartbeat);
      for (const res of subscribers) res.end();
      subscribers.clear();
      // The names go with the connections. `closeHandlers` are NOT fired here, and the
      // reason is ownership rather than a bet on what `res.end()` raises — an earlier
      // version of this comment made that bet ("each real response's own `close` follows
      // in a moment"), i.e. exactly the claim this file measured false on the runtime
      // the editor is started on. What
      // is true whatever the runtime does: this runs only from `startServer`'s `close()`,
      // the hub and the claim table are built together and die together there, and a
      // listener told about a connection on a hub that no longer exists has nothing to
      // do. If a departure IS reported afterwards the latch in `subscribe` has already
      // been armed for it, so nothing double-fires either way.
      byToken.clear();
    },
  };
}
