// The MCP door, driven by the SDK's own client — IN A FRESH RUNTIME.
//
// **WHY A SUBPROCESS, and it is a measurement rather than a precaution.** Constructing ANY
// MCP SDK `Protocol` object — `new Client(…)` or `new Server(…)`, with no transport, no HTTP
// and no request — costs the REST of the `bun test` process about 3× wall clock. Measured
// this session on both halves and by elimination: the editor package's own suite goes
// 31.4 s → 48.5 s and the whole workspace suite 64 s → 194 s, which pushes four
// `@furnace/core` wall-clock budget tests over ceilings they otherwise clear by up to 10×
// (`cave carve — budget` 148 ms → 1581 ms against a 500 ms ceiling). It is NOT the transport
// (a `new Server` alone reproduces it in full), NOT Ajv (supplying the SDK's
// `jsonSchemaValidator` option changes nothing, and a bare `new Ajv()` reproduces none of
// it), NOT the HTTP path, NOT globals (nothing is added, removed or re-attributed on
// `globalThis`), and NOT GC pressure (a forced collection afterwards changes nothing).
// Running the door in a child process removes all of it: 32.0 s, measured.
//
// `tests/action-registry/node-door.test.ts` reached for `Bun.spawn` for the same class of
// reason one door over — *"`bun test` shares ONE process across this package's files …
// `Bun.spawn` fixes that at the root rather than by ordering"* — and its argument is this
// one's too. A fresh runtime makes the claim unconditional.
//
// **THE SPLIT IS TRANSCRIPT HERE, ASSERTIONS THERE.** This script performs every protocol
// exchange and prints ONE line of JSON; `tests/mcp.test.ts` spawns it once and asserts on
// slices of that transcript under its own case names. Nothing here decides whether the door
// is correct — a probe that asserted would report its own verdict, and a suite that read one
// boolean could not say WHICH scenario broke.
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCP_PATH } from "../../src/daemon/mcp.ts";
import { type RunningServer, startServer } from "../../src/daemon/server.ts";
import { type Feed, openFeed } from "./daemon-feed.ts";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "mini-project");

/** What one `tools/call` produced, flattened to the two things a pin asks about. */
export type ToolOutcome = { isError: boolean; text: string };

/** One content block, described rather than carried: a capture's image block is a megabyte
 *  of base64 and the transcript is a single line of JSON this probe prints on stdout. */
export type BlockShape = {
  type: string;
  mimeType?: string;
  /** Characters in the block's payload — the pin needs "the bytes are HERE and not there",
   *  which a length answers and the payload itself would only make unreadable. */
  length: number;
};

/** `viewport_capture`'s result, described one layer deeper than {@link ToolOutcome} can. */
export type CaptureOutcome = {
  isError: boolean;
  blocks: BlockShape[];
  /** The base64 the probe's fake chrome answered with, so the parent can assert the door
   *  handed over THAT string rather than some re-encoding of it. */
  posted: string;
  /** The image block's `data`, if there is one — compared against `posted`. */
  imageData: string | null;
  /** The text block, parsed: what is left of the answer once the PNG is lifted out. */
  measured: unknown;
};

