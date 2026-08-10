// packages/editor/src/shared/wire.ts

/**
 * The backchannel's two frames — and the **first contract in this editor that both sides
 * IMPORT rather than mirror by hand** (foundations T4b).
 *
 * WHAT THE BACKCHANNEL IS FOR, since the shape only reads as necessary once that is said:
 * the daemon cannot compute what an agent wants to know about a live editing session.
 * Every fact but the project root and the worlds on disk — selection, tool, gesture,
 * camera, stats, history — lives behind a mirror the CHROME holds, in the other bundle.
 * So an agent-facing read is a QUESTION the daemon relays to the claimed connection and an
 * ANSWER it correlates back: the daemon is a relay with a correlation table, never a
 * reader. These two types are that protocol, and they are the whole of it.
 *
 * WHY THE FOURTH BOUNDARY CONTRACT IS THE FIRST SHARED ONE. Three already cross this
 * boundary and each is a HAND-MIRROR: `WorldRow` (`daemon/worlds.ts` ↔ `frontend/lib/api.ts`),
 * `ServerEvent` (`daemon/events.ts`'s `DaemonEvent` ↔ `frontend/lib/events.ts`) and
 * `EVENT_TYPES` (mirrored against nothing but prose until this same commit gave it a
 * type-level pin). They stay hand-mirrored: retrofitting them is a mechanical change to
 * four files that buys nothing this tranche needs, and the two that matter are already
 * pinned by `tests/events.test.ts`. Filed with its trigger at
 * `docs/backlog/editor-and-tooling/wire-contracts-are-hand-mirrored.md`.
 *
 * This one is shared rather than mirrored because it is the one where a drift is INVISIBLE
 * in both directions at once: a request the chrome cannot parse produces no answer, which
 * the daemon reports as a timeout — a sentence about the session's speed for what is
 * actually a shape disagreement. The other three fail loudly (a missing world column
 * renders `undefined`) or are pinned.
 *
 * WHY `shared/` IS THE RIGHT FLOOR, and it is not merely the only directory both sides can
 * reach. The two leakage suites already scan it and hold it **React-free, engine-free and
 * zod-free** — the binding cases by name, since each suite's rules are declared far from the
 * walk that applies them to this directory: *"shared/ imports no React — the neutral floor
 * stays neutral"* (`tests/no-chrome-leakage.test.ts`) and *"shared/ carries no engine — the
 * neutral layer stays neutral"* (`tests/frontend-no-engine-leakage.test.ts`, whose
 * `FORBIDDEN` set is where the zod half rides in)
 * — which is exactly the property a daemon-facing module needs, from the other end: the
 * daemon is Node-portable (`AGENTS.md`'s shipping contract) and must never pull React or
 * the engine. Two rules written for opposite reasons meet on the same floor. This module
 * holds TYPES ONLY, so every import of it is erased and neither side takes a runtime edge
 * on the other at all.
 *
 * It is also `shared/`'s first DAEMON-facing member — the others (`catalog.ts`,
 * `field-brush.ts`, `action-table.ts`, `tool-registry.ts`, …) are chrome↔host. The layer
 * arrow `frontend/ → { field-host/, action-registry/ } → shared/` (editor-architecture §7)
 * is unchanged by that: the daemon is a fourth reader ABOVE the floor like every other, and
 * `shared/` still imports nothing above itself.
 *
 * IT HOLDS TYPES ONLY AND STILL DOES. Since T4c it has TWO imports, both `import type` and
 * both from siblings on this same floor, so this module still compiles to nothing and still
 * gives neither side a runtime edge. `CaptureView` comes from `./capture.ts`, which is a
 * VALUE module (it carries the array the daemon's schema and the MCP door enumerate) that
 * this file deliberately takes only the type off; `BrushOpInput` comes from
 * `./field-op.ts`, which is types-only like this one and is where the op vocabulary is
 * DERIVED from core's rather than restated.
 *
 * NEITHER IMPORT REACHES UPWARD, which is the property that actually matters and the one
 * this tranche tested: the two request types below relay shapes the daemon validates, and
 * their ANSWERS — `ActionResult` and `GenerateOutcome` — are deliberately NOT named here,
 * because both live in layers above this floor. {@link EditApplyRequest} carries that
 * argument.
 */
