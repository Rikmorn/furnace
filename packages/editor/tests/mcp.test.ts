import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { ACTION_INPUT_SCHEMAS } from "../src/action-registry/schemas.ts";
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

/** One advertised row, as a client reads it off the wire. */
type AdvertisedTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean };
};

const advertised = (): AdvertisedTool[] => t.tools as AdvertisedTool[];

const isJsonObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every schema NODE in a document, root included — `properties` and `$defs` hold schemas
 *  under arbitrary keys, everything else nests positionally. */
function nodesOf(doc: unknown, into: Record<string, unknown>[] = []) {
  if (Array.isArray(doc)) {
    for (const item of doc) nodesOf(item, into);
    return into;
  }
  if (!isJsonObject(doc)) return into;
  into.push(doc);
  for (const [keyword, value] of Object.entries(doc)) {
    if (keyword === "properties" || keyword === "$defs") {
      if (isJsonObject(value))
        for (const child of Object.values(value)) nodesOf(child, into);
    } else if (keyword !== "enum" && keyword !== "required") {
      nodesOf(value, into);
    }
  }
  return into;
}

// --- The handshake, and what it advertises ------------------------------------

test("initialize delivers the instructions, and they fit the discovery budget", () => {
  expect(t.instructions).toBe(MCP_INSTRUCTIONS);
  // UNDER 2 KB, asserted on BYTES rather than characters: the cap is about what rides every
  // initialize of every session, and a multi-byte character costs what it costs.
  expect(Buffer.byteLength(MCP_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(2048);
  // ALL SIX of the things the const's docblock names as the reason it is in there at all.
  // Four of them are T4b's; the last two arrived with the door's hands, and both are pinned
  // because both are sentences an agent ACTS on rather than reads past.
  expect(MCP_INSTRUCTIONS).toContain("relays to"); // (1) the live half is RELAYED
  expect(MCP_INSTRUCTIONS).toContain("GUEST"); // (2) the claim model
  expect(MCP_INSTRUCTIONS).toContain("NEVER PARSE IT"); // (3) the cursor is compare-only
  expect(MCP_INSTRUCTIONS).toContain("{ready:false}"); // (4) the not-ready arm is real
  expect(MCP_INSTRUCTIONS).toContain("ONE undo step"); // (5) a batch is one ⌘Z
  // (6) THE ARMEDNESS RULE, which is the sentence a measured misreading cost us. It is
  // pinned as the RULE and not as a member list, because the member list is what was
  // already there when the agent got it wrong. Matched against the text REFLOWED to single
  // spaces: this literal is hard-wrapped for the source, and a needle that also asserted
  // where the wrap fell would red on a reflow that changed nothing an agent reads.
  expect(MCP_INSTRUCTIONS.replace(/\s+/g, " ")).toContain(
    "`brush` is a standing SETTING and is NOT a claim that anything is armed",
  );
  // **THE READS-ONLY CLOSING IS GONE, asserted as an ABSENCE.** It was pinned as a presence
  // for the whole of T4b and it stopped being true the moment the daemon grew write verbs;
  // a door with hands that tells an agent "nothing here edits a world" is worse than one
  // that says nothing, because the sentence is acted on.
  expect(MCP_INSTRUCTIONS).not.toContain("THIS SERVER READS");
  // **THE VISIBILITY CLAUSE, pinned in BOTH directions, because it went stale inside the
  // same tranche that made it stale and nothing caught it.** T4c Task 5 built the presence
  // chip — `useSessionAnswer` records EVERY relayed method and `StatusBar` renders
  // `agent <verb> <n>` — while this blurb still said *"neither your verbs nor your refusals
  // are shown to them"*. Half true is the worst state for a sentence an agent uses to decide
  // how much to explain itself to the human. The positive half is what the chip really does;
  // the negative half is the T4b ruling that outcomes stay quiet, which `agent-presence.ts`
  // holds BY TYPE (`ran` takes no result). Both are asserted, so restoring either error reds
  // here rather than at a gate walk.
  expect(MCP_INSTRUCTIONS.replace(/\s+/g, " ")).toContain(
    "their status bar names the verb you just ran",
  );
  expect(MCP_INSTRUCTIONS).not.toContain("neither your verbs");
});

test("tools/list advertises the nine, with readOnlyHint per ROW and no outputSchema", () => {
  // The table restated independently, the way `errors.test.ts` restates `HTTP_STATUS`: a
  // test that imported `TOOLS` would agree with any edit to it, including a tenth row.
  // `reads` is restated here too — a row that flipped to `readOnlyHint: true` while it
  // writes is the one defect this annotation can cause, and it cannot be caught by a loop
  // that reads the flag off the same table it is checking.
  expect(
    advertised().map((x) => ({
      name: x.name,
      readOnly: x.annotations?.readOnlyHint,
    })),
  ).toEqual([
    { name: "session_state", readOnly: true },
    { name: "world_list", readOnly: true },
    { name: "project_get", readOnly: true },
    { name: "session_query", readOnly: true },
    { name: "viewport_capture", readOnly: true },
    // The four writes carry NO annotations object at all, so `readOnlyHint` reads
    // `undefined` — the specification's default is already "not read-only", and an explicit
    // `false` would be a second spelling of one fact.
    { name: "edit_apply", readOnly: undefined },
    { name: "generate", readOnly: undefined },
    { name: "action_run", readOnly: undefined },
    { name: "session_interrupt", readOnly: undefined },
  ]);
  // TEN IS THE CEILING the tranche budgeted and nine is what it spent. Asserted as a bound
  // rather than restated as a count, because the count above already inventories the rows;
  // what this adds is the BUDGET, which is the thing a later row has to argue against.
  expect(advertised().length).toBeLessThanOrEqual(10);
  // **AND THE PROSE IS BUDGETED TOO, on the same argument the row count is made with.** The
  // ceiling-of-ten exists because "every row a model must consider is paid for on every
  // turn"; the descriptions are 7,983 bytes against `MCP_INSTRUCTIONS`'s pinned 2 KB and ride
  // the same `tools/list`, so pinning the blurb alone would budget the cheaper surface. BYTES,
  // for the instructions pin's reason exactly — a multi-byte character costs what it costs,
  // and these rows are full of em-dashes. 8,192 was 1.36× head at Task 6, 1.157× after the
  // T4c review's 1,078 bytes of corrections, 1.092× after T5's 420, 1.042× after cycle 2's
  // flags arm spent 363, and is 1.026× after the undo-attribution slice spent 118 — 209
  // bytes left, SHORTER THAN EVERY ONE OF THE NINE ROWS. The tenth-row headroom this comment
  // used to claim is gone, and that is the budget working rather than slack running out: a
  // tenth verb now has to be argued against the prose cap before the ceiling of ten is even
  // reached, and there is no longer a standing row short enough to be the model for one
  // (the shortest is project_get, 214).
  //
  // WHAT THE LAST 118 BOUGHT, because a budget spent without a reason recorded is a budget
  // that gets spent again: the fence lift REWROTE the undo sentence at par (the rule changed
  // from "never" to "only your own") and ADDED one about `session.confirm` being left
  // unattributed. That second one is not a caveat — an agent told it may step its own work
  // will step a confirm it triggered and read "the top history entry is the human's", which
  // is true under the absent-means-human convention and reads as a contradiction without
  // this sentence.
  // A TOTAL rather than a per-row cap, because `session_query`'s wall is the one length this
  // door had to buy.
  // The figures above are derived, not typed: `bun test tests/mcp.test.ts` with a scratch
  // `console.log(proseBytes)` on the reduce below (inserted, run once, reverted). The PER-ROW
  // figures (project_get 214, world_list 255, and the seven-of-nine split) come off the same
  // scratch run one level down — `console.log(tool.name, Buffer.byteLength(tool.description ??
  // "", "utf8"))` inside the reduce — because a total cannot say which rows the headroom is
  // shorter than, and that comparison is the sentence above's whole argument.
  const proseBytes = advertised().reduce(
    (sum, tool) => sum + Buffer.byteLength(tool.description ?? "", "utf8"),
    0,
  );
  expect({ overBudget: proseBytes > 8192 }).toEqual({ overBudget: false });
  for (const tool of advertised()) {
    // snake_case and prefix-free — the SERVER is the namespace, and a client composes
    // `mcp__<its own config key>__<name>` on top of these.
    expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    expect(tool.description ?? "").not.toBe("");
    // THE PROTOCOL'S OWN RULE, and the reason `advertise()` hoists a `type` over the one row
    // that projects to a bare `oneOf`: the SDK types this as `z.literal("object")` on both
    // sides, so a union-rooted document would be rejected before any agent saw it.
    expect({ name: tool.name, type: tool.inputSchema["type"] }).toEqual({
      name: tool.name,
      type: "object",
    });
    // **NO `outputSchema`, on every row.** Declaring one has broken tool registration in the
    // client this door exists for, which is why the results are TEXT-first — a pin rather
    // than a comment, because "we did not add one" is exactly the kind of decision a later
    // convenience quietly reverses.
    expect(tool.outputSchema).toBeUndefined();
  }
});

test("the advertised documents say nothing this suite cannot read — and no tuple lies about its length", () => {
  // **THE COMPLETENESS CLAUSE, borrowed from `action-registry/projection-round-trip.test.ts`
  // and pointed at the door.** The advertisement is a PROJECTION of the schema `dispatch`
  // runs, so the two cannot drift by editing — but they CAN drift by zod reflecting a
  // construct lossily, which is not hypothetical: `z.tuple` projects `prefixItems` and no
  // length keyword, so before T4c Task 6 every vector on this wire was advertised as an
  // array of any length while `dispatch` demanded exactly three. Measured, not reasoned.
  //
  // So: inventory every keyword the nine documents use. A construct nobody has checked
  // reflects faithfully reds HERE, before an agent reads a document that under-states the
  // rule. Growing the list is the deliberate act of saying "I checked this one".
  const keywords = new Set<string>();
  let nodesWalked = 0;
  const tuplesWithoutLength: string[] = [];
  for (const tool of advertised()) {
    for (const node of nodesOf(tool.inputSchema)) {
      nodesWalked++;
      for (const keyword of Object.keys(node)) keywords.add(keyword);
      if (
        Array.isArray(node["prefixItems"]) &&
        (node["minItems"] !== node["prefixItems"].length ||
          node["maxItems"] !== node["prefixItems"].length)
      )
        tuplesWithoutLength.push(`${tool.name}: ${JSON.stringify(node)}`);
    }
  }
  // WHAT WAS WALKED, ASSERTED BEFORE WHAT WAS FOUND — an empty walk with an empty finding
  // list is a passing test that read nothing. A THRESHOLD rather than the exact count (120 at
  // head), deliberately: the number moves with every keyword the op vocabulary grows, and a
  // literal would red on a change it has no opinion about. What it has to catch is a walk that
  // stopped walking.
  expect({
    nodesWalked: nodesWalked > 100,
    tuplesWithoutLength,
    keywords: [...keywords].sort(),
  }).toEqual({
    nodesWalked: true,
    tuplesWithoutLength: [],
    keywords: [
      "additionalProperties",
      "const",
      "description",
      "enum",
      "exclusiveMinimum",
      "items",
      "maxItems",
      "maximum",
      "minItems",
      "minLength",
      "minimum",
      "oneOf",
      "prefixItems",
      "properties",
      "propertyNames",
      "required",
      "type",
    ],
  });
});

test("the action_run row names every id that takes an input", () => {
  // The one description in the table that restates another module's data. It is prose
  // because a per-id `oneOf` would be a lie for the 33 bare verbs (any `input` is legal for
  // them), and prose drifts — so the drift is closed here rather than accepted: a seventh
  // row in `ACTION_INPUT_SCHEMAS` that nobody mentioned reds.
  const row = advertised().find((x) => x.name === "action_run");
  const named = Object.keys(ACTION_INPUT_SCHEMAS).filter(
    (id) => !(row?.description ?? "").includes(id),
  );
  expect({ rows: Object.keys(ACTION_INPUT_SCHEMAS).length, named }).toEqual({
    rows: 6,
    named: [],
  });
  // AND IT DOES NOT NAME `session.escape`, which is the T4c Task 5 disposition made
  // machine-checkable. Both spellings reach `FieldHost.escape`, they are NOT equivalent
  // (the registry verb answers ok whether or not anything was cancelled; `session_interrupt`
  // reads the boolean and refuses), and pointing an agent at the one that cannot report a
  // no-op would undo the verb this tranche built.
  expect(row?.description ?? "").not.toContain("session.escape");
});

test("one client makes many calls on one connection — the per-POST transport holds", () => {
  // THE MEASURED FAILURE THIS PINS: a stateless transport reused across requests throws
  // inside the SDK's own request listener in 1.30.0, and the client sees a bare 500 with an
  // EMPTY BODY. It arrives on the SECOND request, never the first, so a suite that connected
  // and asserted one call would be green over a door that works exactly once.
  expect(t.repeat.first.isError).toBe(false);
  expect(t.repeat.second).toEqual(t.repeat.first);
  expect(t.repeat.listedTwice).toBe(9);
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

// --- Advertisement equals validation ------------------------------------------

test("every bound the document states is a bound dispatch enforces", () => {
  // **THE PIN THIS TASK EXISTS FOR, taken through the real protocol with no editor open.**
  // `dispatch` parses before it runs, so a value the advertised document forbids earns
  // `invalid-input` regardless of any session — which makes each of these a statement about
  // the SCHEMA and nothing else. Sabotage: drop the `.meta({minItems, maxItems})` from
  // `point3` and the two-number case still reds nowhere HERE (dispatch never admitted it);
  // it reds in the tuple-length case above, which is why both exist.
  const labels = Object.keys(t.boundRefusals);
  const admitted = labels.filter((l) => !t.boundRefusals[l]?.isError);
  const wrongCode = labels.filter(
    (l) => !(t.boundRefusals[l]?.text ?? "").includes("invalid-input"),
  );
  expect({ probes: labels.length, admitted, wrongCode }).toEqual({
    probes: 12,
    admitted: [],
    wrongCode: [],
  });
  // **THE TWO THAT ARE NOT SCHEMA KEYWORDS**, each carrying its rule as prose, because
  // prose is what an agent has instead of a bound it could have read. The count is the point
  // as much as the cases: the door has exactly two looser-than-validation points and the
  // probe's docblock enumerates them, so a THIRD arriving unlisted is the thing to catch.
  //
  // IT WAS THREE UNTIL THE UNDO-ATTRIBUTION SLICE, and the third — a FENCED ACTION ID —
  // went away with the rule rather than with the pin: `FENCED_ACTIONS` refused
  // `edit.undo`/`edit.redo` for every agent at the daemon, and undo ownership is a guard
  // inside the tab's run now. The id's new behaviour at this door has its own case below.
  expect(
    t.boundRefusals["a zero direction — the ONE bound no JSON Schema can state"]
      ?.text,
  ).toContain("zero vector");
  // The stray key on an action row — the `z.object` → `z.strictObject` change, at the WIRE.
  // Before it, this call answered ok having silently discarded `nope`. The message names the
  // key, which is what makes the refusal actionable rather than merely correct.
  expect(
    t.boundRefusals[
      "a stray key on an action row's input — stripped before T4c, refused now"
    ]?.text,
  ).toContain("nope");
  // …AND THE ZERO-VECTOR RULE IS ADVERTISED AS WELL AS ENFORCED, which is the other half and
  // the one a refusal cannot supply: an agent that has to send a bad ray to learn the rule
  // has already spent the round trip. `.describe()` on `direction3` is where it rides, and
  // this asserts it survived into the document rather than only into the error.
  const rayArm = advertised()
    .filter((x) => x.name === "session_query")
    .flatMap((x) => nodesOf(x.inputSchema))
    .filter((n) => typeof n["description"] === "string")
    .map((n) => n["description"]);
  expect(rayArm.filter((d) => String(d).includes("zero vector"))).toHaveLength(
    1,
  );
});

test("session_query advertises SIX arms, projected from the union dispatch runs", () => {
  // **THE ARM T5 ADDED IS ADVERTISED WITHOUT ANYBODY WRITING A SCHEMA, which is the whole
  // reason the generator catalogue rode this verb instead of a tenth tool.** The document is a
  // PROJECTION of `spatialQuery`, so an arm added to that union appears here or the projection
  // is broken. Read off the `oneOf` rather than out of the prose: the prose is what a human
  // wrote and the `oneOf` is what a client renders a picker from.
  //
  // **AND IT COLLECTED A SECOND TIME (cycle 2's `flags`)**, which is the case this pin was
  // kept for: the arm cost one zod literal and appeared in the advertised document with no
  // schema written for it, and this list is where a human had to agree it should.
  const row = advertised().find((x) => x.name === "session_query");
  const arms = (row?.inputSchema["oneOf"] ?? []) as Record<string, unknown>[];
  const about = arms.map((arm) => {
    const properties = arm["properties"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    return properties?.["about"]?.["const"];
  });
  expect(about).toEqual([
    "entities",
    "entity",
    "generators",
    "ray",
    "selection",
    "flags",
  ]);
  // …and the ONE member the two new arms add between them is `entityId`, REQUIRED, which is
  // what makes "list, then ask about one" a call an agent can compose from the document alone.
  const entityArm = arms[1];
  expect({
    required: entityArm?.["required"],
    type: (
      entityArm?.["properties"] as Record<string, Record<string, unknown>>
    )?.["entityId"]?.["type"],
  }).toEqual({ required: ["about", "entityId"], type: "integer" });
});

test("the generate row points at the catalogue rather than calling it unreadable", () => {
  // **A SENTENCE THAT WENT FALSE IN THE COMMIT THAT FALSIFIED IT (T5).** The row used to end
  // its params advice with *"because the defaults are not currently readable through any
  // tool"* — true when it was written, and an instruction to an agent to stop trying the
  // moment `session_query {about:"generators"}` shipped. Pinned in both directions, because a
  // stale sentence that tells a reader NOT to look is acted on rather than read past.
  const row = (
    advertised().find((x) => x.name === "generate")?.description ?? ""
  ).replace(/\s+/g, " ");
  expect(row).toContain("about=");
  expect(row).toContain("generators");
  expect(row).not.toContain("not currently readable");
});

test("the four prose hand-offs the earlier tasks named are in the rows that owe them", () => {
  // **THE MIGRATION-MARKER DEBT, AS ASSERTIONS.** Three markers plus one
  // docblock hand-off named four sentences the door owed an agent, each because a reader
  // without it makes a specific mistake that has already been observed or reasoned out.
  // (The marker string itself is deliberately not spelled here: the convention's grep must
  // surface real debts, and a test quoting it would be a permanent false positive.) They
  // are pinned by NEEDLE rather than by whole text so the prose can be rewritten, and by
  // needles that carry the RULE rather than a keyword, because a keyword survives a rewrite
  // that drops the meaning.
  const row = (name: string): string =>
    (advertised().find((x) => x.name === name)?.description ?? "").replace(
      /\s+/g,
      " ",
    );
  expect({
    // (1) The armedness rule — the misreading measured live at the T4b gate walk.
    armedness: row("session_state").includes(
      "is NOT a claim that anything is armed",
    ),
    // (2) The contact rule, from `field-query.ts`'s `Query.answer`: the probe's origin, its
    // tolerance, and the deliberate asymmetry. "Ask this, don't squint" is worth nothing to
    // an agent that cannot read what contact MEANS.
    contactProbe: row("session_query").includes(
      "straight down from the centre of its proxy box's BASE",
    ),
    contactTolerance: row("session_query").includes("within one cell size"),
    entitiesNotProbed: row("session_query").includes(
      "Entities are deliberately NOT contact-probed",
    ),
    // (3) `session_interrupt`'s limit: one thing, and no long job can be stopped. Without it
    // an agent reaches for this to cancel a bake and is silently disappointed.
    //
    // ASSERTED AS THE PROPERTY, NOT AS THE WORD "rung", which this pin matched until T4c
    // Task 7. "Rung" is `input-router.ts`'s vocabulary for a capture-stack entry — precise
    // for us and undecodable for the reader this row is written for, who has never seen the
    // stack. The row says "exactly ONE thing" now and the pin follows the meaning.
    interruptOneThing: row("session_interrupt").includes("exactly ONE thing"),
    // AND THE ORDER, which is the half that was WRONG rather than merely jargon. The row
    // used to advertise a fixed ladder ("a session, then an armed stamp, then…"); the
    // mechanism is `stack.pop()` — RECENCY — and §20.2 records three reachable cases where
    // the two disagree. An agent that trusted the ladder would predict the wrong cancel.
    interruptRecency: row("session_interrupt").includes(
      "The order is RECENCY, not that list",
    ),
    interruptCannotAbort:
      row("session_interrupt").includes("cannot stop a bake"),
    // (4) The undo OWNERSHIP rule, said where an agent would otherwise discover it by being
    // refused. It read "refused for every agent" until the undo-attribution slice, when the
    // daemon's `FENCED_ACTIONS` deny-list was replaced by a guard the tab applies against
    // the top entry's `origin` — so the row had to stop saying "never" and start saying
    // "only your own", which is a different instruction rather than a softer one.
    undoOwnOnly: row("action_run").includes(
      "edit.undo and edit.redo step only YOUR OWN work",
    ),
    // AND THE ONE ENTRY THE RULE MAKES UNREACHABLE, because an agent told "you may step your
    // own work" will otherwise try to step a confirm it triggered and read a refusal it
    // cannot explain: a stamp session is staged by the HUMAN (region, params) and merely
    // triggered by whoever confirms it, so the commit is deliberately left unattributed.
    confirmUnattributed: row("action_run").includes("session.confirm"),
  }).toEqual({
    armedness: true,
    contactProbe: true,
    contactTolerance: true,
    entitiesNotProbed: true,
    interruptOneThing: true,
    interruptRecency: true,
    interruptCannotAbort: true,
    undoOwnOnly: true,
    confirmUnattributed: true,
  });
});

test("a WELL-FORMED batch is refused by the SESSION, not by the schema", () => {
  // THE VACUITY GUARD for the case above. Against a door that refused every argument it was
  // handed, all twelve bound probes would pass and pin nothing; this is the same row and the
  // same shape with legal values, and it has to get PAST the schema to reach the missing
  // session. `no-session` here is therefore the positive control.
  expect(t.wellFormedBatch.isError).toBe(true);
  expect(t.wellFormedBatch.text).toContain("no-session");
  expect(t.wellFormedBatch.text).not.toContain("invalid-input");
});

test("edit.undo is no longer FENCED at the door — it reaches the session like any verb", () => {
  // **THE FENCE LIFT, AT THE WIRE.** `session-handlers.ts` held a `FENCED_ACTIONS`
  // deny-list that refused `edit.undo`/`edit.redo` for every agent with `invalid-input` and
  // a sentence about missing op attribution. Ops carry `origin` since core's oplog v4, so
  // the rule moved into the tab's own run as a state-dependent OWNERSHIP guard: an agent
  // steps only an entry it authored, and the human's entries are never popped.
  //
  // WHAT THIS CASE CAN AND CANNOT SEE. It runs with no editor open, so it pins the DOOR:
  // the id is admitted, relayed, and refused by the missing session exactly as
  // `wellFormedBatch` above is. The guard's own matrix — agent over its own entry, agent
  // over the human's, the human's un-guarded asymmetry, and redo — is unit-tested against
  // the real registry in `tests/actions.test.ts`, because this harness's claimed sessions
  // are answered by a fake chrome that would only echo a refusal the probe itself wrote.
  expect(t.undoReachesTheSession.isError).toBe(true);
  expect(t.undoReachesTheSession.text).toContain("no-session");
  // NOT the schema, and NOT the old fence. Both halves are named: `invalid-input` is what
  // the deny-list answered with, and the sentence is what an agent would have read.
  expect(t.undoReachesTheSession.text).not.toContain("invalid-input");
  expect(t.undoReachesTheSession.text).not.toContain("op attribution");
});

test("viewport_capture hands over an IMAGE block, and the base64 appears exactly once", () => {
  // **THE DECODE `shared/wire.ts` ASSIGNED TO THIS DOOR.** The chrome base64s the PNG because
  // a `SessionAnswer` is JSON and JSON has no bytes; left as text the agent would receive a
  // megabyte of base64 in its context window and no `isError` assertion would ever notice.
  // So the shape is pinned, not just the success.
  expect(t.capture.isError).toBe(false);
  expect(
    t.capture.blocks.map((b) => ({ type: b.type, mimeType: b.mimeType })),
  ).toEqual([
    { type: "image", mimeType: "image/png" },
    { type: "text", mimeType: undefined },
  ]);
  // The string the fake chrome answered with, handed over UNCHANGED — not re-encoded, not
  // truncated, not wrapped.
  expect(t.capture.imageData).toBe(t.capture.posted);
  // …and the measurements beside it, with the PNG lifted OUT. `toEqual` and not a subset
  // check: a `png` key surviving into the text block would double the cost of every capture
  // while every other assertion here stayed green, and this is the assertion that sees it.
  expect(t.capture.measured).toEqual({ width: 256, height: 144, view: "+y" });
  // The base64 is carried ONCE, at full length, in the block built to hold it.
  expect(t.capture.blocks[0]?.length).toBe(t.capture.posted.length);
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
