// packages/editor/src/daemon/mcp.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { EditorError, type EditorErrorCode } from "./errors.ts";
import { dispatch, type Handlers } from "./handlers.ts";

/**
 * The path the agent door answers on.
 *
 * ONE CONSTANT BECAUSE FOUR DIFFERENT JOBS SPELL IT, and the sentence deliberately carries
 * no count — it has been written wrong at two, at three and at four inside this one tranche,
 * which is proof enough that a number here is a maintenance liability rather than a fact
 * worth stating. What matters is the SET OF JOBS: this module writes the 405 that says what
 * the path accepts, `server.ts` matches the route on it, `main.ts` prints it in the startup
 * banner, and `tests/_helpers/mcp-probe.ts` connects to it. A door whose halves disagreed
 * about its own address would be reachable by neither, a banner that disagreed would send
 * the human somewhere the door is not, and a probe that disagreed would test nothing.
 */
export const MCP_PATH = "/mcp";

/**
 * What this server tells an agent it is, BEFORE any tool is called.
 *
 * `instructions` is delivered in the `initialize` response and is the surface a client's
 * tool search reads, so it is the one paragraph that decides whether an agent ever calls
 * `session_state` at the right moment. Written for a reader who has never heard of furnace:
 * every noun it uses is either explained here or is a tool name below.
 *
 * **UNDER 2 KB, and the cap is a budget rather than a limit that bites.** It rides every
 * initialize of every session, so it is paid for repeatedly and by every client; the pin in
 * `tests/mcp.test.ts` asserts the byte count so a later edit cannot quietly turn a
 * discovery blurb into a manual.
 *
 * FOUR THINGS AND NO MORE, each chosen because an agent that does not know it makes a
 * specific mistake. (1) That the live half is RELAYED to a browser tab — without it, a
 * `no-session` refusal reads as a broken server rather than as "nobody is editing". (2) The
 * claim model — without it, an agent asked to watch two tabs has no idea why the answer is
 * a refusal, and cannot tell the human what to do. (3) That the cursor is compare-only —
 * without it, an agent caches a payload against a token that certifies one member of it.
 * (4) That `{ready:false}` is a real answer — `shared/wire.ts` declares the arm and this door
 * really returns it, so an agent that read only the three above would meet a payload carrying
 * NONE of the fields promised one line up and have no reason to expect it. The payload is
 * self-describing, so that was incompleteness rather than falsehood; the discovery surface is
 * exactly where incompleteness of that kind gets pre-empted. Added at spec review.
 * The tool descriptions carry everything else, where they are read next to the call.
 */
export const MCP_INSTRUCTIONS = `The furnace editor daemon — a READ surface onto a live world-editing session.

Furnace is a WebGPU engine. Its editor is a browser tab where a human digs, fills, paints
and smooths a 3-D density FIELD into a world, and stamps generated pieces into it. This
daemon serves that tab and can read the project on disk itself — but everything about what the
human is DOING lives in the browser. So session_state is a question this daemon relays to that
tab and waits on; it is not a file it reads.

THE CLAIM MODEL, in two sentences. An editor tab claims the world it is authoring over its own
live connection, and exactly one claimed tab can be spoken for. You are a GUEST of that claim —
you never hold one and you cannot take one — so when no tab is claimed, or several are,
session_state says so instead of guessing which human you are watching.

WHICH TOOL WHEN:
- session_state — the world that is open and whether it has unsaved edits, what is selected,
  which tool and gesture are armed, where the camera points, and the undo history. The only
  fresh view of the live session: call it before answering anything about what the human is
  looking at or editing. A tab still starting up answers {ready:false} and NOTHING else, so
  branch on ready first. With no editor open it fails fast, with a sentence you can act on.
- world_list — the worlds saved on disk, and which is the default. Works with no editor
  open, and does NOT say which one the human has loaded (that is session_state).
- project_get — the absolute path of the project served. Works with no editor open; use it to
  resolve what world_list reports against your own filesystem tools.

session_state.cursor is an opaque change token: HOLD IT AND COMPARE IT, NEVER PARSE IT. An
unchanged cursor means no edit landed and no world was swapped. It certifies the history
member and nothing else — re-read rather than assume a selection, camera or stat is current.

THIS SERVER READS. Nothing here edits a world, writes a file, or moves the human's camera.`;

