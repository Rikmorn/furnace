// packages/editor/src/daemon/session-handlers.ts
import type { ServerResponse } from "node:http";
import { z } from "zod";
import { ACTION_INPUT_SCHEMAS } from "../action-registry/schemas.ts";
import {
  CAPTURE_VIEWS,
  MAX_CAPTURE_SIZE,
  MIN_CAPTURE_SIZE,
} from "../shared/capture.ts";
import { MAX_PROBE_M } from "../shared/field-limits.ts";
import type { SessionAnswer, SessionQueryRequest } from "../shared/wire.ts";
import type { Backchannel } from "./backchannel.ts";
import type { ClaimKey, Claims } from "./claims.ts";
import { EditorError } from "./errors.ts";
import type { Handlers } from "./handlers.ts";
import { BRUSH_OPS } from "./op-schema.ts";
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

/**
 * How long `viewport.capture` may take before it is a `session-timeout`.
 *
 * **THREE TIMES THE DEFAULT, and the reason is that this ask makes the tab do GPU work
 * rather than read a record it is already holding.** A capture composes the frame, runs a
 * mesh pass plus up to thirteen line passes into an off-screen texture, maps the result back
 * off the GPU (`mapAsync`, which waits on the queue), swizzles it and lets a 2D canvas
 * encode a PNG of up to 1568 px. On a busy editor — a remesh burst, a void cast in flight —
 * that is a different order of wait from `session.state`.
 *
 * CHOSEN AGAINST THE CLIENT FLOOR, exactly as `DEFAULT_ASK_TIMEOUT_MS` is: Claude Code's
 * per-request timer for an HTTP/SSE MCP server is 60 s and configuration can only RAISE it,
 * so 30 s is strictly inside the floor for every client and leaves room for the answer's own
 * POST. A budget above the floor would mean the agent's request dying first and our typed
 * error being delivered to nobody, which is the failure that number was picked to avoid.
 */
export const CAPTURE_ASK_TIMEOUT_MS = 30_000;

/**
 * How long `generate` may take before it is a `session-timeout`.
 *
 * THE SAME NUMBER AS {@link CAPTURE_ASK_TIMEOUT_MS} FOR A DIFFERENT REASON, which is why it
 * is a second constant rather than a shared one. That budget is about a GPU round trip; this
 * is about a generator's own `evaluate` running on the tab's main thread — `commitGenerator`
 * re-evaluates the whole recipe and applies its span synchronously, and a maze over a large
 * region is real CPU work with no worker under it. The two costs are unrelated, so a single
 * constant would tie two budgets that should be free to move apart, and the day one of them
 * needs to change nobody would know which callers they were changing.
 *
 * CHOSEN AGAINST THE SAME CLIENT FLOOR: Claude Code's per-request timer for an HTTP/SSE MCP
 * server is 60 s and configuration can only RAISE it, so 30 s is strictly inside the floor
 * for every client and leaves room for the answer's own POST.
 *
 * `edit.apply` deliberately has NO raised budget: its cost is bounded by the op list the
 * caller sent, so a caller meeting the default has a remedy of its own — send fewer ops.
 */
export const GENERATE_ASK_TIMEOUT_MS = 30_000;

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

