import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { MCP_INSTRUCTIONS } from "../src/daemon/mcp.ts";
import type { McpTranscript } from "./_helpers/mcp-probe.ts";

// THE AGENT DOOR, DRIVEN BY THE SDK'S OWN CLIENT (foundations T4b Task 5).
//
// Every scenario speaks the real protocol over a real socket, because the thing most likely
// to be wrong about an MCP mount is not the tool bodies — those are three `dispatch` calls —
// but the TRANSPORT: whether a second request on one connection works at all, whether two
// clients collide, whether a result shape the SDK refuses to serialize is produced. A
// hand-rolled JSON-RPC POST would exercise none of that, and the failure the research
// measured (a stateless transport reused across requests) presents as an EMPTY 500 with no
// diagnostic on either side.
//
// **IT RUNS IN A CHILD PROCESS, and that is a measured requirement rather than a style.**
// Constructing any MCP SDK `Protocol` object in this process — client or server, with no
// transport and no request — costs the rest of the `bun test` run ~3× wall clock and reds
// four `@furnace/core` budget tests that otherwise clear their ceilings by up to 10×. The
// measurement, the eliminations, and the precedent (`action-registry/node-door.test.ts`
// reached for `Bun.spawn` for the same class of reason) are all stated at
// `tests/_helpers/mcp-probe.ts`, which is the script this file spawns.
//
// So the probe performs every exchange and prints one JSON transcript; the cases below are
// the assertions, under their own names. The daemon plays relay and the probe plays BOTH the
// agent and the chrome, which is the honest division: there is no browser here, and the
// daemon cannot compute one field of what `session_state` answers.

const PKG = join(import.meta.dir, "..");
let t: McpTranscript;