import type { CaptureView } from "./capture.ts";
import type { BrushOpInput } from "./field-op.ts";

/**
 * A question the daemon is relaying to the claimed editor session.
 *
 * `requestId` IS THE CAPABILITY, and that is why `session.answer` needs no connection
 * token while every other `session.*` command does. It is a `randomUUID` written INTO one
 * connection's SSE stream (`daemon/events.ts` argues the same structure for the token
 * itself), so holding one means holding that stream; it names exactly one pending ask; and
 * the daemon deletes it the instant an answer claims it, so it is one-shot. A token would
 * add a second name for a fact this string already carries.
 *
 * `method` is a name in the CHROME's answerer registry, which the daemon cannot enumerate
 * — the two live in different bundles and a tab can be older than the daemon serving it.
 * So an unrecognised method is a real state, not a defensive one, and it is answered
 * rather than ignored: see {@link SessionAnswer}'s error arm.
 *
 * `params` is `unknown` because this type is the ENVELOPE. Each method owns its own
 * argument shape, and putting a union of them here would make every new method a change to
 * the file both bundles import.
 */
export type SessionRequest = {
  requestId: string;
  method: string;
  params: unknown;
};

/**
 * What the claimed session says back — a discriminated union, because **the error arm is
 * what makes "a typed answer, never a hang" true for the half the daemon cannot police.**
 *
 * Without it, a method the chrome does not serve would simply produce no answer, and the
 * ask would sit until its timeout and then report a TIMEOUT: a claim about how fast the
 * session is, for what is actually "this tab does not know that word". An agent told the
 * first thing retries with a longer wait forever; told the second, it reloads the tab.
 *
 * `error` IS PROSE, NOT A CODE, and the split is deliberate: `EditorErrorCode` is the
 * daemon's wire contract (`daemon/errors.ts` — "the domain speaks codes; each transport
 * edge owns its own mapping"), and the chrome is not one of its throwers. Letting the
 * chrome mint codes would put a second author on a closed union it cannot even import.
 * So the chrome supplies the SENTENCE and the daemon decides the code — the same division
 * `daemon/claims.ts` already keeps, where the table answers in plain values and the handler
 * layer decides which contract code each answer earns.
 */
export type SessionAnswer =
  | { requestId: string; ok: true; payload: unknown }
  | { requestId: string; ok: false; error: string };

/**
 * What `viewport.capture` is ASKED — the parameters an agent may set on a photograph of the
 * live viewport (foundations T4c).
 *
 * **THE ONLY WIRE TYPE HERE THAT IS A STRUCTURAL MIRROR RATHER THAN A PROJECTION.** Every
 * field below has the same name, the same type and the same default as `CaptureRequest` in
 * `field-host/field-capture.ts`, which is where the meanings and the whole parameter-shape
 * argument live. That is deliberate and it is the OPPOSITE choice from
 * {@link SessionState}, which projects: a request has no engine types in it (three
 * primitives), it is the agent's own vocabulary rather than the host's, and nothing is
 * gained by renaming it on the way across. The spellings are kept identical, so a reader who
 * has seen one has seen both.
 *
 * **IT IS A CHOICE AND NOT A NECESSITY, which an earlier version of this paragraph got
 * wrong.** It said the host type "cannot be imported here — this file is held engine-free,
 * and `field-capture.ts` value-imports `@furnace/core` — so the duplication is forced". The
 * first clause is true and the conclusion does not follow: a duplication is forced only when
 * NEITHER direction is available, and the other one is. `field-host/` may import this floor
 * and already does (`field-capture.ts` ← `./capture.ts`), so declaring the request here and
 * having the host take it was open the whole time. {@link SessionQueryRequest} (T4c Task 4)
 * is that shape and argues it. This pair stays mirrored because retrofitting it is a change
 * to a shipped contract with no defect behind it, not because it had to be — and saying which
 * is the point, since "forced" is what stops anyone re-examining it.
 *
 * **`view` IS THE REAL UNION, WHICH IS THE ONE EXCEPTION TO THIS FILE'S `string` RULE** —
 * and the exception proves the rule rather than bending it. {@link SessionState}'s
 * string-typed members are `string` because their closed unions live BEHIND the engine
 * (`brush.effect` is core's, `armed`'s `selectCells` mode is the host's), so a declaration
 * here could only ever be a hand-copy that drifts. {@link CaptureView} lives on this same neutral floor
 * precisely so it does not have to be copied: the host, this wire and the daemon's zod enum
 * all read `shared/capture.ts` today, and the MCP door's JSON Schema joins them at Task 6. The rule was never
 * "don't type unions" — it is "don't copy a union you cannot import".
 */