/**
 * The action ids an agent may NOT reach through `action.run`, and the only deny-list in this
 * daemon.
 *
 * **A USER RULING, ENFORCED — not a policy this layer invented.** Undo is fenced until op
 * ATTRIBUTION lands, and the two are to be designed together, because without attribution
 * the log is a bare LIFO with no `origin` on an entry: an agent's `edit.undo` pops whatever
 * is on top, which is routinely a HUMAN's stroke. There is no way at head to let an agent
 * undo its own work without letting it undo somebody else's, and "the agent should be
 * careful" is not a guardrail.
 *
 * **WHY IT EXISTS AT ALL, given no dedicated undo command was ever built.** The tranche's
 * stop condition was satisfied literally — there is no `edit.undo` verb on this wire — and
 * `action.run` then made the ruling moot by accepting any registered id. A door that accepts
 * `edit.undo` IS an agent undo verb wearing a different spelling. The plan's *"the door
 * accepts any registered id — advertisement is the filter"* was written about LISTING versus
 * VALIDATING; it was not a licence to reach a verb the user fenced.
 *
 * **AND IT IS NOT THE SECOND ALLOW-LIST THE PLAN FORBADE.** That instruction was about not
 * keeping a second copy of *which ids exist* — knowledge that belongs to the action registry
 * and lives in `runNamedById`. This is a much smaller and different thing: two ids the user
 * ruled out, named once. It cannot drift out of step with the registry, because an id that
 * stopped existing would simply stop being reachable anyway.
 *
 * **HERE RATHER THAN IN THE CHROME's answerer, and the reason is decisive rather than
 * stylistic.** A chrome-side fence lives in the TAB's bundle, and the `bun run edit` loop
 * restarts this daemon on every source change while an open tab keeps the bundle it booted
 * with — a fact this repo has already written down (`backchannel-refusals-blur-two-causes`).
 * So a tab of an older vintage would answer `edit.undo` happily, and the fence would hold
 * only for tabs that did not need it. A daemon-side fence holds regardless of what the tab
 * believes, which is the property a safety fence has to have. The cost is that this module
 * now knows two action ids; that is the price of enforcement not depending on a client.
 *
 * **NOT relying on non-advertisement.** `mcp.ts` lists three tools today, so no MCP client
 * can name these ids yet — and that is exactly the reasoning this tranche keeps refusing
 * elsewhere. Advertisement is not enforcement; the cull is Task 6's and it is a different
 * mechanism from a rule.
 */
const FENCED_ACTIONS: ReadonlySet<string> = new Set(["edit.undo", "edit.redo"]);

/** What a caller is told when it names a fenced verb. It carries the REASON and the LIFT
 *  CONDITION, because a refusal an agent cannot act on is a refusal it will retry. */
const fenceMessage = (id: string): string =>
  `"${id}" is not available to an agent: undo has no op attribution yet, so stepping the log would discard whatever is on top of it — routinely the human's own work, not yours. This fence lifts when op attribution ships and undo is designed with it. To reverse something you just did, apply the inverse ops explicitly.`;

/** A world-metre point. `op-schema.ts` declares the same three-tuple for the same
 *  advertisement reason (a client reads "exactly three numbers" off the projected JSON
 *  Schema); the copy is two lines and the alternative is an import between two schema
 *  modules that share no other vocabulary. */
const point3 = z.tuple([z.number(), z.number(), z.number()]);

/**
 * A ray DIRECTION — a `point3` that is not the zero vector.
 *
 * **THE REFINEMENT IS THE WHOLE POINT, and it is the `maxDist: .positive()` argument applied
 * to the field that needed it more.** `z.number()` already rejects `NaN` and `Infinity`
 * componentwise, so `[0,0,0]` is the one remaining spelling that is well-formed and
 * meaningless. Core does not refuse it either: `raycastField` normalizes by
 * `hypot(...) || 1`, so a zero direction becomes a walk along **+X** from the origin — the
 * answer is a hit describing a question nobody asked, or in carved air a `null`
 * indistinguishable from "nothing within reach". Both are confidently wrong, which is the
 * failure class this whole verb exists to remove.
 *
 * Refused rather than defaulted, for the door's standing reason: a schema is also the
 * ADVERTISEMENT, and substituting a direction would answer about a ray the caller never cast.
 */
const direction3 = point3.refine(
  ([x, y, z]) => x !== 0 || y !== 0 || z !== 0,
  "dir must not be the zero vector — it names no direction to cast along",
);

/**
 * What `session.query` accepts — `shared/wire.ts`'s {@link SessionQueryRequest} as a
 * validator.
 *
 * `z.strictObject` PER ARM, so a misspelled `maxdist` is REPORTED rather than dropped into a
 * silent default. That matters more for a read than it looks: a dropped `maxDist` answers
 * about a 30 m probe when the caller asked for 300, and the answer is well-formed and wrong.
 */
