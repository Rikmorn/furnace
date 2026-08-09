// packages/editor/src/daemon/backchannel.ts
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { SessionAnswer } from "../shared/wire.ts";
import type { Claims } from "./claims.ts";
import { EditorError } from "./errors.ts";
import type { EventHub } from "./events.ts";

/**
 * How long an ask waits before it is a `session-timeout`.
 *
 * **10 s, and the number is chosen against the CLIENT's floor rather than against a feel
 * for how fast a browser answers** — because the promise this tranche makes is "a typed
 * error, never a hang", and a hang is what the caller experiences when the daemon is
 * slower than whatever gave up on it first. The binding budget is Claude Code's
 * per-request timer for an HTTP/SSE MCP server, which covers each request through to the
 * server's FIRST RESPONSE BYTE and is **60 s** (`code.claude.com/docs/en/mcp`, read
 * 2026-08-09). The half that decides it: the per-server `timeout` and `MCP_TOOL_TIMEOUT`
 * can RAISE that timer and **a lower value does not shorten it**. So 60 s is a floor no
 * client configuration can go under, and 10 s is strictly inside it for EVERY client
 * rather than for a lucky default — which is what makes the typed error reachable at all.
 * A daemon timeout above the floor would mean the agent's request dying first, and the
 * error we so carefully typed being delivered to nobody.
 *
 * Exported for the pin in `tests/backchannel.test.ts`, which asserts the inequality this
 * paragraph rests on rather than the number.
 */
export const DEFAULT_ASK_TIMEOUT_MS = 10_000;

/**
 * The daemon's half of the backchannel: **ask the claimed editor session a question, and
 * get an answer back or a typed refusal — never a hang.**
 *
 * WHY IT EXISTS AT ALL is the two-bundle constraint, stated once here because every
 * decision below is downstream of it. The daemon holds the project root, the worlds
 * directory and nothing else; `project.get` and `world.list` answer from disk with no tab
 * open. Every other fact an agent would want about a live editing session — what is
 * selected, which tool is armed, where the camera is, what the history holds — lives in the
 * chrome's mirrors, in the browser. The daemon cannot compute them, cannot cache them
 * honestly, and must not guess. So it relays: one frame out to the claimed connection, one
 * POST back, correlated by id. **A relay with a correlation table, never a reader.**
 *
 * IT REGISTERS ITS OWN DEPARTURE LISTENER, unlike the claim table beside it, and the
 * asymmetry is not an inconsistency. `Claims` knows nothing of hubs — `server.ts` wires
 * `hub.onClose(conn => claims.release(conn))` from outside because the table could not do
 * it for itself. This module is HANDED the hub; watching it is its own business. That
 * removes a line `startServer` could forget, and the class of bug Task 2's sabotage found —
 * a wire whose absence reddened nothing, because the module test built its own pair — cannot
 * exist for this one. The hub's exactly-once contract is what makes the listener safe to
 * write plainly; `deliver` and the timer are each also delete-before-settle, so a second
 * announcement would find nothing to settle even if that contract were broken.
 */