export type ViewportCaptureRequest = {
  /** Where to photograph from — `"user"` (the human's live camera, the default) or one of
   *  the six axis views the editor already names. An axis view keeps the human's pivot and
   *  view distance and moves only the angles, and **never moves their camera.** */
  view?: CaptureView;
  /** Longest edge in pixels. Clamped rather than refused; the answer reports what it got.
   *  Default 1024. */
  size?: number;
  /** Draw the line overlays (grid, selection outlines, gizmo, brush ghost). Default `true`. */
  overlays?: boolean;
};

/**
 * What `viewport.capture` answers.
 *
 * **`png` IS BASE64, AND THIS IS THE ONLY PLACE IT IS.** The host hands back a
 * `Uint8Array` and the MCP door will hand an agent an image content block; base64 exists
 * for the one hop in between, because {@link SessionAnswer} travels as JSON and JSON has no
 * bytes. Encoding at the wire and nowhere else is what keeps the conversion a single
 * documented step rather than a format that leaks into the host's own vocabulary — the
 * chrome's answerer encodes, the daemon relays the string untouched (it relays every payload
 * untouched), and Task 6's door decodes into its content block.
 *
 * NO MIME FIELD. PNG is the format, decided in `field-capture.ts` and not negotiable per
 * call — thin overlay lines ring under JPEG, which is the whole reason. A `mime` member
 * would be a parameter pretending to be a fact.
 *
 * `width`/`height` are the pixels actually produced, which is how a clamped or
 * aspect-adjusted `size` becomes visible to the caller instead of being a silent surprise.
 * `view` is echoed for the same reason.
 */
export type ViewportCaptureResult = {
  /** The PNG, base64-encoded. */
  png: string;
  width: number;
  height: number;
  /** The view actually used — the request's, or `"user"`. */
  view: CaptureView;
};

/**
 * What `edit.apply` asks for — a batch of ops to land as ONE undo entry (foundations T4c).
 *
 * ONE BATCHED VERB RATHER THAN A VERB PER OP, and the reason is the human's undo stack.
 * `field.logApplyGroup` pushes exactly one entry for the whole list, so an agent's batch is
 * one ⌘Z for the person sitting in the tab however many ops it held — the "named stroke"
 * guardrail. A per-op verb would spray the history with entries nobody drew and make the
 * editor's own Undo unusable after any agent-driven edit.
 *
 * THE ANSWER IS NOT DECLARED HERE, and its absence is the one thing about this pair worth
 * saying. `edit.apply` answers with the action layer's `ActionResult`
 * (`action-registry/result.ts`) — the editor's ONE refusal vocabulary, deliberately not
 * re-spelled for the wire. This floor cannot NAME it: `shared/` sits below every layer and
 * imports nothing above itself (this module's header), and `action-registry/` is above.
 * That is a real constraint rather than an oversight, and the relay is unaffected: the
 * daemon has always passed payloads through untouched and has no standing to police a shape
 * it did not build (`daemon/session-handlers.ts` argues it for `session.state`). `generate`
 * answers a `GenerateOutcome` (`field-host/field-mutation.ts`) for exactly the same reason.
 */
export type EditApplyRequest = {
  /** The ops, in application order. Each is a `BrushOpInput` — `shared/field-op.ts`, which
   *  derives it from core's own `BrushOp` so this vocabulary cannot drift from the one the
   *  engine applies. Not typed as that here, because the daemon validates the shape and the
   *  chrome relays it; the ONE declaration both of them point at is that module. */
  ops: readonly BrushOpInput[];
};