const spatialQuery = z.discriminatedUnion("about", [
  z.strictObject({ about: z.literal("entities") }),
  z.strictObject({
    about: z.literal("ray"),
    origin: point3,
    dir: direction3,
    maxDist: z.number().positive().max(MAX_PROBE_M).optional(),
  }),
  z.strictObject({ about: z.literal("selection") }),
]);

/**
 * The drift check the two-author arrangement earns — **and it guards ONE declaration here
 * rather than two, which is what makes it worth so little and worth having anyway.**
 *
 * `op-schema.ts`'s pin exists because the op vocabulary has two authors: core's `BrushOp`
 * type and this daemon's hand-written zod. `session.query` does not — `shared/wire.ts`
 * declares {@link SessionQueryRequest} once and `field-host/field-query.ts` imports THAT — so
 * the only thing that can drift is the schema against the single declaration both other
 * layers already share. This asserts exactly that.
 *
 * WHAT IT CATCHES IS NARROW, and the measured table lives at `op-schema.ts`'s
 * `OP_SCHEMA_MATCHES_CORE` rather than being re-derived (or, as that docblock records
 * happening twice, re-guessed): a RETYPED field and a newly-REQUIRED field fail the build; an
 * added, removed or renamed OPTIONAL field does not, because `extends` is assignability and
 * extra properties on the source side never break it. Do not read this as "it catches the
 * dangerous direction".
 *
 * It is worth the two lines anyway, because the failure it DOES catch is the one this
 * arrangement invites: a door that accepts a shape the chrome's `session.query` row hands
 * straight to `FieldHost.query`, which would then read a field that is not there.
 */
type QuerySchemaMatchesWire =
  z.infer<typeof spatialQuery> extends SessionQueryRequest ? true : never;
