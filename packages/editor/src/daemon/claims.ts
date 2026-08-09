// packages/editor/src/daemon/claims.ts
import type { ServerResponse } from "node:http";

/**
 * The world a session is authoring, as the claim table keys it: a name on disk, or
 * `null` for the untitled scratch a fresh editor boots into.
 *
 * `null` IS A KEY, not an absence, and that is the whole reason this type exists rather
 * than a bare `string`. `WorldState.name` (`frontend/hooks/useWorld.tsx`) is
 * `string | null` and is "never prefilled" by design — the W3/W4 gate-clobber lesson —
 * so the commonest session in the editor's life, the one a user is digging in before
 * they have named anything, has no name to claim under. A reserved sentinel STRING
 * would have to be un-collidable with `WORLD_NAME_RE` and explained wherever it is
 * read; `null` is what the chrome already calls that state, so the wire says what the
 * chrome means. Two untitled tabs then contend for the same key, which is the settled
 * policy's own answer: they cannot both be the session an agent is driving.
 */
export type ClaimKey = string | null;

/**
 * Who is authoring what, right now — **the first daemon-resident state in the editor's
 * history**, and deliberately the smallest kind there is.
 *
 * THE RECONCILIATION, stated once and in full, because "the daemon stays stateless" is
 * a rule this table appears to break and does not: **there is no DURABLE authoring
 * state here — this table is the same class of thing as the subscriber set beside it in
 * `events.ts`.** It is connection-scoped ephemera keyed to the SSE subscriber lifecycle.
 * A claim is born when a live connection asks for one and dies when the event hub
 * reports that connection's departure — the daemon's only liveness signal, and a LATCHED
 * PAIR rather than the single handler it reads like: `res.on("close", …)` is what Node 22
 * raises (2–5 ms) and what Bun 1.3.14 raises NEVER, so `req.on("close", …)` — which both
 * raise, within 2 ms — is the half that actually carries a departure in the live editor,
 * which the `edit` scripts start on Bun rather than Node. `events.ts`'s `subscribe`
 * holds the measurement and the latch
 * that makes one departure arrive once. Nothing is written,
 * nothing is read back at boot, and a daemon restart begins with an empty table by
 * construction rather than by a clearing step. The daemon still owns bytes and the
 * filesystem and no document; what it now also owns is a note of which socket is
 * allowed to speak for the editor, which lasts exactly as long as the socket.
 *
 * NO GRACE PERIOD, AND NONE IS NEEDED — measured at the T4b Task 0 reconnect spike
 * rather than assumed. When a connection dies under an established client the daemon's
 * `close` fires **3.5 ms** later and the browser's automatic re-subscribe arrives
 * **3004 ms** after that: the close PRECEDES the reconnect by the whole retry interval.
 * So the claim simply drops, sits unheld for the retry interval, and the reconnecting
 * tab re-claims and wins because nobody else holds it. Holding a claim open across a
 * reconnect would buy nothing and would need a timer, a timeout policy and a rule for
 * what happens when a DIFFERENT tab claims inside the grace window.
 *
 * THE ONE ORDERING THAT IS STRUCTURAL, also measured: a new subscribe can arrive while
 * the old connection is still open, its close landing **52 ms after**. That is why
 * {@link Claims.release} is identity-conditional — see its own note. It is pinned in
 * `tests/claims.test.ts`, not merely commented, because an unconditional release is a
 * one-word edit away and reds nothing else.
 *
 * This module is deliberately free of `EditorError`: it answers in plain values
 * and `handlers.ts` decides which contract code each answer earns. Claims are policy;
 * codes are a wire contract, and keeping them apart is what lets the table be tested
 * without a transport.
 */