/**
 * What `generate` asks for — one generator, committed atomically (foundations T4c).
 *
 * EVERY FIELD BUT THE ID IS OPTIONAL AND EVERY DEFAULT IS READ FROM SOMETHING THAT ALREADY
 * EXISTS — the generator def's own `defaults`, a fresh seed roll, the current selection's
 * box. `field-host/field-mutation.ts`'s `generate` owns that account, including why a
 * missing region REFUSES rather than inventing one.
 *
 * NO `policy`. A merge policy is a refinement to add when a caller asks for one; `replace`
 * is what the interactive paths fall back to and what this commits with.
 */
export type GenerateRequest = {
  /** A registry generator id — `hall`, `maze`. */
  generatorId: string;
  /** Overlaid onto the generator's own defaults, so naming one param keeps the rest. */
  params?: Record<string, unknown>;
  /** Omitted = a fresh roll. The seed actually used is reported back. */
  seed?: number;
  /** World metres. Omitted = the current cell selection's box; with neither, refused. */
  region?: { min: [number, number, number]; max: [number, number, number] };
};

/**
 * What `action.run` asks for — any REGISTERED action id, with its input (foundations T4c).
 *
 * THE DOOR IS WIDER THAN THE ADVERTISEMENT, deliberately. This accepts any id the action
 * registry carries; which ids are LISTED to an agent is the MCP door's decision, made
 * separately. Advertisement is the filter and `dispatch` stays the validator — so an id that
 * is real but unlisted runs, and an id that is not real is refused by the one funnel that
 * knows the table (`runNamedById`). A second allow-list here would be a second thing to keep
 * in step with the first, and the two would disagree the day a verb was added to one.
 */
export type ActionRunRequest = {
  /** The action's stable id — `world.save`, `view.frame`, `edit.undo`. */
  id: string;
  /** The action's own input, per `action-registry/schemas.ts`. Absent for the 33 bare verbs,
   *  and absent is also how a caller says "act on whatever is selected" for the six that
   *  take one. `unknown` because THIS module cannot name six per-id shapes without importing
   *  the layer that declares them; the daemon parses it against the id's schema before it
   *  ever reaches the chrome, which is where that knowledge lives. */
  input?: unknown;
};

/**
 * What `session.query` asks — **the spatial read, parameterized on what is being asked
 * about** (foundations T4c).
 *
 * ONE TOOL RATHER THAN THREE, and the reason is a budget rather than taste: the agent door
 * carries a hard ceiling of ten tools, the tranche's planned set is nine, and three separate
 * spatial reads would have spent a third of the remaining room on one concern. A
 * discriminated union is what a client's `inputSchema` renders as a `oneOf` an agent picks an
 * arm from, which is the same choice made once instead of three tool names to search.
 *
 * **IT IS DECLARED ONCE AND THE HOST IMPORTS IT, which is the opposite of what the two
 * request types above do.** {@link ViewportCaptureRequest} and {@link GenerateRequest} are
 * hand-mirrored against `field-host/field-capture.ts` and `field-host/field-mutation.ts`, and
 * this one is not: `field-host/field-query.ts` type-imports this declaration directly. The
 * edge is legal and already worn — `field-mutation.ts` imports `./field-op.ts` and
 * `field-capture.ts` imports `./capture.ts`, both from this same floor — so a host module
 * naming a wire type costs nothing and removes the drift the mirrors accept. The repo's own
 * rule is the tie-breaker: two ways to spell one thing is a smell, and the only reason to
 * mirror is when one side cannot reach the other.
 *
 * The arms carry no engine type at all — three primitives and two number triples — which is
 * what makes the single declaration POSSIBLE here. The ANSWER is a different matter and is
 * deliberately not declared on this floor, for {@link EditApplyRequest}'s reason exactly: it
 * names `FieldEntityInfo`, a selection spec and a field hit, all of which are core's, and
 * this file is held engine-free. `field-host/field-query.ts` owns it; the daemon relays it
 * untouched, as it relays every payload.
 */