/**
 * Who is answering, in the protocol's own words.
 *
 * The version is a literal that tracks `packages/editor/package.json`, and it is copied
 * rather than imported because a JSON import would be the daemon's only one — a resolution
 * mode this Node-portable module does not otherwise need for a string nothing negotiates on.
 *
 * THE NAME IS NOT THE TOOL PREFIX. A client namespaces tools by the key the human wrote in
 * its own config (`mcp__furnace__session_state` comes from an entry named `furnace`), so
 * this name identifies the SERVER in logs and handshakes, and the tool names below carry no
 * prefix of their own — the server IS the namespace.
 */
const SERVER_INFO = { name: "furnace-editor", version: "0.0.0" };

/** The advertised argument shape for a tool that takes none. One object, shared by all
 *  three rows: three empty schemas would be three chances for one of them to grow a field
 *  nothing validates. */
const NO_ARGUMENTS = { type: "object" as const, properties: {} };

/** One projected tool: what an agent calls, what it dispatches to, and what it is for. */
type ToolRow = {
  /** `snake_case`, prefix-free — see {@link SERVER_INFO}. */
  readonly tool: string;
  /** The daemon command in `handlers.ts`' registry. */
  readonly command: string;
  readonly description: string;
};

/**
 * The three reads, and **why exactly three** (foundations T4b).
 *
 * EVERY ROW IS A DAEMON COMMAND, dispatched through the same `dispatch()` every other client
 * funnels through. That is the whole of the mapping: this table adds a name an agent can
 * search for and a sentence saying when to call it, and no behaviour. A tool that computed
 * anything would be a second author on an answer the registry already owns, and the claim
 * "every client funnels through one validator" (`handlers.ts`) would stop being literal at
 * the exact edge where the caller is least trusted.
 *
 * **`field.load` IS DELIBERATELY NOT PROJECTED.** It answers with a whole world — every
 * chunk and `.mat` sibling base64'd, plus the oplog — which is megabytes against a per-result
 * budget measured in tens of thousands of tokens. There is no honest way to hand that to an
 * agent as text, and a truncation would be a lie in the one direction this tranche exists to
 * close. What a trimmed world read looks like is T4c's question, and it is a design question
 * rather than a plumbing one.
 *
 * **AND NEITHER IS ANY `session.*` VERB, which is the guest clause in one line.** `claim`,
 * `steal` and `release` are not absent because they would be dangerous — they are
 * unspellable: all three take a connection token minted into an SSE stream, and this door
 * holds no stream (`events.ts`'s `subscribe` argues why that is structural rather than a
 * rule). `session.answer` is the chrome's return leg and names a pending ask, not a caller.
 * So an MCP client reads THROUGH whichever session is claimed and can never become one.
 */
const TOOLS: readonly ToolRow[] = [
  {
    tool: "session_state",
    command: "session.state",
    description:
      'Read the live editor session: which world is open and whether it has unsaved edits, what the human has selected, which tool and gesture are armed, where the camera points, and the undo/redo history with its labels. Relayed to the editor tab in the browser — the only fresh view of what the human is doing. A tab whose engine is still loading answers {"ready": false} and NO other field, so branch on `ready` before reading anything else. Returns an actionable refusal when no editor tab is claimed, when several are, or when the tab does not answer within 10 seconds.',
  },
  {
    tool: "world_list",
    command: "world.list",
    description:
      "List the worlds saved under the project's worlds/ directory, with the default world and a per-row git-tracked flag. Reads the disk, so it works with no editor open — and it does NOT say which world the human currently has loaded (that is session_state).",
  },
  {
    tool: "project_get",
    command: "project.get",
    description:
      "The absolute filesystem path of the project this editor daemon is serving. Reads no world state and works with no editor open; use it to resolve the world names world_list reports against your own filesystem tools.",
  },
];