export type Claims = {
  /**
   * Take `world` for `connection`. Returns **true when this connection now holds it** —
   * which includes re-claiming a world it already held (idempotent, so a chrome that
   * asserts its claim twice on one connection is not fighting itself) — and false when
   * a DIFFERENT live connection holds it, with the table untouched.
   *
   * A connection holds AT MOST ONE world: taking a second releases the first. Without
   * that the table would accumulate phantom holds — a tab that claimed the untitled
   * scratch, then reconnected after opening `cavern`, would still be blocking itself
   * out of a world it abandoned. Together with the single-holder rule above, the table
   * is a partial bijection between worlds and live connections.
   */
  claim(world: ClaimKey, connection: ServerResponse): boolean;
  /**
   * Drop everything `connection` holds. **Identity-conditional, and that is the whole
   * point of it**: an entry is removed only when its holder IS this connection.
   *
   * The hub's close handler is the caller, and the ordering it must survive was
   * measured (module header): a reloading tab's OLD connection can close 52 ms AFTER
   * its new connection has already taken the claim. A release that deleted by world
   * name would then revoke a claim the same tab had legitimately just won, and the tab
   * would sit unclaimed while believing otherwise — a failure with no symptom until an
   * agent call answers `no-session`.
   */
  release(connection: ServerResponse): void;
  /**
   * Take `world` for `connection` whatever anyone else thinks — the settled policy's
   * explicit escape, and the only way past a refused {@link Claims.claim}.
   *
   * It does not refuse an UNHELD world: a steal follows a refusal by at least one human
   * decision, and the holder can close in that window. Answering "there was nothing to
   * steal" would send the user back to a claim that now succeeds, having learnt nothing.
   * The displaced holder — if there was one, and if it is not the caller — is announced
   * through {@link Claims.onDrop}.
   */
  steal(world: ClaimKey, connection: ServerResponse): void;
  /** The connection holding `world`, or undefined when nobody does. */
  holder(world: ClaimKey): ServerResponse | undefined;
  /**
   * Every connection that holds a claim right now, in the order the claims were taken.
   *
   * A QUERY WITH NO POLICY IN IT, deliberately. The backchannel needs to address "the
   * editing session" without being told a world — an MCP client has no world to name and
   * no token to present — and the honest reading of this table is that the answer may be
   * zero, one, or several, since one claim per WORLD is the rule and two tabs on two
   * worlds are both legitimate. Which of those counts is speakable-for is a decision, and
   * it lives in `backchannel.ts` where the refusal it produces is written. Returning a
   * hand-picked "the session" from here would bury that decision in a table.
   */
  claimedConnections(): ServerResponse[];
  /**
   * Be told when a LIVE holder is displaced, so something can tell it. Fires only from
   * {@link Claims.steal}: the other way a claim ends is the connection dying, and there
   * is nobody left to notify. `server.ts` is the one caller, turning each drop into a
   * `claim-lost` frame addressed to the connection that lost it.
   */
  onDrop(handler: (connection: ServerResponse, world: ClaimKey) => void): void;
};

/** Build an empty claim table. One per daemon, wired to one event hub. */
export function createClaims(): Claims {
  const holders = new Map<ClaimKey, ServerResponse>();
  const dropHandlers: ((
    connection: ServerResponse,
    world: ClaimKey,
  ) => void)[] = [];

  /** Every world this connection holds, dropped. Deleting during a Map iteration is
   *  specified to be safe, and the identity test is what makes this a release of THIS
   *  connection's claims rather than of whatever currently sits under those names. */
  const dropAll = (connection: ServerResponse): void => {
    for (const [world, holder] of holders) {
      if (holder === connection) holders.delete(world);
    }
  };

  const take = (world: ClaimKey, connection: ServerResponse): void => {
    dropAll(connection);
    holders.set(world, connection);
  };

  return {
    claim(world, connection) {
      const holder = holders.get(world);
      if (holder !== undefined && holder !== connection) return false;
      take(world, connection);
      return true;
    },
    release(connection) {
      dropAll(connection);
    },
    steal(world, connection) {
      const displaced = holders.get(world);
      take(world, connection);
      if (displaced === undefined || displaced === connection) return;
      for (const handler of dropHandlers) handler(displaced, world);
    },
    holder(world) {
      return holders.get(world);
    },
    claimedConnections() {
      return [...holders.values()];
    },
    onDrop(handler) {
      dropHandlers.push(handler);
    },
  };
}