export type SessionQueryRequest =
  | {
      /** Every committed generator entity with its footprint box, plus the PLACED PROPS
       *  lint — how many there are, which ones are not resting on anything, and which ones
       *  interpenetrate. */
      about: "entities";
    }
  | {
      /** One ray cast into the density field — the general-purpose probe, and the same
       *  mechanism the `entities` arm's contact test runs per prop. */
      about: "ray";
      /** Where the ray starts, in world metres. */
      origin: [number, number, number];
      /** Which way it points. Normalized by the engine, so any length works — but it must
       *  not be the ZERO vector, which the daemon refuses. A zero direction is not a ray:
       *  core divides by `hypot(...) || 1`, so it walks +X from the origin and answers a hit
       *  that describes a question nobody asked, or `null` — indistinguishable from "nothing
       *  within reach". The one input on this wire where a plausible-looking value produces a
       *  confidently wrong answer. */
      dir: [number, number, number];
      /** How far to look, in metres. Default `DEFAULT_PROBE_M`, ceiling `MAX_PROBE_M`
       *  (`shared/field-limits.ts` carries both, and why the ceiling is where it is). */
      maxDist?: number;
    }
  | {
      /** The human's current cell selection — its replayable spec, its size and its box.
       *  **Never its cells**; the answer's own docblock argues why. */
      about: "selection";
    };

/**
 * **WHAT LMB DOES RIGHT NOW — the ONE member that answers "what is armed"** (foundations
 * T4c, Task 5).
 *
 * IT EXISTS BECAUSE THE COMPOSITE WAS MISREAD LIVE, by an agent, at the T4b gate walk. The
 * payload then carried `tool: {effect: "dig", …}` beside `gesture: "pointer"`; the agent
 * reported "dig armed" and the human was looking at a screen with nothing armed but the
 * Select button. **Both fields were truthful and the JOIN was the whole answer** — `gesture`
 * was the arming fact and `tool` was the DORMANT brush configuration — and the rule for
 * joining them lived in a chrome hook's docblock the agent cannot see
 * (`frontend/hooks/useFieldHostState.tsx`, `FieldToolState.gesture`). A payload that requires
 * a rule its reader has no access to is a payload that will be read wrong; this member is
 * that join, performed once, by the side that holds the rule.
 *
 * **IT REPLACES `gesture` RATHER THAN JOINING IT**, and that is the half that makes it work.
 * Keeping both would leave the misreading available and add a third field to disagree over —
 * two ways to spell one thing, which is the smell this repo's own design rule names. So the
 * projection derives this and the wire carries no gesture slot at all. The dormant
 * configuration keeps its own member and is NAMED for its dormancy
 * ({@link SessionState.brush}).
 *
 * **THREE FACTS, NOT TWO, and the backlog entry that asked for this member named only two.**
 * The chrome's own arming predicate joins the STAGED GRAMMAR as well as the gesture slot
 * (`frontend/lib/actions.ts`'s `idle`: *"Either one owns the interaction, so no gesture
 * family reads as armed while one stands"*). A live session and a pending stamp arm each
 * SHADOW the gesture slot — LMB routes to them first while they stand, and the slot goes on
 * naming what the button does underneath (`field-host.ts`'s `PendingStamp` states exactly
 * that, and it is why the arm is not a gesture member). A member that re-spelled `gesture`
 * alone would have reproduced
 * the identical misreading in exactly the states an agent's own verbs create. The two shadows
 * are mutually exclusive by construction — `startStamp` cancels any session before arming and
 * clears any arm before opening one (`field-machine.ts`) — so their order here is a reading
 * order, not a priority.
 *
 * A DISCRIMINATED UNION rather than a flat string, for one reason: two arms carry a fact of
 * their own, and folding those into the discriminant would put a host union's members INTO
 * this wire's vocabulary — the copy this file's own `string` rule refuses. `mode` and
 * `generator` stay `string` for that rule; `does` is this file's own closed vocabulary and
 * cannot go stale, because the projection builds it from an EXHAUSTIVE map over the host's
 * gesture union (`frontend/lib/session-answerers.ts` — a new host gesture stops the build).
 */