/**
 * **The MCP edge's mapping of {@link EditorErrorCode}, in one place** — the binding
 * `errors.ts` promises in its header ("the domain speaks codes; each transport edge owns its
 * own mapping"). Its sibling is `httpStatus`, and the two are the same shape for the same
 * reason: an exhaustive `Record` over a closed union, so an eleventh code is a compile error
 * until this edge has said what to do about it.
 *
 * **EACH ROW IS WHAT THE AGENT SHOULD DO, never what went wrong.** The daemon's own message
 * already says what went wrong, and two of them already carry a remedy addressed to the
 * HUMAN ("open the editor on this project", "close all but the tab you want driven"). What
 * an `isError: true` tool result needs beside that is the other half — whether retrying is
 * sensible, and whether a human has to move first — because that is the sentence an agent
 * acts on and the one no daemon-side message is written for.
 *
 * **FOUR ROWS ARE REACHABLE TODAY AND THE REST ARE STATED ANYWAY.** `no-session` and
 * `session-timeout` are the backchannel's own refusals and are the reason this table exists;
 * `internal` catches a chrome that answered "I could not do that" and a genuine daemon fault
 * alike; and `invalid-input` became reachable the moment this door chose to FORWARD the
 * caller's arguments (see {@link createMcpDoor}) rather than compose its own. The other six
 * cannot arrive through three no-argument reads — `not-found`, `outside-root` and
 * `already-exists` belong to commands not projected here, `invalid-json` is thrown at the
 * HTTP body boundary this door never crosses, `unknown-command` requires the registry and
 * this table to disagree, and `forbidden-origin` is refused ahead of the route branch
 * entirely, so a tool call cannot be running when it is thrown. They are written because the
 * union is closed and T4c will project verbs that reach four of them, and because a row that
 * says "this cannot happen" would be worthless the first time it did.
 *
 * NOT A LOCATOR RE-THROW, and the standing trigger was checked rather than assumed. The
 * `locator-rethrow-primitive-respelled-six-ways` entry fires on a seventh
 * catch-and-re-throw-under-a-locator site, and names "T4b/T4c adding locators on the MCP
 * verb boundary" as a second trigger. This edge does neither: it CONVERTS a throw into a
 * value (a tool result an agent reads) rather than re-throwing one, and it adds no locator —
 * MCP correlates a result to the call that produced it, so naming the tool in the text would
 * be the convention respelled for a reader who is already holding the answer to it. The
 * `code:` prefix below is the contract crossing the edge, not a call-site name.
 */
const AGENT_REMEDY: Record<EditorErrorCode, string> = {
  "no-session":
    "Nothing you can do changes this — a human has to open the furnace editor on this project, or close all but the tab they want you reading. Say what you need and stop; do not poll.",
  "session-timeout":
    "The editor is there and did not answer in time; a bake or a remesh will do that. Calling this tool once more is reasonable. If it times out twice, tell the human their editor tab looks stuck.",
  internal:
    "Retrying will not fix this: the daemon and the editor tab disagree, or something failed inside the daemon. Quote the message to the human — a tab left open across an editor upgrade usually just needs a reload.",
  "invalid-input":
    "The arguments are wrong for this tool. Re-read its inputSchema and call it again passing only what it declares.",
  "unknown-command":
    "This tool is wired to a daemon command that does not exist, so the daemon is not the one this tool list was built for. Ask the human to restart the editor daemon.",
  "not-found":
    "What you named is not there. Call world_list to see what exists and use a name from it.",
  "outside-root":
    "That path leaves the project this daemon serves. Call project_get for the root and stay inside it.",
  "already-exists":
    "That name is taken. Pick a different one, or ask the human to clear what is there first.",
  "invalid-json":
    "A request body did not parse. That is a defect in this MCP door rather than in your call — report it to the human instead of retrying.",
  "forbidden-origin":
    "The daemon refused the declared browser origin. An MCP client sends none, so something is relaying this call through a web page — tell the human before trying again.",
};