/** Everything `tests/mcp.test.ts` asserts on, in one JSON-serializable record. */
export type McpTranscript = {
  instructions: string | undefined;
  tools: unknown[];
  repeat: { first: ToolOutcome; second: ToolOutcome; listedTwice: number };
  disk: { project: ToolOutcome; worlds: ToolOutcome };
  inventedArgument: ToolOutcome;
  noSession: ToolOutcome;
  /** One call per ADVERTISED BOUND, each sending a value the document forbids — the
   *  advertisement-equals-validation pin, taken through the real protocol. Keyed by a label
   *  the assertion prints, so a regression names the bound rather than a row number. */
  boundRefusals: Record<string, ToolOutcome>;
  /** The vacuity guard for the row above: a WELL-FORMED batch, refused only by the missing
   *  session. Without it every `boundRefusals` case would pass over a door that refused
   *  everything. */
  wellFormedBatch: ToolOutcome;
  /** `action_run {id:"edit.undo"}` — the id the daemon used to FENCE, sent at the door.
   *
   *  THE END-TO-END HALF OF THE FENCE LIFT. The deny-list is gone and undo ownership is a
   *  guard inside the tab's own run, so this call must now get PAST the daemon and refuse
   *  for the same reason any relayed verb refuses here: no session. What it must NOT be is
   *  `invalid-input` carrying the old fence's sentence.
   *
   *  IT PINS THE DOOR AND NOT THE GUARD, and the distinction is the harness's rather than a
   *  choice: `withClaimedSession` answers with a fake chrome that posts whatever payload the
   *  probe hands it, so a claimed run here would assert a refusal this file wrote. The
   *  ownership matrix is unit-tested against the real registry in `tests/actions.test.ts`. */
  undoReachesTheSession: ToolOutcome;
  relay: { sent: unknown; outcome: ToolOutcome };
  capture: CaptureOutcome;
  nullAnswer: { postedBody: string; outcome: ToolOutcome };
  sessionRefusedTheMethod: ToolOutcome;
  twoGuests: {
    outcomes: ToolOutcome[];
    /** The two DISTINCT answers posted, in ask order — `seq` is what lets the parent sort
     *  the agents' replies without knowing which agent asked which id. */
    payloads: { ready: false; seq: number; id: string }[];
    distinctRequestIds: number;
    bystanderSawRequest: boolean;
  };
  unknownTools: Record<string, string>;
};

let server: RunningServer | undefined;

/** The running daemon's port.
 *
 *  ONE NARROWING, AND IT THROWS. Every scenario below runs after `startServer` resolved, so
 *  an undefined server here is a restructure that broke this script rather than a state to
 *  tolerate — and the tolerant spellings are both wrong in the same direction: `server?.port`
 *  puts the string "undefined" in a URL, and `?? 0` connects to port 0, which is a REAL port
 *  request that fails somewhere unrelated with a message about the wrong thing. Six call
 *  sites used to carry one of those each. */
function port(): number {
  if (server === undefined) {
    throw new Error("mcp-probe: the daemon has not started");
  }
  return server.port;
}

const endpoint = (): URL => new URL(`http://127.0.0.1:${port()}${MCP_PATH}`);

async function connectAgent(name: string): Promise<Client> {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(endpoint()));
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: args });
  const blocks = Array.isArray(result.content) ? result.content : [];
  return {
    isError: result.isError === true,
    text: blocks
      .map((b) => (b.type === "text" ? b.text : `[${String(b.type)}]`))
      .join(""),
  };
}

/** The same call, kept at BLOCK resolution — for the one row whose answer is not text.
 *
 *  It pulls the two payloads out HERE rather than handing the raw blocks back, because the
 *  SDK types a content block as a union and every reader of it would otherwise re-narrow. */
async function callBlocks(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  isError: boolean;
  blocks: BlockShape[];
  imageData: string | null;
  text: string | null;
}> {
  const result = await client.callTool({ name, arguments: args });
  const raw = Array.isArray(result.content) ? result.content : [];
  let imageData: string | null = null;
  let text: string | null = null;
  const blocks: BlockShape[] = raw.map((b) => {
    const type = typeof b.type === "string" ? b.type : "?";
    const payload = type === "image" ? b.data : b.text;
    const carried = typeof payload === "string" ? payload : null;
    if (type === "image" && imageData === null) imageData = carried;
    if (type === "text" && text === null) text = carried;
    return {
      type,
      ...(typeof b.mimeType === "string" ? { mimeType: b.mimeType } : {}),
      length: carried === null ? -1 : carried.length,
    };
  });
  return { isError: result.isError === true, blocks, imageData, text };
}