export type ArmedState =
  /** A stamp/reconfigure/move session owns the staged grammar, and **the brush is SUSPENDED
   *  under it** — a stroke would carve the very rock the ghost is being fitted to, so the
   *  press is refused out loud instead. The verbs are the session's own: ⏎ applies, Esc
   *  discards. {@link SessionState.session} carries which session it is.
   *
   *  **IT DOES NOT MEAN LMB IS STEERING THE GHOST**, and that clause was in this docblock
   *  until it was checked: only a MOVE session is steered by the pointer. What is suspended
   *  is the brush and the segment commit (`field-machine.ts`'s `suspendedByStamp`, whose own
   *  comment says selection gestures are deliberately NOT), and opening a session never
   *  clears the gesture slot — so after the ordinary flow *box-select a region, then pick a
   *  generator*, an LMB press still starts a new cell box.
   *
   *  **The slot underneath is deliberately NOT reported while this arm stands.** It is what
   *  LMB goes back to, not what it does now, and re-exposing it here would rebuild the very
   *  composite this member exists to remove. Ending the session makes it the answer again. */
  | { does: "session" }
  /** A stamp is armed and LMB is drawing the REGION it will fill — two clicks span it. */
  | { does: "stampRegion"; generator: string }
  /** Click selects the committed ENTITY under the cursor. The default a fresh editor opens
   *  on, and the state the T4b gate misread as "dig armed". */
  | { does: "selectEntity" }
  /** Click drags a CELL selection — `mode` is the host's own selection kind (`box` and the
   *  two floods). */
  | { does: "selectCells"; mode: string }
  /** The two-click swept capsule: anchor, then commit ONE segment op with the brush's own
   *  effect and material. A BRUSH gesture — {@link SessionState.brush} is live under it. */
  | { does: "segment" }
  /** LMB strokes the brush, with {@link SessionState.brush} exactly as it reads. */
  | { does: "brush" };