/** The failure half of the edge: any throw out of `dispatch`, as a result an agent reads.
 *
 *  `isError: true` RATHER THAN A JSON-RPC ERROR, which is the settled posture for anything
 *  the TOOL decided: a protocol error is for a call the server could not understand, and an
 *  agent's client surfaces it as a broken tool rather than as an answer. "No editor is open"
 *  is an answer — the truest one this door can give — and it belongs where the agent's model
 *  can read it and act.
 *
 *  A NON-`EditorError` LANDS ON `internal`'s ROW, exactly as `server.ts`'s catch maps the
 *  same class to a 500 `internal`. One rule, two edges: a throw with no contract code is a
 *  daemon fault, and both edges say so in their own vocabulary.
 *
 *  `Error.cause` IS DROPPED, deliberately and identically to `server.ts`'s catch — the
 *  daemon's house rule is that a wire carries the message, not the chain. It is worth one
 *  clause because `internal`'s remedy tells the agent to *quote the message to the human*,
 *  and a cause the agent never received is one the human never hears: the day an editor
 *  error starts wrapping a meaningful cause, BOTH edges have to learn to unwrap it, not just
 *  this one. Nothing in the daemon sets `cause` today. */
function toolFailure(err: unknown): CallToolResult {
  const code: EditorErrorCode =
    err instanceof EditorError ? err.code : "internal";
  const detail = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [
      { type: "text", text: `${code}: ${detail}\n\n${AGENT_REMEDY[code]}` },
    ],
  };
}

/** The success half: whatever the command answered, as pretty JSON in ONE text block.
 *
 *  TEXT-FIRST AND NO `outputSchema`, deliberately: a declared output schema has broken tool
 *  registration in the client this door is built for, and a `structuredContent` beside the
 *  text without one buys nothing an agent can use. Pretty-printed because these three
 *  payloads are small BY CONSTRUCTION — the read that is not (`field.load`) is the one
 *  {@link TOOLS} argues out — and because the human watching the transcript reads the same
 *  bytes the agent does.
 *
 *  **`?? "null"` IS THE SAME FIX `sendJson` MADE, AT THE SECOND EDGE, and it is reachable
 *  here for the same reason.** `session.state` relays whatever the chrome answered, and
 *  `session.answer` accepts a body with `payload` ABSENT — the canonical serialization of a
 *  handler that answered `undefined`. `JSON.stringify(undefined)` returns the VALUE
 *  `undefined`, which is not a string, so without the coalesce this block fails the SDK's own
 *  `CallToolResult` validation and the agent is told the TOOL is broken by a session that
 *  answered correctly. `null` rather than `{}` for `sendJson`'s reason: the ask really did
 *  resolve nothing, and JSON's spelling of nothing is `null`. */
function toolAnswer(answer: unknown): CallToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(answer, null, 2) ?? "null" },
    ],
  };
}

/** The agent door: one HTTP path, answered per request. */
export type McpDoor = {
  /**
   * Answer one request on {@link MCP_PATH}. Owns every method on that path — a POST is the
   * transport's, and everything else earns the 405 this module writes itself.
   *
   * @throws whatever the transport throws. `server.ts`'s catch is still the one typed-envelope
   * edge, and its `headersSent` guard exists because this method commits the response before
   * it returns.
   */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
};