const post = (command: string, body: unknown): Promise<Response> =>
  fetch(`http://127.0.0.1:${port()}/api/${command}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

const REQUEST_IDS = /"requestId":"([^"]+)"/g;

/** Wait until `count` asks have been written to this feed, and return their ids. A poll
 *  rather than a needle: two concurrent asks differ only by id, so there is no string to
 *  wait for that the first frame does not already satisfy. */
async function requestIdsOn(
  feed: Feed,
  count: number,
  timeoutMs = 5000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ids = [...feed.text().matchAll(REQUEST_IDS)].map((m) => m[1] ?? "");
    if (ids.length >= count) return ids.slice(0, count);
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(
    `only ${[...feed.text().matchAll(REQUEST_IDS)].length} of ${count} asks arrived; the feed said:\n${feed.text()}`,
  );
}

/** One claimed feed, one connected agent, and a guaranteed teardown of both. */
async function withClaimedSession<T>(
  world: string,
  agentName: string,
  body: (feed: Feed, agent: Client) => Promise<T>,
): Promise<T> {
  const feed = await openFeed(port());
  const agent = await connectAgent(agentName);
  try {
    const claimed = await post("session.claim", {
      name: world,
      token: feed.token,
    });
    if (claimed.status !== 200) {
      throw new Error(`claim failed with ${claimed.status}`);
    }
    return await body(feed, agent);
  } finally {
    await agent.close();
    // **RELEASED EXPLICITLY, THEN HUNG UP — and the order is the whole point.** The next
    // scenario claims immediately, and `session.claim` refuses an occupied world with
    // `already-exists` while `soleTarget()` refuses outright once TWO worlds are held. Both
    // used to be avoided by a race: `feed.hangUp()` alone leaves the release to the daemon's
    // `req.on("close")` (~2 ms measured at T4b Task 0), which beat a fresh TCP connect plus
    // an MCP initialize — every time, so far. A timing dependency is not a thing to leave in
    // the harness for the tranche whose whole subject is claim lifetime. The POST below
    // RETURNS after the table has dropped the claim, so the next scenario races nothing.
    await post("session.release", { token: feed.token });
    feed.hangUp();
  }
}

async function handshakeAndTools(): Promise<
  Pick<McpTranscript, "instructions" | "tools" | "repeat" | "disk">
> {
  const agent = await connectAgent("handshake");
  try {
    const instructions = agent.getInstructions();
    const { tools } = await agent.listTools();
    // The reuse case: several requests on ONE client connection. A stateless transport
    // reused across requests throws inside the SDK's own listener and the client sees a
    // bare 500 with an empty body — always on the SECOND request, never the first.
    const first = await call(agent, "project_get");
    await agent.listTools();
    const second = await call(agent, "project_get");
    const listedTwice = (await agent.listTools()).tools.length;
    return {
      instructions,
      tools,
      repeat: { first, second, listedTwice },
      // Its OWN call, not `first` under a second name. The two scenarios ask different
      // questions — one that the transport survives repetition, one that the tool answers
      // truthfully — and sharing an object would make the second pass on evidence gathered
      // for the first, so a `project_get` that broke only on a fresh handshake would hide.
      disk: {
        project: await call(agent, "project_get"),
        worlds: await call(agent, "world_list"),
      },
    };
  } finally {
    await agent.close();
  }
}

/**
 * **ONE CALL PER ADVERTISED BOUND, and every one of them runs with NO EDITOR OPEN.**
 *
 * That is not a convenience, it is what makes the case about the SCHEMA. `dispatch` parses
 * the arguments BEFORE it invokes the handler, so a value the advertised document forbids
 * earns `invalid-input` whether or not a tab is claimed — while a value the document ALLOWS
 * falls through to the handler and earns `no-session`. The two codes therefore read as "the
 * advertisement refused this" versus "the advertisement admitted this", with no session
 * machinery in the way of either.
 *
 * **THE LAST TWO ENTRIES ARE THE KNOWN GAPS rather than bounds** — every rule this door
 * enforces that its projected document cannot state, pinned here so the set stays known and
 * counted. There are exactly two, and each fails to project for a different reason:
 *
 *  1. **A zero direction vector.** JSON Schema has no "not this value", so `direction3`'s
 *     refinement cannot become a keyword. It rides `.describe()` instead, and the suite pins
 *     both the description and the refusal.
 *  2. **A stray key on an action row's `input`.** `action_run` advertises `input` as
 *     `unknown` (which is what its own schema says, and what is TRUE for the 33 bare verbs);
 *     the six that take an object are parsed against `ACTION_INPUT_SCHEMAS` one layer deeper.
 *     A per-id `oneOf` in the document would be a lie for the other 33.
 *
 * Both must still refuse, and the message is what an agent has instead of a keyword.
 *
 * **THERE WERE THREE UNTIL THE UNDO-ATTRIBUTION SLICE.** The third was a FENCED ACTION ID:
 * `session-handlers.ts` held a `FENCED_ACTIONS` deny-list over `action_run`'s free-string
 * `id`, refusing `edit.undo`/`edit.redo` for every agent. That list is gone — undo ownership
 * is now a state-dependent guard inside the tab's own run — so the door has one fewer rule
 * its document cannot state, and the count went DOWN rather than being weakened. What the
 * door does with that id now is {@link McpTranscript.undoReachesTheSession}.
 */
async function boundScenarios(): Promise<
  Pick<
    McpTranscript,
    "boundRefusals" | "wellFormedBatch" | "undoReachesTheSession"
  >
> {
  const goodOp = {
    kind: "brush",
    effect: "dig",
    shape: { kind: "sphere", center: [0, 0, 0], radius: 1 },
  };
  const probes: [string, string, Record<string, unknown>][] = [
    [
      "capture size above the advertised maximum",
      "viewport_capture",
      { size: 4096 },
    ],
    [
      "capture view outside the advertised enum",
      "viewport_capture",
      { view: "top" },
    ],
    [
      "ray maxDist above the advertised maximum",
      "session_query",
      { about: "ray", origin: [0, 0, 0], dir: [0, -1, 0], maxDist: 9999 },
    ],
    [
      "a two-number point where three are advertised",
      "session_query",
      { about: "ray", origin: [0, 0], dir: [0, -1, 0] },
    ],
    ["an about the union does not carry", "session_query", { about: "props" }],
    ["an empty batch where minItems is 1", "edit_apply", { ops: [] }],
    [
      "hollow below the advertised minimum",
      "edit_apply",
      { ops: [{ ...goodOp, effect: "fill", hollow: 0.05 }] },
    ],
    [
      "a misspelled op field, where additionalProperties is false",
      "edit_apply",
      { ops: [{ ...goodOp, radiuss: 2 }] },
    ],
    ["generate with no generatorId", "generate", {}],
    [
      "an invented argument on a no-argument row",
      "session_interrupt",
      { why: "stuck" },
    ],
    [
      "a zero direction — the ONE bound no JSON Schema can state",
      "session_query",
      { about: "ray", origin: [0, 0, 0], dir: [0, 0, 0] },
    ],
    // **THE STRIP→REFUSE CHANGE, AT THE WIRE.** `action_run`'s own schema admits any
    // `input`, so this key is refused one layer deeper — by the per-id schema
    // `ACTION_INPUT_SCHEMAS` holds, which went `z.strictObject` in the same commit that
    // advertised these ids. Until then it was STRIPPED: the call answered ok for arguments
    // it had silently discarded, which is the failure an agent cannot see. The isolated
    // schemas are pinned by `tests/action-registry/projection-round-trip.test.ts`; this is
    // the only thing that pins the behaviour an agent actually meets, and the posture is
    // the likeliest in this commit to be reverted as a style nit.
    [
      "a stray key on an action row's input — stripped before T4c, refused now",
      "action_run",
      { id: "world.saveAs", input: { name: "moonlit", nope: 1 } },
    ],
  ];
  const agent = await connectAgent("bounds");
  try {
    const boundRefusals: Record<string, ToolOutcome> = {};
    for (const [label, tool, args] of probes)
      boundRefusals[label] = await call(agent, tool, args);
    return {
      boundRefusals,
      // The same row, the same shape, one legal value — and therefore a REFUSAL FROM THE
      // SESSION rather than from the schema. It is what stops the twelve above passing over
      // a door that refuses every argument it is handed.
      wellFormedBatch: await call(agent, "edit_apply", { ops: [goodOp] }),
      // The id the deny-list used to hold, on the same unclaimed agent: it must now behave
      // like any other admitted argument — past the schema, past the daemon, and refused by
      // the session that is not there.
      undoReachesTheSession: await call(agent, "action_run", {
        id: "edit.undo",
      }),
    };
  } finally {
    await agent.close();
  }
}

/** The image split: a fake chrome answers a base64 PNG and the door must hand it over as an
 *  IMAGE block, with the measurements — and nothing else — beside it as text. */
async function captureScenario(): Promise<CaptureOutcome> {
  // Not a real PNG: this scenario is about the door's CONTAINER, and the daemon relays the
  // string untouched, so a recognizable stand-in makes a mis-routed payload obvious in the
  // failure message where 40 KB of real base64 would not. It must nonetheless be VALID
  // base64 — measured here: the SDK validates an image block's `data` and answers
  // `-32602 Invalid Base64 string` for anything else, which is the door reporting itself
  // broken on a chrome's behalf. The real answerer encodes a `Uint8Array`, so it always is.
  const posted = Buffer.from("furnace-capture-probe-payload").toString(
    "base64",
  );
  return await withClaimedSession("cavern", "photographer", async (feed, a) => {
    const called = callBlocks(a, "viewport_capture", { view: "+y", size: 256 });
    const [requestId] = await requestIdsOn(feed, 1);
    await post("session.answer", {
      requestId,
      ok: true,
      payload: { png: posted, width: 256, height: 144, view: "+y" },
    });
    const { isError, blocks, imageData, text } = await called;
    return {
      isError,
      blocks,
      posted,
      imageData,
      measured: text === null ? null : JSON.parse(text),
    };
  });
}

async function relayScenarios(): Promise<
  Pick<McpTranscript, "relay" | "nullAnswer" | "sessionRefusedTheMethod">
> {
  const relay = await withClaimedSession(
    "cavern",
    "reader",
    async (feed, a) => {
      const called = call(a, "session_state");
      const [requestId] = await requestIdsOn(feed, 1);
      const sent = {
        ready: true,
        cursor: "3/56/1/0/57",
        world: { name: "cavern", dirty: true, busy: false },
        // `armed` + `brush`, the shape T4c Task 5 landed — NOT the `tool`/`gesture` pair it
        // retired. This scenario is about VERBATIM relay, so it passes over any object at
        // all; that is exactly why the fixture has to be a payload a chrome can really
        // produce. One that cannot is a worked example of the misreading this tranche spent a
        // task removing, sitting in the harness for the door that removed it. The pairing is
        // deliberate too: nothing is armed but entity-select while the brush stands
        // configured to dig — the T4b gate walk's own state, read correctly this time.
        armed: { does: "selectEntity" },
        brush: { effect: "dig", materialId: 2, mask: { kind: "any" } },
        session: null,
        selection: { count: 12, truncated: false },
        selectedEntity: null,
        camera: { yaw: 0.5, pitch: -0.25 },
        stats: { totalOps: 56, undoDepth: 1, redoDepth: 0 },
        history: { undoLabel: "dig", redoLabel: null, tail: ["dig"] },
      };
      await post("session.answer", { requestId, ok: true, payload: sent });
      return { sent, outcome: await called };
    },
  );

  const nullAnswer = await withClaimedSession(
    "cavern",
    "silent-answer",
    async (feed, a) => {
      const called = call(a, "session_state");
      const [requestId] = await requestIdsOn(feed, 1);
      // The shape the wire really emits: `JSON.stringify` drops the undefined-valued key,
      // which is the canonical serialization of a handler that answered nothing.
      const postedBody = JSON.stringify({
        requestId,
        ok: true,
        payload: undefined,
      });
      await fetch(`http://127.0.0.1:${port()}/api/session.answer`, {
        method: "POST",
        body: postedBody,
      });
      return { postedBody, outcome: await called };
    },
  );

  const sessionRefusedTheMethod = await withClaimedSession(
    "cavern",
    "refused",
    async (feed, a) => {
      const called = call(a, "session_state");
      const [requestId] = await requestIdsOn(feed, 1);
      await post("session.answer", {
        requestId,
        ok: false,
        error: "this tab does not serve session.state",
      });
      return await called;
    },
  );

  return { relay, nullAnswer, sessionRefusedTheMethod };
}