/**
 * What `session.state` answers — **the first method with a payload worth naming**, and the
 * shape an agent forms its picture of a live editing session from (foundations T4b).
 *
 * A DISCRIMINATED UNION on `ready`, for {@link SessionAnswer}'s reason one door over: the
 * engine bundle loads asynchronously and a tab is claimable before its field host exists,
 * so "there is no world here yet" is a real state that must not be spelled as a world.
 * Every field below would otherwise have an innocent-looking default — no selection, no
 * session, zero ops — and an agent reading that would conclude the human is sitting in an
 * empty world when the truth is that the editor is still starting. **A false claim of
 * emptiness is the one answer this method must never give**, and one boolean is what makes
 * it unspellable.
 *
 * The not-ready arm carries NOTHING BESIDE THE DISCRIMINANT, and what makes that honest is a
 * structural invariant rather than a claim about how many causes exist: **only a CLAIMED tab
 * can be asked, and only a READY tab claims.** The chrome opens its SSE feed under
 * `state.status === "ready"` (`frontend/components/App.tsx`'s `useDaemonFeed` gate), so a tab
 * that failed to boot — `engine-error` from a build that will not compile, `no-webgpu` from a
 * browser that cannot run it, both live states in `frontend/lib/state.ts` today — never opens
 * a feed, never receives a token, never claims, and is therefore never relayed a question at
 * all. `session.state` answers `no-session` about that tab instead, which is the honest
 * sentence and the one with a different remedy.
 *
 * **WHICH MAKES THIS ARM CURRENTLY UNREACHABLE THROUGH THE DAEMON, and saying so is more
 * useful than naming causes that are not.** Follow the same gate one step further: a tab is
 * asked only if it is claimed, it claims only after a token arrives, and the token arrives on
 * a feed it opened only once `ready` — by which point `App` has already assigned the field
 * host (it does so synchronously, immediately before the dispatch that makes the editor
 * ready) and the shell has long since committed. Two network round trips stand between the
 * commit that fills the chrome's reader and the earliest ask. So the chrome CAN spell this
 * answer and no relayed question can currently receive it.
 *
 * It is kept for two reasons. It is what the chrome must answer if it is asked anyway —
 * `tests/chrome/session-state.test.tsx` asks the registry row directly, which is the only
 * caller that can reach it — and it is the shape that stays honest when the gate moves,
 * which is the next paragraph.
 *
 * **THE TRIGGER IS THE GATE, NOT A NEW CAUSE.** A change that opened the feed before
 * `ready` — reconnect hardening, a claim that survives a reload, an agent that wants to see a
 * tab whose engine failed — would put a permanently-not-ready tab behind this arm, where
 * `{ ready: false }` reads as "still starting" to a caller that will retry for ever. Nothing
 * here would catch it, because nothing here can see the gate. Whoever moves that gate owes
 * this arm a reason field in the same change.
 *
 * **CONCISE, AND A PROJECTION RATHER THAN A PASS-THROUGH.** The chrome holds richer records
 * than these — a whole `FieldTool`, a `StampSession`, a `SelectionInfo` — and none of them
 * can be named here even if we wanted them: `SelectionInfo.spec` and `FieldEntityInfo` are
 * built on `@furnace/core` types, and this file is held ENGINE-FREE by
 * `tests/frontend-no-engine-leakage.test.ts` (and sits below `field-host/` in the layer
 * arrow besides). So the projection is forced at the boundary and welcome anyway: what an
 * agent needs is what is armed, what is selected and how big the log is, not the ten fields
 * a form needs to render a param sheet. There is no `response_format` flag and no verbose
 * arm — one caller, and a second shape is worth building when a second caller wants one.
 *
 * THE STRING-TYPED MEMBERS (`brush.effect`, `armed`'s `mode` and `generator`,
 * `session.phase`, `mask.kind`) ARE
 * `string` RATHER THAN RESTATED UNIONS, and that is the anti-drift choice rather than a lazy
 * one. Each has a closed union on the host side that this file cannot import; a hand-copy
 * would be a second declaration the host can widen without this one noticing, and a reader
 * that switched on the copy would silently lose an arm. `string` cannot go stale. The
 * hand-mirror filing this module's header names (`wire-contracts-are-hand-mirrored.md`) is
 * about types that SHOULD be shared; these are types that should not be copied at all.
 *
 * {@link ArmedState.does} IS THE ONE CLOSED UNION IN THIS PAYLOAD, and it is not a
 * counter-example: it is this file's OWN vocabulary rather than a copy of anybody's, and the
 * projection that produces it is exhaustive over the host union it derives from, so the
 * drift this rule guards against is a compile error rather than a silent widening.
 *
 * MIGRATION (until T4c Task 6): **THIS PAYLOAD OWES ITS READER ONE SENTENCE THE DOOR DOES NOT
 * YET CARRY.** The `session_state` tool description and `MCP_INSTRUCTIONS` (`daemon/mcp.ts`)
 * still say *"which tool and gesture are armed"* — two members that no longer exist — and the
 * agent-facing prose is precisely where the T4b misreading came from. What that row must carry
 * is the RULE, not the member list: **`armed` is what LMB does right now; `brush` is a dormant
 * setting and is not a claim that anything is armed.** A door that lists the fields without
 * that sentence hands the next agent the same join to get wrong. The marker is the convention
 * `AGENTS.md` names for exactly this — `grep -rn "MIGRATION (until T4c Task 6)" packages/`
 * surfaces this and the interrupt row's twin, and both delete when the door is rewritten.
 */