/**
 * **The MCP door: ALL of this editor's transport concerns, in one module.**
 *
 * WHY ONE MODULE. The Model Context Protocol is on its way to a v2 SDK and a newer protocol
 * revision, and **every line that names an SDK type is a line that migration rewrites**: the
 * transport class, the handshake, the request-handler registration, the result shape.
 * Keeping those together means the rewrite is one file with one test suite beside it, rather
 * than a diff spread across the route table. `server.ts` gets a branch and a guard and
 * learns nothing else about MCP.
 *
 * TWO THINGS HERE WOULD SURVIVE THAT REWRITE INTACT and are named rather than glossed:
 * {@link MCP_INSTRUCTIONS} and {@link AGENT_REMEDY} reference no SDK type at all — they are
 * prose, and prose is this door's contract with an AGENT rather than with a protocol
 * version. They live here anyway because that contract is what the door IS, and because
 * splitting them out would trade one seam for two over a file whose bulk is not logic:
 * roughly half of it is comment and a further chunk is prose literals, which
 * `clean-code.md` exempts from the size signal precisely because declarative content does
 * not carry the cognitive load a body does. (An earlier draft of this paragraph claimed
 * every line below is one the migration rewrites. It is not, and the decision never needed
 * it — corrected at code-quality review.)
 *
 * **A SERVER AND A TRANSPORT PER POST, and this is measured rather than stylistic.** In SDK
 * 1.30.0 a STATELESS transport cannot be reused: the second request through one throws
 * *"Stateless transport cannot be reused across requests"* from inside the transport, where
 * the SDK's own `@hono/node-server` request listener catches it and writes a bare 500 with an
 * EMPTY BODY — a failure with no diagnostic on either side, and one that arrives only on the
 * second call, so it survives every smoke test. Measured at T4b Task 0 on both runtimes the
 * daemon must serve: initialize answers 200 and every later POST is that empty 500. It is
 * written here so nobody re-derives it from the symptom.
 *
 * **A STATEFUL TRANSPORT WAS THE OTHER SHAPE, AND IT IS FENCED OUT ON PURPOSE.** One
 * transport with a `sessionIdGenerator` also round-trips, but it serves exactly one client —
 * the SDK refuses a second `initialize` on an initialized transport — so it would need a
 * table keyed by `Mcp-Session-Id`, and the daemon would then have TWO session concepts. The
 * settled ledger for this tranche is explicit that **the claim never couples to
 * `Mcp-Session-Id`**: the editor's one session is the SSE claim a human's tab holds, and a
 * per-request transport is what keeps that literally true. It also buys the guest clause for
 * free — two agents are two independent POSTs reading through one human's claim, which is
 * exactly what they are.
 *
 * **NOTHING LEAKS ON THE ERROR PATH, and the reason is NOT the one this docblock gave for
 * two reviews.** It said `server.close()` reaches the transport only once `connect` has
 * attached it, so a throw from `connect` would leave a transport nobody closes. **That is
 * false for the pinned SDK**, checked at source rather than reasoned about:
 * `shared/protocol.js`'s `connect` assigns `this._transport = transport` SYNCHRONOUSLY, on
 * the line after the already-connected guard and before its only `await`, and `Server` does
 * not override it — so the sole throw that can precede the assignment is that guard, which
 * cannot fire on a `Server` constructed one statement earlier. There is no reachable path on
 * which closing the server alone leaves a transport open.
 *
 * **BOTH ARE STILL CLOSED, on the reason that does hold: this `finally` must not depend on
 * an SDK internal it does not own.** "Closing the server closes its transport" is
 * `Protocol.close()`'s current implementation, not a contract the type states — and the v2
 * migration this module is shaped around is exactly the event that could change it silently.
 * The transport is constructed here, so it is closed here; that is a local invariant this
 * file can keep by itself. Closing it twice is free — `close()` is idempotent, verified in
 * the same reading.
 *
 * They are closed CONCURRENTLY through `allSettled` rather than in sequence, so **neither
 * can hide the other's failure and neither can replace the original error**: a sequential
 * `await` pair drops the second close whenever the first rejects, and any rejection out of a
 * `finally` replaces whatever the `try` was already throwing. Nothing rejects today; the
 * ordering that used to encode the false argument above is gone, so nothing is left to
 * suggest a sequence carries meaning.
 *
 * **THE BODY IS NOT PRE-READ.** The raw `IncomingMessage` goes to `handleRequest` with no
 * `parsedBody`, so the transport reads the stream itself. `POST /api/*`'s `readBody` stays a
 * disjoint branch of the route ladder; the two never see the same request.
 *
 * @param handlers - the daemon's one command registry. Every tool dispatches through it, so
 * this door validates nothing of its own — see {@link TOOLS}.
 */
