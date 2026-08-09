// packages/editor/src/daemon/session-handlers.ts
import type { ServerResponse } from "node:http";
import { z } from "zod";
import type { SessionAnswer } from "../shared/wire.ts";
import type { Backchannel } from "./backchannel.ts";
import type { ClaimKey, Claims } from "./claims.ts";
import { EditorError } from "./errors.ts";
import type { Handlers } from "./handlers.ts";
import { WORLD_NAME_RE } from "./worlds.ts";

/**
 * Everything the `session.*` family needs from the running daemon: the claim table, the
 * event hub's token→connection resolver, and the backchannel's correlation table.
 * `server.ts` fills all three from the one hub it built; `HandlerContext.session` carries
 * it in.
 */
export type SessionSeam = {
  claims: Claims;
  connectionFor(token: string): ServerResponse | undefined;
  backchannel: Backchannel;
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

/** One answer to one relayed question (`shared/wire.ts`'s `SessionAnswer`, as a schema).
 *
 *  IT CARRIES NO TOKEN, and that is the one place this family's shape breaks — argued
 *  rather than overlooked. The other three commands take a token because they say
 *  something ABOUT a connection and a POST cannot otherwise name one. This one names a
 *  pending ASK instead, and the `requestId` it names it by was minted by the daemon and
 *  written into exactly one connection's stream: holding it means holding that stream, on
 *  the same structural argument the token's own docblock makes for itself
 *  (`daemon/events.ts`'s `subscribe`). Adding a token would be a second name for a fact
 *  the first one already carries, and would let a request be answered with the wrong half
 *  of a mismatched pair — one more state to define for nothing.
 *
 *  A discriminated union rather than an optional `error`, so a chrome that means "I could
 *  not do this" cannot spell it as a successful answer with a missing payload — the
 *  distinction the ask's caller branches on.
 *
 *  `payload` IS `z.unknown().optional()`, AND THE `.optional()` IS A CORRECTNESS FIX RATHER
 *  THAN A LOOSENING — an earlier version of this comment claimed `z.unknown()` already
 *  accepted an absent key, and it does not. Measured on zod 4.4.3: a body missing the key
 *  fails with *"expected nonoptional, received undefined"*, i.e. a 400. That body is not
 *  malformed — it is the CANONICAL serialization of a handler that answered `undefined`,
 *  because `JSON.stringify` drops undefined-valued keys. Any answerer in any language
 *  produces it. A validator that refuses a body the wire itself emits is wrong about JSON,
 *  not strict about a contract, and the cost lands three hops away: the chrome's answer POST
 *  400s, the seam swallows it, and the asker waits out the whole budget to be told
 *  `session-timeout` — a sentence about how FAST the session is, for a handler that answered
 *  instantly. Exactly the failure `shared/wire.ts` argues the union exists to prevent.
 *
 *  FIXED HERE RATHER THAN BY COERCING `undefined` → `null` IN THE CHROME, which was the
 *  alternative. The coercion would put the rule in ONE client, and every other answerer — a
 *  curl, the CLI, a second tab of a different vintage — would have to reproduce it to be
 *  understood, against the whole reason `dispatch` is a single funnel. `z.strictObject`
 *  still rejects an extra key and an explicit `null` still parses, so nothing else moved.
 *  Absent and `null` stay distinguishable: absent is a handler that returned nothing, `null`
 *  is one that returned `null`, and the relay preserves the difference rather than
 *  flattening it on the way past. */
const sessionAnswer = z.discriminatedUnion("ok", [
  z.strictObject({
    requestId: z.string().min(1),
    ok: z.literal(true),
    payload: z.unknown().optional(),
  }),
  z.strictObject({
    requestId: z.string().min(1),
    ok: z.literal(false),
    error: z.string(),
  }),
]);

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
 * nothing there touches connection identity. That split earned itself in one task:
 * `session.answer` landed here rather than on top of the filesystem verbs, and T4b Task 4's
 * `session.state` lands here too.
 *
 * Returned as its own `Handlers` map rather than mutating a passed-in one: a builder that
 * answers with what it built is a query, and `createHandlers` merges it in one line.
 *
 * @param session - undefined when the registry was built with no event feed. Every command
 * here then answers `no-session` — the three token-taking ones because they resolve no
 * token, and `session.answer` because there is no correlation table for it to settle
 * against. That is the true answer rather than a stub: a daemon with no feed has no
 * connections, so there is no session for anyone to be, and nothing here can have asked
 * one anything. `HandlerContext.session` argues why that seam is optional at all.
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

  // The return path of the backchannel (`daemon/backchannel.ts`): a POST, through the same
  // `dispatch` validator every other command uses. It is not a second channel and could not
  // usefully be one — the request rides the SSE feed because that is the only pipe the
  // daemon can push down, and the answer rides a POST because that is the only pipe the
  // chrome can push up. One direction each, both already built.
  handlers.set("session.answer", {
    input: sessionAnswer,
    run: (input) => {
      // Boundary cast: dispatch() validated input against this command's schema.
      const answer = input as SessionAnswer;
      if (session === undefined) {
        throw new EditorError(
          "no-session",
          "this daemon has no event feed, so nothing here asked the editor anything",
        );
      }
      // `delivered: false` IS THE ANSWER, not an error — and the case it reports is by
      // design rather than by accident. An answer can lose the race with its own ask's
      // timeout, and the chrome cannot know that when it posts; refusing it would manufacture
      // a client-side failure for a tab that did exactly the right thing a moment late. A
      // duplicate and a forged id land here too, and all three are harmless for the same
      // structural reason: `deliver` takes the entry off the table before settling it, so a
      // requestId names nothing once it has been used. Reporting the boolean rather than
      // swallowing it keeps the true answer available to a caller that wants it (and to the
      // pin that asserts a second answer settles nothing) without inventing a failure.
      return Promise.resolve({
        delivered: session.backchannel.deliver(answer),
      });
    },
  });

  return handlers;
}