async function twoGuests(): Promise<McpTranscript["twoGuests"]> {
  const held = await openFeed(port());
  const bystander = await openFeed(port());
  const [alice, bob] = await Promise.all([
    connectAgent("alice"),
    connectAgent("bob"),
  ]);
  try {
    await post("session.claim", { name: "grotto", token: held.token });
    const asked = Promise.all([
      call(alice, "session_state"),
      call(bob, "session_state"),
    ]);
    const ids = await requestIdsOn(held, 2);
    // Two DISTINCT payloads, answered in id order. Which agent asked which id is not
    // knowable from out here and does not need to be: what matters is that each agent got
    // exactly one of them.
    const payloads = ids.map((id, i) => ({
      ready: false as const,
      seq: i,
      id,
    }));
    for (const [i, id] of ids.entries()) {
      await post("session.answer", {
        requestId: id,
        ok: true,
        payload: payloads[i],
      });
    }
    return {
      outcomes: await asked,
      payloads,
      distinctRequestIds: new Set(ids).size,
      bystanderSawRequest: bystander.text().includes("session-request"),
    };
  } finally {
    await Promise.all([alice.close(), bob.close()]);
    // Released before the hang-up for `withClaimedSession`'s reason: nothing after this
    // scenario claims today, and a harness whose correctness depends on that staying true
    // is one edit from the same race.
    await post("session.release", { token: held.token });
    held.hangUp();
    bystander.hangUp();
  }
}