export const QUERY_SCHEMA_MATCHES_WIRE: QuerySchemaMatchesWire = true;

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
 * nothing there touches connection identity. That split earned itself in one task and again
 * in the next: `session.answer` landed here rather than on top of the filesystem verbs, and
 * `session.state` — the first command that ASKS rather than answers — landed beside it.
 *
 * Returned as its own `Handlers` map rather than mutating a passed-in one: a builder that
 * answers with what it built is a query, and `createHandlers` merges it in one line.
 *
 * @param session - undefined when the registry was built with no event feed. Every command
 * here then answers `no-session` — the three token-taking ones because they resolve no
 * token, `session.answer` because there is no correlation table for it to settle against,
 * and `session.state` because there is no connection to ask. That is the true answer rather
 * than a stub: a daemon with no feed has no connections, so there is no session for anyone
 * to be, nothing here can have asked one anything, and there is nothing to read.
 * `HandlerContext.session` argues why that seam is optional at all.
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

  // THE FIRST ASK, and the first command in this daemon whose answer it does not know
  // (foundations T4b). Everything else here decides from tables this process owns; this
  // one relays a question to the claimed tab and hands back what the tab said.
  //
  // NO TOKEN AND NO INPUT AT ALL. The other three name a connection because they say
  // something ABOUT one; this addresses whichever session is CLAIMED, which is the
  // backchannel's own resolution (`soleTarget` — zero and many both refuse, and the
  // message says which). A token here would let a caller ask a tab that is not the one
  // the human is in, which is the failure this tranche exists to prevent. `z.strictObject({})`
  // rather than a permissive schema, so a caller that invented a parameter is told so
  // rather than having it silently dropped.
  //
  // THE PAYLOAD IS RELAYED UNTYPED, deliberately: `shared/wire.ts` declares `SessionState`
  // for the end that BUILDS it (`frontend/lib/session-answerers.ts`), while this module is
  // the relay in between and validating here would put a second author on a shape the
  // builder would not learn about from it. The daemon cannot compute one field of it, which
  // is the whole reason the backchannel exists; it has no standing to police it either.
  //
  // AND THE RELAY STAYS UNTYPED ALL THE WAY OUT, which Task 5 settled by building the far
  // end: `daemon/mcp.ts` hands the payload to an agent as text and does NOT import
  // `SessionState` either. An earlier draft of this comment predicted it would — "both ends
  // that care import it" — and that was wrong about which ends care. The second reader is
  // the AGENT, and what it reads is the tool description and `editor-architecture.md` §4,
  // not a TypeScript declaration. A `SessionState` import at the door would be a cast over
  // bytes the daemon did not produce and cannot check: the same third-author problem one
  // hop further along.
  //
  // The `ask` rejects rather than hangs — no session, many sessions, a departed tab, a
  // silent one, an unserved method — and each of those is already an `EditorError` with a
  // code, so this body adds no error handling of its own. That is the seam keeping its
  // promise rather than every caller re-keeping it.
  handlers.set("session.state", {
    input: z.strictObject({}),
    run: () => {
      if (session === undefined) {
        throw new EditorError(
          "no-session",
          "this daemon has no event feed, so there is no editor session to read",
        );
      }
      return session.backchannel.ask("session.state", {});
    },
  });

  // THE SECOND ASK, AND THE FIRST WITH A BUDGET OF ITS OWN (foundations T4c). `session.state`
  // reads a record the chrome is already holding and answers in about as long as a POST
  // takes; this one asks the tab to RENDER — compose the frame's draw lists, run a mesh pass
  // and up to thirteen line passes into an off-screen texture, map the result back off the
  // GPU, swizzle it, and let a 2D canvas encode a PNG of up to 1568 px. The default 10 s is
  // a reasonable budget for a read and a thin one for that, so this is the day
  // `Backchannel.ask`'s third parameter earns the sentence its docblock has been carrying:
  // *"a per-method budget is a legitimate thing for a relay to carry (a worker round trip
  // and a ref read do not deserve the same wait)"*. It is no longer a production surface
  // with no production caller, and that docblock now says so.
  //
  // THIRTY SECONDS, and the number is chosen against the same client floor the default is:
  // Claude Code's per-request timer for an HTTP/SSE MCP server is 60 s and no configuration
  // can lower it (`backchannel.ts`'s constant argues it out), so 30 s is strictly inside the
  // floor for every client and leaves headroom for the answer's own POST. Above the floor
  // the agent's request would die first and the typed error we are so careful to produce
  // would be delivered to nobody.
  //
  // THE ENUM IS THE HOST'S OWN LIST, imported rather than retyped: `CAPTURE_VIEWS` lives on
  // the neutral floor for exactly this — the daemon may not touch anything that imports the
  // engine, and a hand-copied closed list is the drift `shared/wire.ts`'s header calls
  // invisible in both directions. `size` is bounded here as well as clamped in the host,
  // which is not belt-and-braces: a schema that states its range is what the MCP door
  // advertises to an agent (Task 6), and being TOLD the ceiling beats discovering it by
  // having a request silently reshaped.
  handlers.set("viewport.capture", {
    input: z.strictObject({
      view: z.enum(CAPTURE_VIEWS).optional(),
      size: z
        .number()
        .int()
        .min(MIN_CAPTURE_SIZE)
        .max(MAX_CAPTURE_SIZE)
        .optional(),
      overlays: z.boolean().optional(),
    }),
    run: (input) => {
      if (session === undefined) {
        throw new EditorError(
          "no-session",
          "this daemon has no event feed, so there is no editor session to photograph",
        );
      }
      return session.backchannel.ask(
        "viewport.capture",
        input,
        CAPTURE_ASK_TIMEOUT_MS,
      );
    },
  });

  // THE SPATIAL READ (foundations T4c) — the third ask, and the only one whose input is a
  // UNION rather than a bag of optional fields.
  //
  // ONE COMMAND RATHER THAN THREE, and the reason is the tool budget one layer up: the agent
  // door carries a hard ceiling of ten tools and the tranche's set is nine, so three spatial
  // reads would have spent a third of the remaining room on one concern. `z.discriminatedUnion`
  // rather than a union of object schemas, for `op-schema.ts`'s `shape` reason exactly — a bad
  // request reports against the arm it MEANT ("`origin` is required") instead of "no union arm
  // matched", which for a three-armed union is the difference between a fixable message and a
  // riddle.
  //
  // NO BUDGET OF ITS OWN. Unlike `viewport.capture` (a GPU round trip) and `generate` (a
  // generator's `evaluate` on the main thread), every answer here is store and log arithmetic
  // with a MEASURED cap on the only quadratic part (`field-host/field-query.ts`'s
  // `MAX_QUERY_PROPS`, sized against the human's frame budget rather than this timeout). The
  // default ask budget is more than a bounded read needs.
  //
  // `maxDist` IS BOUNDED HERE AND DEFAULTED IN THE HOST, which is the same split `size` takes
  // on `viewport.capture` and is worth restating rather than assuming: the schema is also the
  // ADVERTISEMENT, so an agent is TOLD the ceiling instead of discovering it — and the ceiling
  // is where it is because past it `raycastField`'s own step limit terminates the walk first
  // and a `null` would stop meaning "nothing there" (`shared/field-limits.ts` measures it out).
  handlers.set("session.query", {
    input: spatialQuery,
    run: (input) => {
      if (session === undefined) {
        throw new EditorError(
          "no-session",
          "this daemon has no event feed, so there is no editor session to measure",
        );
      }
      return session.backchannel.ask("session.query", input);
    },
  });

  // THE FIRST BROKERED WRITE (foundations T4c). Everything above relays a QUESTION; this
  // relays an INSTRUCTION, and the difference the daemon can see is exactly none — it is
  // still a relay with a correlation table, and the tab still decides. What changes is the
  // stakes of getting the schema right, which is why the op shape is validated here in full
  // (`op-schema.ts` argues why a door that advertises beats a door that discovers).
  //
  // ONE BATCHED VERB rather than one per op, and the reason is the HUMAN's undo stack: the
  // chrome lands the whole list as a single entry, so an agent's batch is one ⌘Z. A per-op
  // verb would be friendlier to compose and would fill the history with steps nobody drew.
  //
  // NO BUDGET OF ITS OWN. The work is a validation pass and a store write, both bounded by
  // the list the CALLER sent — so a caller that finds it slow has the remedy in its own
  // hands (send fewer ops), which is not true of `viewport.capture` or `generate` below.
  handlers.set("edit.apply", {
    input: z.strictObject({ ops: BRUSH_OPS }),
    run: (input) => {
      if (session === undefined) {
        throw new EditorError(
          "no-session",
          "this daemon has no event feed, so there is no editor session to edit",
        );
      }
      return session.backchannel.ask("edit.apply", input);
    },
  });

  // THE SECOND WRITE, and the one that MAKES rather than edits. It commits a generator in
  // one act — no stamp session opened and none left behind, which is not a detail: a
  // session standing after this call would refuse `world.bake` (`actions.ts`'s `enabled`
  // requires none) and every family key with it, so a verb that leaked one would break the
  // step after itself.
  //
  // THE PARAMS ARE `z.record(z.unknown())` AND THAT IS THE HONEST CEILING HERE. Every
  // generator has its own param schema, projected from zod by core's own `defineGenerator`
  // — and it lives in the REGISTRY, which is behind the engine, which this Node-portable
  // daemon may not import. So the daemon cannot check them and does not pretend to: core
  // validates them at commit and its rejection names the generator. What an agent needs in
  // order to send the right ones is the schema itself, which `session.state`'s neighbours
  // cannot carry either — it comes off `listGenerators`, and putting it in front of an
  // agent is the advertisement half of Task 6 rather than a validation gap here.
  handlers.set("generate", {
    input: z.strictObject({
      generatorId: z.string().min(1),
      params: z.record(z.string(), z.unknown()).optional(),
      seed: z.number().int().optional(),
      region: z
        .strictObject({
          min: z.tuple([z.number(), z.number(), z.number()]),
          max: z.tuple([z.number(), z.number(), z.number()]),
        })
        .optional(),
    }),
    run: (input) => {
      if (session === undefined) {
        throw new EditorError(
          "no-session",
          "this daemon has no event feed, so there is no editor session to generate into",
        );
      }
      return session.backchannel.ask(
        "generate",
        input,
        GENERATE_ASK_TIMEOUT_MS,
      );
    },
  });

  // THE NAMED-VERB DOOR — the editor's own 39 verbs, reachable by id.
  //
  // IT BUILDS NO ALLOW-LIST, deliberately, and that is the whole shape of the decision.
  // WHICH ids an agent is TOLD about is the MCP door's to choose (Task 6); which ids EXIST
  // is the action registry's, and `runNamedById` in the chrome is the one funnel that knows
  // the table and refuses an id that is not in it — with the list, so a caller learns what
  // it should have said. A second membership test here would be a second thing to keep in
  // step with the first, and the two would disagree the day a verb was added to one.
  // Advertisement is the filter; dispatch stays the validator.
  //
  // WHAT IT DOES VALIDATE is the half it can: the six verbs that take an input have their
  // schema HERE, in `action-registry/schemas.ts`, and this is where that schema is applied.
  // The chrome then relays `input` to the run unparsed — one author for one contract.
  //
  // THE FIRST DAEMON CONSUMER OF `action-registry/`, which that directory's own barrel
  // predicted it did not yet have. It is reached by RELATIVE path, as every in-package
  // import here is; the export-map entry remains for an outside-the-package consumer, which
  // this is not. Loading it on a DOM-free runtime was MEASURED before it was relied on
  // (`tests/action-registry/node-door.test.ts` is the standing form of that check) — it
  // value-imports `@furnace/core/registry` for its zod, and that module re-exports the same
  // single installed copy rather than reaching any browser API.
  //
  // AN ID WITH NO SCHEMA IS NOT AN ERROR: 33 of the 39 take no input at all. An `input`
  // sent with one is relayed and ignored by the run, exactly as it is for a chrome caller
  // that passes one — refusing it would need the descriptor table to tell "bare verb" from
  // "unknown id", which is the allow-list this command exists without.
  handlers.set("action.run", {
    input: z.strictObject({
      id: z.string().min(1),
      input: z.unknown().optional(),
    }),
    run: (raw) => {
      // Boundary cast: dispatch() validated input against this command's schema.
      const args = raw as { id: string; input?: unknown };
      if (session === undefined) {
        throw new EditorError(
          "no-session",
          "this daemon has no event feed, so there is no editor session to drive",
        );
      }
      if (FENCED_ACTIONS.has(args.id)) {
        throw new EditorError("invalid-input", fenceMessage(args.id));
      }
      // `Object.hasOwn` BEFORE the index, and it is a correctness fix rather than a
      // hardening flourish. `ACTION_INPUT_SCHEMAS` is a plain object literal, so it
      // INHERITS from `Object.prototype` — `ACTION_INPUT_SCHEMAS["toString"]` resolves to a
      // function, `schema !== undefined` passes, and `schema.safeParse` is not a method on
      // it. That throws a raw `TypeError`, which `dispatch` does not wrap, so `server.ts`
      // answers HTTP 500 `internal` and NO frame ever reaches the tab. An agent is told the
      // daemon broke when it merely named a verb that does not exist — the opposite of this
      // command's own contract, which says an unreal id is refused by the chrome funnel
      // WITH the list. Same for `valueOf`, `constructor`, `hasOwnProperty`, `__proto__`.
      // `Object.hasOwn` rather than a null-prototype map because it fixes the read at the
      // read, where the next person indexing this record will see it.
      const schema = Object.hasOwn(ACTION_INPUT_SCHEMAS, args.id)
        ? ACTION_INPUT_SCHEMAS[args.id as keyof typeof ACTION_INPUT_SCHEMAS]
        : undefined;
      // ABSENT INPUT IS ALWAYS LEGAL, including for the six. That is the chrome/agent split
      // `schemas.ts` states: a caller that names no object gets the run's fallback to
      // whatever is selected, and a caller that names one names all of it.
      if (schema !== undefined && args.input !== undefined) {
        const parsed = schema.safeParse(args.input);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new EditorError(
            "invalid-input",
            `invalid input for "${args.id}" at "${issue?.path.join(".") ?? ""}": ${issue?.message ?? ""}`,
          );
        }
      }
      return session.backchannel.ask("action.run", args);
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