export function createMcpDoor(handlers: Handlers): McpDoor {
  const listTools = (): { tools: Tool[] } => ({
    tools: TOOLS.map((row) => ({
      name: row.tool,
      description: row.description,
      inputSchema: NO_ARGUMENTS,
      // The protocol's own word for the decision this tranche already made: no tool here
      // mutates anything. It is a HINT by specification, so it is a statement of intent to a
      // client rather than a guarantee to lean on — which is exactly what it is: the
      // guarantee is that no mutating command is projected at all.
      annotations: { readOnlyHint: true },
    })),
  });

  const callTool = async (
    name: string,
    args: Record<string, unknown> | undefined,
  ): Promise<CallToolResult> => {
    const row = TOOLS.find((r) => r.tool === name);
    if (row === undefined) {
      // A PROTOCOL ERROR RATHER THAN AN `isError` RESULT, and the split is the one
      // `toolFailure` states: a name that was never advertised is a call this server could
      // not understand, not a tool that ran and failed. An agent cannot act on "that tool
      // does not exist" — its client's registry is what is wrong — so it belongs in the
      // channel a client reports as a broken call. This is also the guest clause's refusal:
      // `session_claim` and its siblings arrive here and leave by this line.
      throw new McpError(ErrorCode.InvalidParams, `no tool named "${name}"`);
    }
    try {
      // THE CALLER'S ARGUMENTS ARE FORWARDED rather than replaced with `{}`, and that is the
      // decision that keeps `dispatch` the single validator at this edge too. All three
      // commands take `z.strictObject({})`, so an invented argument earns `invalid-input`
      // here exactly as it does over HTTP — where dropping it silently would let the tool's
      // advertised schema and the schema that actually decides drift apart with nothing to
      // notice. `?? {}` because the protocol makes `arguments` optional and a missing bag
      // is an empty one.
      return toolAnswer(await dispatch(handlers, row.command, args ?? {}));
    } catch (err) {
      return toolFailure(err);
    }
  };

  /** One handshake-capable server, built fresh per POST — see this module's header. */
  const buildServer = (): Server => {
    const server = new Server(SERVER_INFO, {
      capabilities: { tools: {} },
      instructions: MCP_INSTRUCTIONS,
    });
    server.setRequestHandler(ListToolsRequestSchema, listTools);
    server.setRequestHandler(CallToolRequestSchema, (request) =>
      callTool(request.params.name, request.params.arguments),
    );
    return server;
  };

  const servePost = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } finally {
      // `allSettled`, not a sequential pair — see this module's header: neither close may
      // hide the other's failure, and neither may replace the error the `try` is throwing.
      await Promise.allSettled([transport.close(), server.close()]);
    }
  };

  return {
    async handle(req, res) {
      // `await` rather than returning the promise, which is what makes the `async` modifier
      // honest — `return servePost(...)` on an `async` method is a `useAwait` warning, and
      // the alternative it replaced (a non-async method ending on `Promise.resolve()`) was
      // the same wart spelled at the other end. Both forms are behaviourally identical here:
      // `route` awaits whatever this returns.
      if (req.method === "POST") {
        await servePost(req, res);
        return;
      }
      // **405 WITH `Allow`, AND IT IS THIS MODULE'S ANSWER RATHER THAN THE TRANSPORT'S.**
      // A GET on an MCP endpoint asks to open a server→client notification stream, and this
      // door has nothing to push: the only thing the daemon pushes is the SSE change feed the
      // CHROME subscribes to, over its own route. 405 + `Allow: POST` is the specification's
      // sanctioned answer for exactly that, and answering it here — rather than handing the
      // GET to a transport — is what stops a per-request transport being opened for a stream
      // nothing will ever close.
      //
      // Plain text rather than the daemon's `{ error: { code, message } }` envelope, and
      // deliberately: that envelope carries an `EditorErrorCode`, and there is no code for
      // "wrong method on the agent door" — inventing an eleventh one would put an HTTP
      // status into a domain union to describe a request no editor command ever sees.
      res.writeHead(405, {
        allow: "POST",
        "content-type": "text/plain; charset=utf-8",
      });
      res.end(
        `${MCP_PATH} is the furnace editor's MCP endpoint and accepts POST only — it opens no server-initiated stream\n`,
      );
    },
  };
}