async function unknownTools(): Promise<Record<string, string>> {
  const agent = await connectAgent("would-be-claimant");
  const seen: Record<string, string> = {};
  try {
    for (const name of [
      "session_claim",
      "session_steal",
      "session_release",
      "session_answer",
      "field_load",
      "generation_bake",
    ]) {
      try {
        await agent.callTool({ name, arguments: {} });
        seen[name] = "NO REFUSAL — the call succeeded";
      } catch (err) {
        seen[name] = err instanceof Error ? err.message : String(err);
      }
    }
  } finally {
    await agent.close();
  }
  return seen;
}

/**
 * Run one scenario, and record a THROW as that scenario's own answer rather than as the
 * probe's death.
 *
 * **THIS IS WHAT KEEPS A SABOTAGE CUT NAMEABLE.** Several of the door's wires fail by making
 * a scenario throw rather than answer wrong — pointing `session_state` at another command
 * leaves the relay cases waiting for an ask that never comes, and dropping `toolAnswer`'s
 * coalesce makes the SDK reject its own result. If the probe died on the first of those, the
 * parent's `beforeAll` would throw and ALL eleven cases would red as one unnamed failure,
 * which says a cut broke something and not which. Degrading per scenario means the case that
 * owns the wire reds, and the ones that do not stay green.
 *
 * **THE FALLBACK IS A FACTORY BECAUSE IT MUST CARRY THE DETAIL, and the first cut of it did
 * not.** It took a fixed value whose text read *"PROBE SCENARIO FAILED — see stderr"* while
 * the parent captured that stderr and used it only on a non-zero exit — which a degraded
 * scenario never produces. So the harness delivered WHICH scenario broke and deleted WHY, in
 * the same breath that told the reader to go and look. The detail is now baked into the
 * value the assertion prints, and the parent surfaces the probe's stderr unconditionally
 * besides; the two are belt and braces because not every fallback is a string a failure
 * message shows (an empty `tools` list is not).
 *
 * Every fallback is a shape the assertions REJECT — a failed `ToolOutcome`, an empty list,
 * an impossible count — never a plausible one. A fallback that could pass is a green test
 * over a probe that never ran.
 */
