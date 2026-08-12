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
import { z } from "zod";
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
 * **SIX THINGS AND NO MORE** (four until T4c gave the door hands), each chosen because an
 * agent that does not know it makes a specific mistake. (1) That the live half is RELAYED to
 * a browser tab — without it, a `no-session` refusal reads as a broken server rather than as
 * "nobody is editing". (2) The claim model — without it, an agent asked to watch two tabs has
 * no idea why the answer is a refusal, and cannot tell the human what to do; and since the
 * door writes, the guest clause now also says whose world is being changed — **and what the
 * human can see of it, which this blurb got WRONG for the length of one tranche.** It said
 * *"neither your verbs nor your refusals are shown to them"*; Task 5 had already built the
 * presence chip (`frontend/lib/agent-presence.ts`, recorded from `useSessionAnswer` on every
 * relayed method and rendered by `StatusBar`), so the verbs half was false the moment it was
 * written. Only the REFUSALS half was ever true, and it is true by TYPE rather than by care —
 * `presence.ran` takes no result, so an applied `edit_apply` and a refused one are the same
 * record. Corrected at T4c Task 7 and pinned both ways in `tests/mcp.test.ts`, because a
 * sentence about what the human sees is one an agent uses to decide how much to explain
 * itself. (3) That the
 * cursor is compare-only — without it, an agent caches a payload against a token that
 * certifies one member of it. (4) That `{ready:false}` is a real answer — `shared/wire.ts`
 * declares the arm and this door really returns it, so an agent that read only the others
 * would meet a payload carrying NONE of the fields promised one line up and have no reason to
 * expect it. (5) **The armedness rule**, because the composite it replaces was misread LIVE by
 * an agent at the T4b gate walk and the agent-facing prose is where that misreading came from
 * (`shared/wire.ts`'s `ArmedState` carries the incident). (6) **That a batch is one undo
 * step**, which is the human's ⌘Z: an agent that sends one op per call fills their history
 * with steps nobody drew, and no refusal will ever tell it so.
 *
 * **THE READS-ONLY CLOSING LINE IS GONE, and its death is the point of the rewrite.** *"THIS
 * SERVER READS. Nothing here edits a world"* stopped being true when Task 3 built
 * `edit.apply`, `generate` and `action.run`; they were merely unadvertised, which is not the
 * same as absent. A discovery blurb that tells an agent not to look for a write verb, on a
 * door that has three, is the worst kind of stale — it is acted on rather than merely read.
 *
 * The tool descriptions carry everything else, where they are read next to the call.
 */
export const MCP_INSTRUCTIONS = `The furnace editor daemon — READ AND WRITE access to one live world-editing session.

Furnace is a WebGPU engine. Its editor is a browser tab where a human digs, fills, paints and
smooths a 3-D density FIELD into a world, and stamps generated pieces into it. This daemon
serves that tab; world_list and project_get it answers from disk with no editor open, and
every other tool is a question or an instruction it relays to that tab and waits on.

THE CLAIM MODEL. A tab claims the world it is authoring over its own live connection, and
exactly one claimed tab can be spoken for. You are a GUEST of that claim — you never hold one
and cannot take one — so with no tab claimed, or several, the relayed tools refuse instead of
guessing which human you are watching. You work beside that person: your edits land in their
world, and their status bar names the verb you just ran — never its outcome, never a refusal.

WRITING. edit_apply takes a BATCH of ops and lands the whole batch as ONE undo step, so send
one intent per call, never one op per call — their ⌘Z has to stay usable. generate commits a
whole generator; action_run presses the editor's own buttons by id.

READING. Call session_state before answering anything about what the human is doing. A tab
still loading answers {ready:false} and nothing else, so branch on ready first. Its \`armed\` is
what LMB does RIGHT NOW; \`brush\` is a standing SETTING and is NOT a claim that anything is
armed. Its \`cursor\` is an opaque change token: HOLD IT AND COMPARE IT, NEVER PARSE IT — an
unchanged cursor means no edit landed, and it certifies the history and nothing else.

MEASURE BEFORE YOU LOOK. session_query answers geometry exactly — where a ray hits, which
placed props float or overlap, what is selected. viewport_capture photographs the viewport
from the human's camera or one of six axis views, without moving theirs; it is for judging how
something LOOKS, never for deciding where something IS.`;

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

/** One projected tool: what an agent calls, what it dispatches to, and what it is for. */
type ToolRow = {
  /** `snake_case`, prefix-free — see {@link SERVER_INFO}. */
  readonly tool: string;
  /** The daemon command in `handlers.ts`' registry. */
  readonly command: string;
  readonly description: string;
  /**
   * `true` when calling this changes NOTHING — no world, no file, no interaction state.
   *
   * It becomes the protocol's `readOnlyHint`, which is a HINT by specification: a statement
   * of intent to a client rather than a guarantee to lean on. What makes it honest here is
   * that it is a property of the ROW rather than of the door — until T4c every row was a
   * read and the annotation was hard-coded `true` for all of them, which is exactly the
   * shape that would have gone on claiming read-only over the four writes this task
   * advertises.
   *
   * A WRITING ROW CARRIES NO ANNOTATION AT ALL rather than `readOnlyHint: false`. The
   * specification's default for an absent hint is already "not read-only", so the explicit
   * `false` would add a second spelling of one fact, and `destructiveHint`'s own default
   * (true, once a tool is not read-only) is the conservative reading we want a client to
   * take.
   */
  readonly reads: boolean;
  /**
   * How this row's answer becomes MCP content, when JSON-as-text is the wrong container.
   *
   * ONE ROW HAS ONE, and it is the reason this member exists rather than a `switch`:
   * `viewport_capture` answers a base64 PNG, which `shared/wire.ts` says in as many words is
   * the encoding *"for the one hop in between"* — the chrome encodes because a
   * `SessionAnswer` is JSON and JSON has no bytes, and **this door decodes into an
   * image block**. Left as text it would be a megabyte of base64 in a model's context
   * window: not merely inelegant, but the single most expensive mistake this door could
   * make per call, and invisible in a test that only checks `isError`.
   */
  readonly present?: (answer: unknown) => CallToolResult["content"];
};

/** A JSON object, as a narrowing rather than a cast.
 *
 *  **THE SAME SHAPE AS, NOT SHARED WITH,** the copies in `tests/mcp.test.ts` and
 *  `tests/action-registry/projection-round-trip.test.ts` — three of them, which is the repo's
 *  own extraction threshold, and the extraction is declined on purpose. This is a two-line
 *  DEFINITION of "JSON object", fixed by JSON itself: there is no version of it that can
 *  drift, so a shared home would buy nothing a copy loses. What it would cost is the daemon's
 *  first neutral-floor utility module — reachable from `src/daemon/` and two test directories
 *  — and a magnet for the next one-liner. If a third KIND of reader ever needs it, or the
 *  predicate ever grows a decision, that is the trigger to extract. */
const isJsonObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Whatever a command answered, as pretty JSON in ONE text block — every row's default.
 *
 *  `?? "null"` because `JSON.stringify(undefined)` returns the VALUE `undefined`; see
 *  {@link toolAnswer}, which owns that argument. */
const textContent = (answer: unknown): CallToolResult["content"] => [
  { type: "text", text: JSON.stringify(answer, null, 2) ?? "null" },
];

/**
 * `viewport.capture`'s answer as an IMAGE block plus the numbers beside it.
 *
 * **THE DECODE `shared/wire.ts` PROMISED THIS DOOR WOULD DO.** `ViewportCaptureResult.png`
 * is base64 *"for the one hop in between"* — the chrome encodes because a
 * `SessionAnswer` is JSON and JSON has no bytes — and an agent's client wants an
 * `image` content block, which carries base64 natively. Handed back as text instead, a
 * 1024-px screenshot is roughly a megabyte of base64 dropped into a model's context for
 * nothing, and no assertion about `isError` would ever notice.
 *
 * `png` IS DESTRUCTURED OUT AND EVERYTHING ELSE RIDES THE TEXT BLOCK, rather than the three
 * known members being named: `width`, `height` and `view` are what the answer carries today
 * and a later member should not have to be added here to be seen. The one thing this must
 * guarantee is that the base64 does not appear twice, which a rest-spread guarantees by
 * construction.
 *
 * A NON-CONFORMING ANSWER FALLS BACK TO TEXT rather than throwing. The daemon relays whatever
 * the tab said and has no standing to police it (`daemon/session-handlers.ts` argues that for
 * every relayed payload); a chrome of another vintage answering some other shape should reach
 * the agent as itself, not as a broken tool.
 *
 * THE ONE THING IT CANNOT COVER, stated rather than left to be met: a `png` that is a string
 * but not VALID base64 fails the SDK's own result validation (`-32602 Invalid Base64 string`,
 * measured at 1.30.0), so the agent is told the tool is broken. Nothing here can tell the two
 * apart short of decoding a megabyte per call, and the answerer encodes a `Uint8Array`, so
 * the only way to reach it is a chrome that invented the field.
 */
const captureContent = (answer: unknown): CallToolResult["content"] => {
  if (!isJsonObject(answer) || typeof answer["png"] !== "string")
    return textContent(answer);
  const { png, ...measured } = answer;
  return [
    { type: "image", data: png, mimeType: "image/png" },
    { type: "text", text: JSON.stringify(measured, null, 2) },
  ];
};

/**
 * The nine tools, and **why exactly nine** (foundations T4c Task 6 — three until T4b).
 *
 * EVERY ROW IS A DAEMON COMMAND, dispatched through the same `dispatch()` every other client
 * funnels through. That is the whole of the mapping: this table adds a name an agent can
 * search for, a sentence saying when to call it, and — since this task — nothing else at
 * all, because the argument document is PROJECTED from the command's own schema rather than
 * written here (see {@link advertise}). A tool that computed anything would be a second
 * author on an answer the registry already owns, and the claim "every client funnels through
 * one validator" (`handlers.ts`) would stop being literal at the exact edge where the caller
 * is least trusted.
 *
 * **THE CEILING IS TEN AND THE SET IS NINE, which is a budget rather than a coincidence.** A
 * model picks a tool by reading names and first sentences, and every row it must consider is
 * paid for on every turn; the tranche sized the door at ten and spent nine, which is why
 * `session.query` is ONE parameterized read rather than six (`shared/wire.ts` argues that
 * trade at the type; T5 grew it from three arms to five and cycle 2 to six, neither touching
 * this table — the rows-not-spent figure tracks the ARM count, so it moves with them). The
 * remaining slot is deliberately unspent — the next verb that wants it has to be worth more
 * than the room it takes.
 *
 * **AND THE ROW COUNT IS THE SMALLER HALF OF THAT BUDGET, so the prose is capped too.** These
 * nine descriptions are 7,865 bytes on the wire — nearly four times
 * {@link MCP_INSTRUCTIONS}'s pinned 2 KB, riding the same `tools/list` — so capping the
 * discovery blurb and not the rows would be budgeting the cheaper surface and calling it
 * discipline. `tests/mcp.test.ts` pins the total at 8,192. It was 6,004 bytes and 1.36× head
 * when this paragraph was written; the T4c review spent 1,078 of that slack on four rows that
 * described this door WRONGLY, T5 spent 420 more teaching `session_query` its two new arms
 * and pointing `generate` at the catalogue that now exists, and cycle 2 spent 363 on its
 * sixth arm (`flags`).
 *
 * **HEAD IS 1.042×, AND THE TENTH-ROW CLAIM THIS PARAGRAPH USED TO MAKE IS NOW FALSE** —
 * said plainly rather than quietly dropped, because it is the number a later task will
 * reason from. It read *"admits a tenth row at the median length (870)"*; 7,865 + 870 = 8,735
 * and that reds. What is left is 327 bytes, which is shorter than SEVEN of the nine rows —
 * only `project_get` (214) and `world_list` (255) would fit inside it, and both are verbs
 * with no arms to describe. So the
 * prose cap has become the binding constraint on a tenth tool BEFORE the ceiling of ten is —
 * a tenth verb must now either be describable in 327 bytes or arrive with a cut somewhere
 * else, and either way somebody has to decide rather than discover it. A TOTAL rather than a
 * per-row cap, because one row genuinely is a wall — `session_query` restates the contact rule
 * verbatim, which is the whole reason that rule reaches an agent — and a per-row limit would
 * forbid the one case that earned its length.
 *
 * THE PROJECTED SCHEMAS (~6.3 KB, mostly `edit_apply`'s op vocabulary) ride the same response
 * and are deliberately NOT capped: they are derived rather than authored, so their size is a
 * function of the engine's op union, and a ceiling there would be a ceiling on the vocabulary
 * wearing a budget's clothes. The cap belongs on the half a person writes.
 *
 * **`field.load` IS DELIBERATELY NOT PROJECTED.** It answers with a whole world — every
 * chunk and `.mat` sibling base64'd, plus the oplog — which is megabytes against a per-result
 * budget measured in tens of thousands of tokens. There is no honest way to hand that to an
 * agent as text, and a truncation would be a lie in the one direction this tranche exists to
 * close. **T4c answered the question that left open** — what a trimmed world read looks like
 * — with `session_query`: entity footprints, a prop lint and a ray, all bounded, none of them
 * the field itself. The whole-world read stays unprojected, now on evidence rather than on
 * a promise to think about it.
 *
 * **AND NEITHER IS ANY `session.*` CLAIM VERB, which is the guest clause in one line.**
 * `claim`, `steal` and `release` are not absent because they would be dangerous — they are
 * unspellable: all three take a connection token minted into an SSE stream, and this door
 * holds no stream (`events.ts`'s `subscribe` argues why that is structural rather than a
 * rule). `session.answer` is the chrome's return leg and names a pending ask, not a caller.
 * So an MCP client reads and WRITES THROUGH whichever session is claimed and can never become
 * one. (`session.interrupt` is projected and is not a counter-example: it takes no token and
 * addresses the claimed tab, exactly as `session.state` does.)
 *
 * **`edit.undo` AND `edit.redo` ARE UNREACHABLE, AND NOT BY OMISSION.** They are registry
 * action ids, so `action_run` would carry them; `session-handlers.ts`'s `FENCED_ACTIONS`
 * refuses both daemon-side, and the `action_run` row below says so out loud. Non-advertisement
 * is not enforcement — that is the distinction this tranche keeps making, and here it is made
 * in both directions at once.
 */
const TOOLS: readonly ToolRow[] = [
  {
    tool: "session_state",
    command: "session.state",
    reads: true,
    description:
      'Read the live editor session: which world is open and whether it has unsaved edits, what the human has selected, WHAT IS ARMED, where the camera points, and the undo/redo history with its labels. Relayed to the editor tab in the browser — the only fresh view of what the human is doing. Read `armed` for what the left mouse button does RIGHT NOW; `brush` beside it is the standing brush SETTING (effect, material, mask) and is NOT a claim that anything is armed — a tab reporting armed.does="selectEntity" with brush.effect="dig" has nothing armed to dig with. A tab whose engine is still loading answers {"ready": false} and NO other field, so branch on `ready` before reading anything else. `cursor` is an opaque change token: hold it and compare it, never parse it; unchanged means no edit landed, and it certifies the history and nothing else. Returns an actionable refusal when no editor tab is claimed, when several are, or when the tab does not answer within 10 seconds.',
  },
  {
    tool: "world_list",
    command: "world.list",
    reads: true,
    description:
      "List the worlds saved under the project's worlds/ directory, with the default world and a per-row git-tracked flag. Reads the disk, so it works with no editor open — and it does NOT say which world the human currently has loaded (that is session_state).",
  },
  {
    tool: "project_get",
    command: "project.get",
    reads: true,
    description:
      "The absolute filesystem path of the project this editor daemon is serving. Reads no world state and works with no editor open; use it to resolve the world names world_list reports against your own filesystem tools.",
  },
  {
    tool: "session_query",
    command: "session.query",
    reads: true,
    description:
      'MEASURE the world instead of looking at it. Six questions, picked with `about`. "entities": one row per committed generator entity — id, generator and footprint box — plus `entityTotal` and the placed-prop lint: how many props there are, which are FLOATING and which OVERLAP. Both lists are EXCEPTIONS, so empty means nothing is wrong — unless `truncated` is true, which means the scan stopped early and empty means "I did not look at all of it". "entity" {entityId}: ONE entity in full — its seed, the region it was committed over, whether it is frozen or baked, and what it placed; list first, then ask about one. An id no entity carries answers entity:null, not an error. "generators": the generator REGISTRY — every id with its param schema and defaults, which is how you tune `generate` instead of only calling it. "ray": one ray cast into the density field, answering where it hit or null. "selection": the human\'s cell selection as a replayable spec, its size and its box. "flags": the walkability advisor\'s findings — kind, severity, world position, an unreachable tag (ABSENT = the flood has not visited it, which is NOT the same as reachable) and any verified verdict. Candidate and pit rows only, capped with a truncated flag; info arrives as counts. pending>0 means the findings trail the latest edits — re-ask once it settles. CONTACT IS DEFINED, not eyeballed: a prop is in contact when a ray cast straight down from the centre of its proxy box\'s BASE finds a solid sample within one cell size (0.25 m in this editor, and the answer states the gap in metres so you never have to assume it) — so a prop buried in the floor reports contact with gap 0, and a `gap` of null means nothing was found beneath it within the probe\'s reach at all. Entities are deliberately NOT contact-probed: a carver\'s footprint is the AIR it removed, so a downward probe from its base always hits the floor it just made and the question has no meaning for it. Prefer this over viewport_capture for anything positional.',
  },
  {
    tool: "viewport_capture",
    command: "viewport.capture",
    reads: true,
    present: captureContent,
    description:
      'Photograph the live viewport and hand it back as an image. `view` is the human\'s own camera ("user", the default) or one of six axis snaps ("+x" … "-z"), which reuse their pivot and view distance and move only the two angles — it NEVER moves the human\'s camera. `size` is the longest edge in pixels (default 1024; the answer reports the pixels actually produced, so a non-square viewport comes back shorter on one axis). `overlays` draws the grid, selection outlines, gizmo and brush ghost, and defaults to true. This is for judging how something LOOKS; use session_query for where anything IS.',
  },
  {
    tool: "edit_apply",
    command: "edit.apply",
    reads: false,
    description:
      "CARVE. Apply a batch of field brush ops — dig, fill, paint or smooth, over a sphere, an axis-aligned box or a swept capsule — to the live world. The whole batch lands as ONE undo entry, so the human's ⌘Z reverses your entire intent and not a third of it: send one intent per call, never one op per call, or you fill their history with steps nobody drew. Every op is VALIDATED before any of them lands, and a rejected batch is refused naming the index that failed with nothing written. That covers validation only: an op that passes validation and then fails while being applied answers `failed`, not a refusal, and the ops before it ARE written — read that message, do not retry it. This is also refused outright while the human has a stamp session open, because their preview was computed against the cells you would change; wait, or call session_interrupt. There is no agent undo verb; to reverse something you just did, apply the inverse ops explicitly.",
  },
  {
    tool: "generate",
    command: "generate",
    reads: false,
    description:
      "MAKE. Commit one registry generator (a hall, a maze, a cave, a scatter) into the live world in a single act — no stamp session is opened and none is left standing, so the step after this one is not blocked. `params` are overlaid onto the generator's OWN defaults, so naming one keeps the rest and omitting them entirely is a complete call. To name any param, read the schemas first: session_query with about=\"generators\" returns every generator's params, ranges and defaults. A wrong `generatorId` IS refused, with the list of real ones. A bad param is NOT: the generator runs arbitrary code, so a param it rejects, a defect in the generator itself and an invalid op it emitted all arrive the same way and all answer `failed` with the generator's own sentence — read it rather than assuming your params were wrong. `region` is world metres and defaults to the human's current cell selection; with neither, it refuses rather than guessing where to build. Like edit_apply, it is refused while the human has a stamp session open. Answers the new entity's id, the seed actually used and the region committed, so the result is reproducible by a caller that named no seed.",
  },
  {
    tool: "action_run",
    command: "action.run",
    reads: false,
    description:
      "PRESS one of the editor's own buttons, by id — the same verbs the human's menus and keys dispatch: world.save, world.bake, view.frame, and around thirty more. Most take no `input`. The six that do are world.saveAs {name}, world.makeDefault {name}, edit.duplicate {entityId}, edit.delete {entityId}, edit.grab {entityId} and tool.stamp {generatorId}; each requires exactly its own fields, and an undeclared key is refused rather than ignored. Omitting `input` is always legal and means \"act on whatever the human has selected\". An id that does not exist is refused WITH the list of ids that do. edit.undo and edit.redo are refused for every agent: the log carries no per-op attribution yet, so stepping it would discard whatever is on top — routinely the human's own stroke, not yours.",
  },
  {
    tool: "session_interrupt",
    command: "session.interrupt",
    reads: false,
    description:
      "Press Escape once, on the human's behalf. It cancels exactly ONE thing: the MOST RECENTLY STARTED of the states standing right now — a live stamp/reconfigure session, a move being dragged, an armed stamp, a half-drawn box anchor, a half-drawn segment anchor, the selected entity, the cell selection. The order is RECENCY, not that list: the list is what can be standing, never what goes first, so a selection drawn after an entity was picked is cancelled before that entity. Read session_state's `armed` to see what is on top, and call this more than once to unwind more than one. With nothing standing it REFUSES rather than answering ok, so you can tell a cancel from a no-op. It cannot stop a bake, a save, a remesh or an analyzer pass — nothing in this editor is abortable, and the honest answer for a long job is this daemon's own timeout rather than this tool.",
  },
];

/**
 * One row's advertised `inputSchema`: **the command's OWN zod schema, projected.**
 *
 * **ADVERTISEMENT EQUALS VALIDATION, structurally rather than by agreement.** Until T4c every
 * row advertised a hand-written empty document while `dispatch` enforced a real schema, which
 * worked only because all three commands took nothing. Nine rows with five argument shapes
 * cannot be kept in step that way: a hand-written document is a SECOND spelling of a contract,
 * and `tests/action-registry/projection-round-trip.test.ts` exists because two spellings drift.
 * So this reads the schema out of the registry `dispatch` will use and reflects it. There is
 * one object; the agent reads one projection of it and the door enforces the other.
 *
 * **`z.toJSONSchema` DIRECTLY, NOT `@furnace/core/registry`'s `toJsonSchema`, and the reason
 * is a signature rather than a preference.** Core's wrapper is these same two lines behind a
 * `ZodObject`-typed parameter, and `session.query`'s input is a discriminated UNION — so it
 * cannot be passed without either widening a core export or reaching into zod's arm list.
 * Keeping the projection here also keeps this module free of a core value-import, which is
 * `op-schema.ts`'s stance one door over and costs a two-line re-spelling of `delete
 * out["$schema"]`.
 *
 * **THE ROOT MUST SAY `type: "object"`, and that is the protocol's rule rather than ours.**
 * The SDK types `Tool.inputSchema` as `z.object({type: z.literal("object"), …}).catchall(…)`
 * (checked at `@modelcontextprotocol/sdk@1.30.0`'s `types.js`), so a document zod reflects as
 * a bare `oneOf` — which is what a discriminated union projects to — would be rejected by the
 * SDK on both sides. Hoisting `type: "object"` over a `oneOf` whose every arm is itself an
 * object is not a widening: it restates what all the arms already say, and the `catchall`
 * carries the `oneOf` through untouched.
 *
 * @throws Error - SETUP-LOUD, at door construction, on a projection this door cannot honestly
 * advertise: anything that is neither an object nor a union of objects. It is thrown rather
 * than papered over because the alternative — advertising `{type: "object"}` over a schema
 * that is not one — is precisely the lie the projection exists to make impossible.
 */
const advertise = (command: string, schema: z.ZodType): Tool["inputSchema"] => {
  // Boundary cast: `z.toJSONSchema` returns a wide JSON-serialisable type, exactly as core's
  // own `toJsonSchema` wrapper casts it. `$schema` is dialect metadata, not shape.
  const doc = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  delete doc["$schema"];
  const arms = doc["oneOf"];
  const isUnionOfObjects =
    Array.isArray(arms) &&
    arms.length > 0 &&
    arms.every((arm) => isJsonObject(arm) && arm["type"] === "object");
  if (doc["type"] !== "object" && !isUnionOfObjects) {
    throw new Error(
      `mcp: "${command}" projects to a document this door cannot advertise (no object root, no union of objects): ${JSON.stringify(doc)}`,
    );
  }
  // Boundary cast: the guard above proved the one property the SDK's type demands; every
  // other keyword rides its `catchall(z.unknown())`.
  return { ...doc, type: "object" } as Tool["inputSchema"];
};

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
 * **FOUR ROWS ARE REACHABLE, AND THE PREDICTION THAT T4c WOULD MAKE IT EIGHT WAS WRONG.**
 * This paragraph used to end *"T4c will project verbs that reach four of them"*. The tranche
 * tripled the table — nine rows, five of them taking arguments, four of them writing — and
 * the reachable set did not move: it is still `no-session` and `session-timeout` (the
 * backchannel's own refusals, and the reason this table exists), `internal` (a chrome that
 * answered "I could not do that", and a genuine daemon fault alike) and `invalid-input`
 * (every schema refusal, plus `action.run`'s fence). Re-derived at T4c Task 6 by reading what
 * each of the nine commands can throw rather than by re-reasoning from the old sentence.
 *
 * WHY THE OTHER SIX STILL CANNOT ARRIVE, one clause each, because "we predicted wrong" is only
 * useful with the corrected model beside it:
 *
 *  - `not-found`, `outside-root`, `already-exists` — thrown by the world/bake/claim commands,
 *    none of which is projected. **The near-miss is `action_run`**, which really can reach
 *    `world.makeDefault` — but through the CHROME, whose own HTTP client makes that call and
 *    whose answer arrives here as a relayed `ActionResult` payload. A code thrown one bundle
 *    away is not a throw at this edge.
 *  - `invalid-json` — thrown parsing an HTTP request body, a boundary the MCP transport reads
 *    for itself and this door never crosses.
 *  - `unknown-command` — now structurally unreachable rather than merely unlikely:
 *    {@link createMcpDoor} RESOLVES every row's command against the registry when the door is
 *    built, so a table that named a command the registry lacks fails at startup. A tool call
 *    cannot be in flight to discover it.
 *  - `forbidden-origin` — refused ahead of the route branch entirely, so no tool call is
 *    running when it is thrown.
 *
 * They are written anyway because the union is CLOSED — an eleventh code is a compile error
 * until this edge says what to do about it — and because a row that says "this cannot happen"
 * would be worthless the first time it did.
 *
 * NOT A LOCATOR RE-THROW, and the standing trigger was checked rather than assumed. The
 * `core-internal-structure-debt.md` §"One locator re-throw, spelled six times"
 * entry fires on a seventh
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

/** The success half: whatever the command answered, in whatever container the ROW says.
 *
 *  TEXT UNLESS THE ROW OVERRIDES IT, which exactly one does ({@link ToolRow.present}), and
 *  no `outputSchema` on any of them: a declared output schema has broken tool registration
 *  in the client this door is built for, and a `structuredContent` beside the text without
 *  one buys nothing an agent can use.
 *
 *  PRETTY-PRINTED, BECAUSE EVERY TEXT PAYLOAD IS BOUNDED — and that is a claim per row rather
 *  than the "these three are small by construction" this said while three rows existed. Eight
 *  answers are records of a handful of fields, a bounded `ActionResult`, or a query answer
 *  whose only unbounded lists carry a measured cap and a `truncated` flag
 *  (`field-host/field-query.ts`'s `MAX_QUERY_PROPS`). The NINTH is not bounded and is not text:
 *  `viewport_capture` is a base64 PNG, which is why {@link captureContent} exists. The read
 *  that is neither (`field.load`) is the one {@link TOOLS} argues out.
 *
 *  **`?? "null"` IS THE SAME FIX `sendJson` MADE, AT THE SECOND EDGE, and it is reachable
 *  here for the same reason.** `session.state` relays whatever the chrome answered, and
 *  `session.answer` accepts a body with `payload` ABSENT — the canonical serialization of a
 *  handler that answered `undefined`. `JSON.stringify(undefined)` returns the VALUE
 *  `undefined`, which is not a string, so without the coalesce this block fails the SDK's own
 *  `CallToolResult` validation and the agent is told the TOOL is broken by a session that
 *  answered correctly. `null` rather than `{}` for `sendJson`'s reason: the ask really did
 *  resolve nothing, and JSON's spelling of nothing is `null`. */
function toolAnswer(row: ToolRow, answer: unknown): CallToolResult {
  return { content: (row.present ?? textContent)(answer) };
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
  // **BUILT ONCE, AT DOOR CONSTRUCTION, AND THAT IS LOAD-BEARING TWICE OVER.** It is not a
  // cache: `startServer` calls this exactly once, so resolving each row's command HERE makes
  // a table/registry disagreement a STARTUP failure rather than a tool result — which is what
  // {@link AGENT_REMEDY} leans on when it says `unknown-command` cannot arrive through this
  // edge. And the projection is real work (nine documents, one of them the whole brush-op
  // vocabulary) that would otherwise be redone on every `tools/list` of every POST.
  const advertised: Tool[] = TOOLS.map((row) => {
    const handler = handlers.get(row.command);
    if (handler === undefined) {
      throw new Error(
        `mcp: tool "${row.tool}" names daemon command "${row.command}", which this registry does not carry`,
      );
    }
    return {
      name: row.tool,
      description: row.description,
      inputSchema: advertise(row.command, handler.input),
      // The protocol's own word for the per-row fact {@link ToolRow.reads} carries. A writing
      // row gets NO annotations object at all — the specification's default for an absent
      // `readOnlyHint` is already "not read-only", and an explicit `false` would be a second
      // spelling of one fact.
      ...(row.reads ? { annotations: { readOnlyHint: true } } : {}),
    };
  });

  const listTools = (): { tools: Tool[] } => ({ tools: advertised });

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
      // decision that keeps `dispatch` the single validator at this edge too. Since T4c the
      // point is sharper than "no row takes arguments so nothing is lost": five rows DO, and
      // what each of them advertises is a projection of the very schema `dispatch` is about
      // to run ({@link advertise}). Composing the arguments here would put a second author
      // between the document an agent read and the check that decides. `?? {}` because the
      // protocol makes `arguments` optional and a missing bag is an empty one.
      return toolAnswer(row, await dispatch(handlers, row.command, args ?? {}));
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
