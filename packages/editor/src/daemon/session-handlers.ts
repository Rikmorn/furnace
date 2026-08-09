// packages/editor/src/daemon/session-handlers.ts
import type { ServerResponse } from "node:http";
import { z } from "zod";
import type { ClaimKey, Claims } from "./claims.ts";
import { EditorError } from "./errors.ts";
import type { Handlers } from "./handlers.ts";
import { WORLD_NAME_RE } from "./worlds.ts";

/**
 * Everything the `session.*` family needs from the running daemon: the claim table, and
 * the event hub's token→connection resolver. `server.ts` fills both from the one hub it
 * built; `HandlerContext.session` carries it in.
 */
export type SessionSeam = {
  claims: Claims;
  connectionFor(token: string): ServerResponse | undefined;
};

/** The world a `session.*` command names: a saved world, or `null` for the untitled
 *  scratch. Nullable rather than optional, so "I am editing nothing yet" is a value the
 *  caller STATES — an omitted field would be indistinguishable from a caller that forgot,
 *  and `z.strictObject` would then have no missing key to complain about. It mirrors the
 *  chrome's own `WorldState.name`, which is where the null comes from (`claims.ts`'s
 *  `ClaimKey` carries the full argument).
 *
 *  The SECOND zod schema built on `WORLD_NAME_RE` — `handlers.ts` has the other, for
 *  `field.load` and the `world.*` verbs. Two schemas, still one regex: both import the
 *  constant from `worlds.ts`, which is where the tracking comment for its copies lives. */
const claimedWorld = z.string().regex(WORLD_NAME_RE).nullable();

/** The connection token minted at SSE subscribe time (`daemon/events.ts`).
 *
 *  IT RIDES THE BODY, not a header, and that is a decision about the registry rather than
 *  about HTTP: `dispatch(handlers, command, input)` takes exactly one input channel,
 *  deliberately, so that "every client funnels through one validator" is literally true. A
 *  header would need a second path from `route` into the registry and would carry a
 *  transport assumption into the one module built to outlive its transport — the MCP door
 *  has no headers at all.
 *
 *  `.min(1)` and no shape rule: the mint's format is nobody's contract, and a token that
 *  does not resolve earns `no-session` (a state answer the caller can act on) rather than
 *  `invalid-input` (a claim about the request that would be wrong the moment the mint
 *  changed shape). */
const sessionToken = z.string().min(1);

/** A world in a sentence a human reads.
 *
 *  THE CHROME HAS ITS OWN (`frontend/lib/humanize.ts`'s `worldPhrase`), and the wording
 *  differs on purpose rather than by drift — different audiences, and neither sentence is
 *  ever shown to the other's reader. This one goes into an `EditorError` message, which
 *  the chrome does NOT display for the case that matters: a refused `session.claim` opens
 *  the steal prompt, which writes its own copy. So this text is read by a non-chrome
 *  caller — a curl, the CLI, an agent reading an error envelope — and it is written in the
 *  third person about a thing on this daemon (`the untitled session`, `world "x"`), where
 *  the chrome addresses the person sitting in the tab (`this untitled session`). Align them
 *  the day one string is shown in both places; nothing does today. */
function describeWorld(world: ClaimKey): string {
  return world === null ? "the untitled session" : `world "${world}"`;
}

/**
 * The `session.*` family: who is authoring, asserted BY a live SSE connection.
 *
 * ITS OWN MODULE because it is its own concern (foundations T4b) — the daemon's other
 * modules already split this way (`worlds.ts`, `claims.ts`, `bundle.ts`, `origin.ts`), and
 * this family is the one whose answer depends on WHICH caller is asking rather than only
 * on what it asked. `handlers.ts` is the filesystem verbs; nothing here touches a file, and
 * nothing there touches connection identity. T4b Task 4 adds `session.state` to this file
 * rather than to that one.
 *
 * Returned as its own `Handlers` map rather than mutating a passed-in one: a builder that
 * answers with what it built is a query, and `createHandlers` merges it in one line.
 *
 * @param session - undefined when the registry was built with no event feed. Every command
 * here then resolves NO token and answers `no-session`, which is the true answer rather
 * than a stub: a daemon with no feed has no connections, so there is no session for anyone
 * to be. `HandlerContext.session` argues why that seam is optional at all.
 */
export function createSessionHandlers(
  session: SessionSeam | undefined,
): Handlers {
  const handlers: Handlers = new Map();

  // The one guard all three share, applied identically for the reason `field.load`'s
  // `readSiblings` gives: a copy per command is how one of them drifts. It resolves the
  // token AND the claim table together, because the seam is optional and a command that
  // reached a table without a connection (or the reverse) would be answering about a
  // daemon that does not exist.
  const resolveSession = (
    token: string,
  ): { claims: Claims; connection: ServerResponse } => {
    const connection = session?.connectionFor(token);
    if (session === undefined || connection === undefined) {
      throw new EditorError(
        "no-session",
        "no live editor connection for that token — the editor's event feed mints a new one on every (re)connect",
      );
    }
    return { claims: session.claims, connection };
  };

  handlers.set("session.claim", {
    input: z.strictObject({ name: claimedWorld, token: sessionToken }),
    run: (input) => {
      // Boundary cast: dispatch() validated input against this command's schema.
      const { name, token } = input as { name: ClaimKey; token: string };
      const { claims, connection } = resolveSession(token);
      if (!claims.claim(name, connection)) {
        // `already-exists` rather than a code of its own — the two occupancy classes are
        // argued at the code in `errors.ts`. The MESSAGE carries the remedy, since that is
        // the half that differs from a taken directory name.
        throw new EditorError(
          "already-exists",
          `${describeWorld(name)} is claimed by another editor session — steal it or close the other tab`,
        );
      }
      return Promise.resolve({});
    },
  });

  handlers.set("session.steal", {
    input: z.strictObject({ name: claimedWorld, token: sessionToken }),
    run: (input) => {
      const { name, token } = input as { name: ClaimKey; token: string };
      const { claims, connection } = resolveSession(token);
      claims.steal(name, connection);
      return Promise.resolve({});
    },
  });

  handlers.set("session.release", {
    input: z.strictObject({ token: sessionToken }),
    run: (input) => {
      const { token } = input as { token: string };
      const { claims, connection } = resolveSession(token);
      claims.release(connection);
      return Promise.resolve({});
    },
  });

  return handlers;
}