async function scenario<T>(
  label: string,
  fallback: (detail: string) => T,
  run: () => Promise<T>,
) {
  try {
    return await run();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(`probe scenario "${label}" failed: ${detail}\n`);
    return fallback(`${label}: ${detail}`);
  }
}

/** The failed-call shape, carrying the reason the scenario died into the very text the
 *  assertion prints when it reds. */
const failedCall = (detail: string): ToolOutcome => ({
  isError: true,
  text: `PROBE SCENARIO FAILED — ${detail}`,
});

try {
  server = await startServer({ root: FIXTURE, port: 0 });

  const unclaimed = await scenario(
    "no-session + invented argument",
    (d) => ({ noSession: failedCall(d), inventedArgument: failedCall(d) }),
    async () => {
      const agent = await connectAgent("no-chrome");
      try {
        return {
          noSession: await call(agent, "session_state"),
          inventedArgument: await call(agent, "project_get", {
            token: "invented",
          }),
        };
      } finally {
        await agent.close();
      }
    },
  );

  const transcript: McpTranscript = {
    ...(await scenario(
      "handshake + tools + repeat + disk",
      (d) => ({
        instructions: undefined,
        tools: [],
        repeat: {
          first: failedCall(d),
          second: failedCall(d),
          listedTwice: -1,
        },
        disk: { project: failedCall(d), worlds: failedCall(d) },
      }),
      handshakeAndTools,
    )),
    ...unclaimed,
    ...(await scenario(
      "the advertised bounds",
      (d) => ({
        boundRefusals: { "probe-failed": failedCall(d) },
        wellFormedBatch: failedCall(d),
        undoReachesTheSession: failedCall(d),
      }),
      boundScenarios,
    )),
    ...(await scenario(
      "the relayed read",
      (d) => ({
        relay: { sent: null, outcome: failedCall(d) },
        nullAnswer: { postedBody: "", outcome: failedCall(d) },
        sessionRefusedTheMethod: failedCall(d),
      }),
      relayScenarios,
    )),
    capture: await scenario(
      "the capture image split",
      (d) => ({
        isError: true,
        blocks: [{ type: `PROBE SCENARIO FAILED — ${d}`, length: -1 }],
        posted: "",
        imageData: null,
        measured: null,
      }),
      captureScenario,
    ),
    twoGuests: await scenario(
      "two guests of one claim",
      (d) => ({
        outcomes: [failedCall(d)],
        payloads: [],
        distinctRequestIds: -1,
        bystanderSawRequest: true,
      }),
      twoGuests,
    ),
    unknownTools: await scenario(
      "the unadvertised names",
      (d) => ({ "probe-failed": d }),
      unknownTools,
    ),
  };
  // ONE line, on stdout, and nothing else is ever written there — the parent parses it
  // whole. Scenario diagnostics go to stderr, which the parent surfaces UNCONDITIONALLY
  // (a degraded scenario exits 0, so an exit-code-gated print threw away the only copy of
  // the reason), and each degraded value carries its own reason besides.
  console.log(JSON.stringify(transcript));
  server.close();
  process.exit(0);
} catch (err) {
  console.error(
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
  server?.close();
  process.exit(1);
}
