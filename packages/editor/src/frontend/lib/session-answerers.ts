// packages/editor/src/frontend/lib/session-answerers.ts

/**
 * What this editor session can be ASKED — method name → the function that answers it.
 *
 * A plain record, and the whole of the seam's policy. `useSessionAnswer` owns the wire
 * (which frame arrives, which POST goes back, what happens when a handler throws) and
 * knows no method names at all; this module knows the method names and no wire. Adding a
 * method is therefore a row here, which is the shape T4b Task 3 was asked to leave behind
 * for Task 4's `session.state`.
 *
 * A handler takes the request's `params` — `unknown`, because the envelope relays rather
 * than reads (`shared/wire.ts`) — and returns whatever the method's answer is.
 *
 * FIVE OUTCOMES, ALL FIVE HANDLED BY THE SEAM, which is what `unknown` is quietly promising
 * here and is worth saying rather than leaving to be discovered. A handler may return a
 * VALUE or a PROMISE of one — `unknown` admits both, and `useSessionAnswer` awaits — and it
 * may THROW or REJECT, either of which becomes a typed refusal rather than a silence. The
 * fifth is the one that took a review to find: a payload that will not SERIALIZE (a cycle, a
 * `BigInt`, a throwing `toJSON`) fails on the answer's own return leg, inside the POST, and
 * is converted there. That is what keeps "never a hang" true for a handler's own bugs and
 * not only for a missing method.
 *
 * It is also why a future async method costs nothing here: the daemon's budget is ten
 * seconds, and a fact behind a worker round trip is a legitimate answer, not a reason to
 * fire-and-forget inside a synchronous body.
 *
 * `undefined` IS A LEGITIMATE ANSWER. `JSON.stringify` drops the key, the daemon's schema
 * takes the body with `payload` absent, and the ask resolves `undefined` — the round trip is
 * pinned, because the schema rejected it until spec review found the hole
 * (`daemon/session-handlers.ts` carries the measurement).
 */
export type SessionAnswerers = Readonly<
  Record<string, (params: unknown) => unknown>
>;

/**
 * The methods a chrome can answer with NO mirrors at all — which today is exactly one.
 *
 * `session.ping` echoes its params back. It is a liveness probe and deliberately not a
 * useful read: what it proves is the whole path, which nothing smaller can — a claimed
 * connection, an addressed frame that arrived, a registry that resolved a method, a POST
 * that correlated back to its own ask. Every richer method rides that same path, so the
 * one thing worth pinning end to end before any of them exist is the path.
 *
 * It is a MODULE CONSTANT because it closes over nothing. Task 4's `session.state` will
 * not be able to be — it reads the chrome's latched mirrors — and that is why
 * `useSessionAnswer` takes the registry as an argument rather than importing this: the
 * mount point can move to wherever the facts are without the wire changing shape. Keeping
 * the base row here means the moving version still has one honest thing to spread.
 */
export const BASE_ANSWERERS: SessionAnswerers = {
  "session.ping": (params) => ({ echo: params }),
};