beforeAll(async () => {
  const proc = Bun.spawn(["bun", "tests/_helpers/mcp-probe.ts"], {
    cwd: PKG,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`mcp-probe exited ${code}:\n${err}`);
  // **UNCONDITIONALLY, and the first cut of this printed it only on a non-zero exit.** A
  // scenario that degrades writes its reason here and exits 0 (`scenario()` in the probe),
  // so the exit-code gate threw away the one copy of WHY while the failing assertion read
  // "PROBE SCENARIO FAILED — see stderr". The detail now also rides the degraded value, and
  // this print is what covers the fallbacks that are not text a failure message shows.
  if (err.trim() !== "") console.error(`mcp-probe stderr:\n${err}`);
  t = JSON.parse(out) as McpTranscript;
}, 60_000);

const parsed = (text: string): unknown => JSON.parse(text);

// --- The handshake, and what it advertises ------------------------------------

test("initialize delivers the instructions, and they fit the discovery budget", () => {
  expect(t.instructions).toBe(MCP_INSTRUCTIONS);
  // UNDER 2 KB, asserted on BYTES rather than characters: the cap is about what rides every
  // initialize of every session, and a multi-byte character costs what it costs.
  expect(Buffer.byteLength(MCP_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(2048);
  // ALL FOUR of the things the const's docblock names as the reason it is in there at all,
  // plus the read-only closing — a FIFTH claim rather than one of the four, pinned because
  // it is the sentence that stops an agent hunting for a write verb. An earlier version of
  // this comment said "the three things … each named at the docblock", which was wrong
  // twice over: the docblock names FOUR, and the third needle was not one of them — so the
  // relay fact and the `{ready:false}` arm were asserted by nothing at all.
  expect(MCP_INSTRUCTIONS).toContain("relays to"); // (1) the live half is RELAYED
  expect(MCP_INSTRUCTIONS).toContain("GUEST"); // (2) the claim model
  expect(MCP_INSTRUCTIONS).toContain("NEVER PARSE IT"); // (3) the cursor is compare-only
  expect(MCP_INSTRUCTIONS).toContain("{ready:false}"); // (4) the not-ready arm is real
  expect(MCP_INSTRUCTIONS).toContain("THIS SERVER READS"); // and the read-only closing
});

test("tools/list advertises exactly three read tools, and no outputSchema", () => {
  const tools = t.tools as {
    name: string;
    description?: string;
    inputSchema: { type: string };
    outputSchema?: unknown;
    annotations?: { readOnlyHint?: boolean };
  }[];
  // The table restated independently, the way `errors.test.ts` restates `HTTP_STATUS`: a
  // test that imported `TOOLS` would agree with any edit to it, including a fourth row.
  expect(tools.map((x) => x.name)).toEqual([
    "session_state",
    "world_list",
    "project_get",
  ]);
  for (const tool of tools) {
    // snake_case and prefix-free — the SERVER is the namespace, and a client composes
    // `mcp__<its own config key>__<name>` on top of these.
    expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    expect(tool.description ?? "").not.toBe("");
    expect(tool.inputSchema.type).toBe("object");
    // **NO `outputSchema`, on every row.** Declaring one has broken tool registration in the
    // client this door exists for, which is why the results are TEXT-first — a pin rather
    // than a comment, because "we did not add one" is exactly the kind of decision a later
    // convenience quietly reverses.
    expect(tool.outputSchema).toBeUndefined();
    expect(tool.annotations?.readOnlyHint).toBe(true);
  }
});

test("one client makes many calls on one connection — the per-POST transport holds", () => {
  // THE MEASURED FAILURE THIS PINS: a stateless transport reused across requests throws
  // inside the SDK's own request listener in 1.30.0, and the client sees a bare 500 with an
  // EMPTY BODY. It arrives on the SECOND request, never the first, so a suite that connected
  // and asserted one call would be green over a door that works exactly once.
  expect(t.repeat.first.isError).toBe(false);
  expect(t.repeat.second).toEqual(t.repeat.first);
  expect(t.repeat.listedTwice).toBe(3);
});

// --- The two daemon-direct reads ----------------------------------------------

test("project_get and world_list answer from the daemon, with no editor open", () => {
  expect(t.disk.project.isError).toBe(false);
  expect(parsed(t.disk.project.text)).toEqual({
    root: join(PKG, "tests", "fixtures", "mini-project"),
  });
  expect(t.disk.worlds.isError).toBe(false);
  expect(parsed(t.disk.worlds.text)).toEqual({
    defaultName: null,
    worlds: [],
  });
});

test("an invented argument is REFUSED, not dropped — dispatch validates this edge too", () => {
  // The door forwards the caller's arguments rather than composing `{}`, so the advertised
  // input schema (no properties) and the schema that actually decides (`z.strictObject({})`)
  // cannot drift apart in silence. Dropping the argument would make the tool answer happily
  // for a call it did not understand — the exact behaviour `session.state`'s own strict
  // schema exists to refuse over HTTP.
  expect(t.inventedArgument.isError).toBe(true);
  expect(t.inventedArgument.text).toContain("invalid-input");
  expect(t.inventedArgument.text).toContain("Re-read its inputSchema");
});

// --- The relayed read ---------------------------------------------------------

test("session_state with no editor open refuses in a sentence an agent can act on", () => {
  // `isError: true` RATHER THAN A PROTOCOL ERROR: "no editor is open" is an answer, and it
  // has to reach the agent's model rather than its error handler.
  expect(t.noSession.isError).toBe(true);
  expect(t.noSession.text).toContain("no-session");
  // The daemon's own sentence, relayed verbatim…
  expect(t.noSession.text).toContain("no editor session is claimed");
  // …and the half this edge adds, which is what the AGENT should do about it.
  expect(t.noSession.text).toContain("do not poll");
});

test("session_state relays what the claimed session said, verbatim", () => {
  expect(t.relay.outcome.isError).toBe(false);
  // The chrome's payload through two relays — the backchannel and this door — unchanged.
  // Neither validated it nor reshaped it, which is what `shared/wire.ts` owning
  // `SessionState` is for.
  expect(parsed(t.relay.outcome.text)).toEqual(t.relay.sent);
});

test("a session that answers NOTHING produces `null`, not a broken tool", () => {
  // THE ZERO-BYTE BUG'S TWIN, at the second edge. `session.answer` accepts a body with
  // `payload` ABSENT — the canonical serialization of a handler that returned `undefined` —
  // so the ask resolves `undefined`, and `JSON.stringify(undefined)` is the VALUE undefined.
  // Without the coalesce in `toolAnswer` the text block has no string in it, the SDK's own
  // `CallToolResult` validation rejects the result, and the agent is told the TOOL is broken
  // by a session that answered correctly.
  expect(t.nullAnswer.postedBody).not.toContain("payload");
  expect(t.nullAnswer.outcome.isError).toBe(false);
  expect(t.nullAnswer.outcome.text).toBe("null");
});

test("a session that REFUSES the method is reported as the editor's fault, not the agent's", () => {
  expect(t.sessionRefusedTheMethod.isError).toBe(true);
  expect(t.sessionRefusedTheMethod.text).toContain("internal");
  expect(t.sessionRefusedTheMethod.text).toContain(
    "this tab does not serve session.state",
  );
  expect(t.sessionRefusedTheMethod.text).toContain(
    "Retrying will not fix this",
  );
});

// --- Guests, not claimants ----------------------------------------------------

test("TWO agents read through ONE claim, and the unclaimed tab is never asked", () => {
  // **THE GUEST CLAUSE, END TO END.** Two MCP clients are two guests of one human's claim:
  // neither holds a session, neither can, and both get their own truthful answer. The second
  // half is the one a broadcast would break — the ask is written to the CLAIMED connection
  // only, so the other open editor tab hears nothing. Sabotage: point the backchannel's
  // `hub.emitTo` at `hub.emit` and this case reds on `bystanderSawRequest`, which is the
  // whole reason the frame is addressed rather than announced.
  expect(t.twoGuests.distinctRequestIds).toBe(2);
  for (const outcome of t.twoGuests.outcomes)
    expect(outcome.isError).toBe(false);
  // Each agent got exactly one of the two distinct payloads — which agent asked which id is
  // not knowable from outside and does not need to be. What is asserted is that two
  // concurrent guests never share an answer.
  expect(
    t.twoGuests.outcomes
      .map((o) => parsed(o.text) as { seq: number })
      .sort((a, b) => a.seq - b.seq),
  ).toEqual(t.twoGuests.payloads);
  // ADDRESSED, NOT BROADCAST: the tab that holds no claim was never asked anything.
  expect(t.twoGuests.bystanderSawRequest).toBe(false);
});

test("an agent cannot claim, steal, release or answer — those tools do not exist", () => {
  // The other half of the guest clause, and it is structural rather than a policy check: all
  // three claim verbs take a connection token minted INTO an SSE stream, and this door holds
  // no stream. There is nothing for it to project. A call to one of their names is a call
  // this server could not understand, so it is a protocol error rather than an `isError`
  // result — an agent cannot act on "that tool does not exist".
  expect(Object.keys(t.unknownTools)).toEqual([
    "session_claim",
    "session_steal",
    "session_release",
    "session_answer",
    "field_load",
    "generation_bake",
  ]);
  for (const [name, message] of Object.entries(t.unknownTools)) {
    expect(message, name).toContain(`no tool named "${name}"`);
  }
});
