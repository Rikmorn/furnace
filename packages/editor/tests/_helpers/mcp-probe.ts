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

/** Everything `tests/mcp.test.ts` asserts on, in one JSON-serializable record. */
export type McpTranscript = {
  instructions: string | undefined;
  tools: unknown[];
  repeat: { first: ToolOutcome; second: ToolOutcome; listedTwice: number };
  disk: { project: ToolOutcome; worlds: ToolOutcome };
  inventedArgument: ToolOutcome;
  noSession: ToolOutcome;
  relay: { sent: unknown; outcome: ToolOutcome };
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
        tool: { effect: "dig", materialId: 2, mask: { kind: "any" } },
        gesture: null,
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
      "the relayed read",
      (d) => ({
        relay: { sent: null, outcome: failedCall(d) },
        nullAnswer: { postedBody: "", outcome: failedCall(d) },
        sessionRefusedTheMethod: failedCall(d),
      }),
      relayScenarios,
    )),
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