export type SessionState =
  | {
      /** The chrome is mounted but has no field host yet — see this type's header for why
       *  this arm carries nothing else. */
      ready: false;
    }
  | {
      ready: true;
      /**
       * The change cursor: **hold it and compare it, never parse it.**
       *
       * OPAQUE BY CONTRACT rather than by encoding — it is readable on purpose, because a
       * token nobody can read is a token nobody can debug, and nothing in this payload
       * depends on its shape. What it is composed of, what it can miss and why it is not
       * polled are argued where it is made (`field-host/field-history-feed.ts`'s
       * `revisionOf`). What belongs HERE is what it certifies, which is a smaller claim
       * than a reader would assume and is the only one this wire can keep.
       *
       * **IT CERTIFIES `history`, EXACTLY.** The cursor is composed into the same payload
       * the labels and the tail come from (`FieldHistory.revision`), by the code that
       * decides to publish it, so those two cannot describe different moments. That is why
       * it rides the payload instead of being read off the host at answer time: a polled
       * token runs AHEAD of a latched payload, and a reader handed a post-edit cursor over
       * a pre-edit picture caches both and is told "unchanged" for ever after.
       *
       * **IT CERTIFIES NOTHING ELSE IN THIS RECORD, and the reason is structural.** The
       * chrome holds one latch per seam: `stats`, `selectedEntity`, `selection`, `tool`,
       * `session` and `world` each arrive on their own, and `camera` is polled live. So an
       * unchanged cursor does NOT mean this payload is unchanged — most obviously for the
       * things it was never about (a selection, an armed tool, a camera fly move none of
       * them), and least obviously for `stats`, which is published per animation frame and
       * can therefore trail the cursor by up to a frame after an edit lands.
       *
       * So the honest sentence is: an unchanged cursor means **"no edit landed and no world
       * was swapped, and the `history` you are holding is current"**. Everything else in
       * here is a reading taken at the moment of the answer, with no promise that it agrees
       * with the cursor beside it. **It is a hint that saves a read, never a proof that
       * skips one** — a caller that must be certain about a member other than `history`
       * re-reads regardless of what the cursor did.
       */
      cursor: string;
      /** Which world, whether it has unsaved edits, and whether a world verb (save, bake,
       *  load) is running. `name` is `null` for the untitled scratch — the same null the
       *  claim table keys on. */
      world: { name: string | null; dirty: boolean; busy: boolean };
      /** **WHAT LMB DOES RIGHT NOW.** Read this before reading {@link SessionState.brush} —
       *  see {@link ArmedState} for the misreading it exists to end. */
      armed: ArmedState;
      /** **THE STANDING BRUSH CONFIGURATION — what a stroke WOULD do, armed or not.** It is
       *  a SETTING and not a state of the interaction: it reads the same whether the brush
       *  is what LMB strokes (`armed.does === "brush"`), what a segment sweeps
       *  (`"segment"`), or nothing at present (every other arm). It was called `tool` until
       *  T4c, which is the name that got read as "the tool in hand".
       *
       *  `mask` carries its `classId` only for the class-filtered kind, exactly as the
       *  host's own union does. */
      brush: {
        effect: string;
        materialId: number;
        mask: { kind: string; classId?: number };
      };
      /** The live stamp / reconfigure / move session, or `null` between sessions. `params`
       *  are deliberately absent: they are a generator-shaped bag whose schema only the
       *  stamp form knows, and an agent that wants them is asking a different question. */
      session: {
        generator: string;
        phase: string;
        mode: string;
        entityId: number | null;
      } | null;
      /** The CELL selection — `truncated` says the host stopped counting, so `count` is a
       *  floor rather than a total. Independent of `selectedEntity`: either can stand
       *  alone. */
      selection: { count: number; truncated: boolean } | null;
      /** The selected committed entity. `frozen`/`baked` are BOOLEANS here where the host's
       *  record spells absence as false — a wire the daemon relays should not make a reader
       *  reason about a missing key. */
      selectedEntity: {
        entityId: number;
        generator: string;
        frozen: boolean;
        baked: boolean;
      } | null;
      /** The orbit camera's orientation in radians. Orientation only, which is what the
       *  host's own pose seam carries. */
      camera: { yaw: number; pitch: number };
      /** The three log-derived numbers, or `null` in the sub-frame window before the host's
       *  first readout arrives — the stats seam publishes per frame and pushes nothing on
       *  subscribe, so `ready: true` genuinely can precede it. `null` rather than zeros, for
       *  the same reason the `ready` discriminant exists at all.
       *
       *  THESE THREE AND NOT THE OTHER EIGHT: they are the fields `field-stats.ts` proves
       *  correct-by-construction under a matched cache signature (they ARE the signature),
       *  while `liveGenerators` and `compactableOps` are content-derived and can be stale
       *  by that module's own documented gap. A readout that could lie is not one to relay
       *  to a reader who cannot see the caveat. */
      stats: { totalOps: number; undoDepth: number; redoDepth: number } | null;
      /** What ⌘Z and ⇧⌘Z would do, in words, plus the recent undo tail newest-LAST. The
       *  tail is BOUNDED by the host (its own constant), so it is what the History palette
       *  shows rather than the whole stack; `stats.undoDepth` is the true depth, and the
       *  difference between them is how much is not listed. */
      history: {
        undoLabel: string | null;
        redoLabel: string | null;
        tail: readonly string[];
      };
    };