export type Backchannel = {
  /**
   * Ask the claimed session `method` with `params`, and resolve with what it answers.
   *
   * @param timeoutMs - defaults to {@link DEFAULT_ASK_TIMEOUT_MS}.
   *
   * **PRODUCTION SURFACE WITH NO PRODUCTION CALLER, stated plainly rather than left to be
   * discovered.** Nothing shipped passes it, so the default is the only value that runs
   * outside tests and the only pin on it is an inequality. It exists as a parameter rather
   * than a constant for two reasons that are not "a test needed it": a per-method budget is
   * a legitimate thing for a relay to carry (a worker round trip and a ref read do not
   * deserve the same wait), and injecting 20 ms is what lets the timeout be pinned for real
   * — against fake timers, which would prove the code calls `setTimeout`, and against a ten
   * second wall-clock wait, which would prove nothing anyone would keep. Delete it the day
   * a per-method budget is decided against; do not delete it to "remove unused surface".
   *
   * @returns the answering session's payload — shaped by the method, unknown to this module.
   * @throws {@link EditorError} `no-session` when no session is claimed, when more than one
   * is, or when the answering connection departs before it answers; `session-timeout` when
   * it stays silent; `internal` when it answers that it could not serve the method, and when
   * `params` cannot be serialized onto the wire.
   * **Every one of those is a rejection that arrives, which is the whole point of the type.**
   */
  ask(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  /**
   * Hand an answer to the ask it names, and report **whether anything was waiting for it**.
   *
   * A command that also answers a question, which the name does NOT signal — so the
   * contract is stated here rather than credited to the spelling. The return is the honest
   * answer to a `session.answer` POST that arrived after its ask had already been settled:
   * `false` means the id named nothing, which is a routine race rather than a failure.
   */
  deliver(answer: SessionAnswer): boolean;
};

type Pending = {
  /** Which session was asked — so a departure or a refusal can name the question. */
  method: string;
  /** The connection the frame went to, for the departure sweep. */
  connection: ServerResponse;
  resolve(payload: unknown): void;
  reject(error: EditorError): void;
  timer: ReturnType<typeof setTimeout>;
};

/** Build the relay for one daemon. Takes the hub it writes through and the claim table
 *  that says who to write to; both are the ones `startServer` built. */
export function createBackchannel(hub: EventHub, claims: Claims): Backchannel {
  const pending = new Map<string, Pending>();

  /** Take an ask off the table BEFORE settling it. Every exit from a pending ask goes
   *  through here, and that is what makes "a second answer never settles a second ask"
   *  structural rather than a rule four call sites have to remember: the id names nothing
   *  the moment it is taken, so a duplicate, a late answer and a forged one are all the
   *  same harmless miss.
   *
   *  NOT `claim`, which is what this was called for one commit. `claims.claimedConnections()`
   *  is read forty lines below it, in a module whose whole subject is session CLAIMS — one
   *  word carrying two unrelated meanings in one file, where the daemon's other spelling of
   *  the word is load-bearing everywhere else. `claims.ts` had already reached for `take`
   *  for its own internal, which is the same idea. */
  const takePending = (requestId: string): Pending | undefined => {
    const entry = pending.get(requestId);
    if (entry === undefined) return undefined;
    pending.delete(requestId);
    clearTimeout(entry.timer);
    return entry;
  };

  /**
   * Abandon every ask still out on `connection` — the ASKS are what is abandoned, not the
   * connection, which has already abandoned us.
   *
   * **They reject NOW, with `no-session` rather than waiting out a `session-timeout`** — the
   * claim table's own precedent, where the daemon prefers the true answer to the polite one.
   * The two sentences send a caller to different places: a timeout says "it is slow, wait
   * longer", and this one says "the tab you were reading closed". Only the second is true,
   * and only the second has a remedy the caller can act on. It also lands in milliseconds
   * rather than ten seconds, which is the difference between an agent noticing a closed
   * editor and an agent appearing to be stuck.
   */
  const abandonAsksOn = (connection: ServerResponse): void => {
    for (const [requestId, entry] of pending) {
      if (entry.connection !== connection) continue;
      // The return is DISCARDED and the loop's own `entry` is settled instead — same object,
      // and the call is here for its effect: it is what takes the id off the table and stops
      // the timer. Deleting during a Map iteration is specified to be safe (`claims.ts`'s
      // `dropAll` leans on the same guarantee).
      takePending(requestId);
      entry.reject(
        new EditorError(
          "no-session",
          `the editor session went away before it answered "${entry.method}"`,
        ),
      );
    }
  };
  hub.onClose(abandonAsksOn);

  /** The one connection an ask can be addressed to, or the reason there is none.
   *
   *  ZERO AND MANY SHARE `no-session`, and the message carries which — the same reasoning
   *  `already-exists` records for its two occupancy classes. Both mean "there is no session
   *  I can speak for", both are a conflict with the daemon's current state, and a caller's
   *  remedy is in the sentence rather than in the code. MANY is refused rather than
   *  resolved by picking, because picking is the failure mode this whole tranche exists to
   *  avoid: an agent reading "the session" would be reading a tab the human is not in, and
   *  it would never know. Two claimed tabs is a state the claim table allows by design (one
   *  claim per WORLD), so this is a real branch and not a defensive one. */
  const soleTarget = (): ServerResponse | EditorError => {
    const [connection, ...rivals] = claims.claimedConnections();
    if (connection === undefined) {
      return new EditorError(
        "no-session",
        "no editor session is claimed — open the editor on this project, or let the tab that is open finish connecting",
      );
    }
    if (rivals.length > 0) {
      return new EditorError(
        "no-session",
        `${rivals.length + 1} editor sessions are claimed, so there is no single one to speak for — close all but the tab you want driven`,
      );
    }
    return connection;
  };

  return {
    ask(method, params, timeoutMs = DEFAULT_ASK_TIMEOUT_MS) {
      const target = soleTarget();
      // Rejected rather than thrown, so EVERY failure of an ask is the same kind of thing
      // to a caller. A synchronous throw would make `ask(…).catch(…)` — the shape a
      // non-async caller writes — miss exactly the case the plan calls out as "never a
      // hang": a raised exception where a rejection was expected is an unhandled one.
      if (target instanceof EditorError) return Promise.reject(target);
      const requestId = randomUUID();
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          takePending(requestId);
          reject(
            new EditorError(
              "session-timeout",
              `the editor session did not answer "${method}" within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        // A pending question must not hold the process open, for the reason the hub states
        // one line ABOVE its own heartbeat `unref`.
        timer.unref();
        // Registered BEFORE the frame goes out, and the order is load-bearing rather than
        // tidy: an answer can only arrive over a later POST today, but a test (and any
        // future in-process answerer) can answer inside the emit, and a table written
        // afterwards would lose it.
        pending.set(requestId, {
          method,
          connection: target,
          resolve,
          reject,
          timer,
        });
        try {
          hub.emitTo(target, {
            type: "session-request",
            requestId,
            method,
            params,
          });
        } catch (err) {
          // THE EMIT CAN THROW, and without this the throw escapes `ask`'s declared
          // contract: `emitTo` → `frameFor` → `JSON.stringify`, which raises synchronously
          // on `params` carrying a cycle, a BigInt or a throwing `toJSON`. A caller
          // branching on `err.code` would read `undefined` where this type promises one of
          // four codes. The entry would also sit out its whole budget before the timer
          // cleared it — not a leak, but ten seconds of a caller waiting for a frame that
          // was never written.
          //
          // The set/emit ORDER is deliberately unchanged: the argument above it is about an
          // answer arriving inside the emit, which is still true. This unwinds instead.
          takePending(requestId);
          reject(
            new EditorError(
              "internal",
              `the editor session could not be asked "${method}": its params do not fit on the wire (${err instanceof Error ? err.message : String(err)})`,
            ),
          );
        }
      });
    },

    deliver(answer) {
      const entry = takePending(answer.requestId);
      if (entry === undefined) return false;
      if (answer.ok) {
        entry.resolve(answer.payload);
        return true;
      }
      // THE CHROME REFUSED, and `internal` is the code — decided against the two that look
      // closer. `invalid-input` would blame the caller for a method the caller never typed:
      // the daemon builds the request (the MCP door maps tool → method), so a method the
      // chrome does not serve means the two halves of ONE product disagree, which is what
      // `internal` means and is exactly whose fault it is. `no-session` would be false —
      // the session is right there, answering. A stale tab against a newer daemon is the
      // reachable route, so the message carries the chrome's own sentence rather than a
      // generic one.
      entry.reject(
        new EditorError(
          "internal",
          `the editor session could not answer "${entry.method}": ${answer.error}`,
        ),
      );
      return true;
    },
  };
}
