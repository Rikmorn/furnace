---
summary: How an agent reads and drives a live editor — the MCP tool set, the browser backchannel it relays through, the guest clause, and the per-turn byte budgets that bind it.
verified: 2026-08-18
---

# The agent door

An agent talks to the editor over MCP, at one branch on the daemon's route ladder
(`packages/editor/src/daemon/mcp.ts`). Two things make the door what it is:

- **Every tool is a `dispatch()` call and computes nothing.** A tool that computed anything
  would be a second author on an answer the command registry already owns, and *"every client
  funnels through one validator"* ([commands](commands.md)) would stop being literal at the one
  edge where the caller is least trusted.
- **Most of what an agent wants is not on disk.** `project.get` and `world.list` answer with no
  tab open; what is selected, which tool is armed, where the camera points, what the history
  holds all live in the chrome's mirrors, in the browser. The daemon cannot compute them, cannot
  cache them honestly and must not guess — so it **relays**.

Route position and the committed-response guard are [daemon](daemon.md)'s; the error mapping is
[error-contract](error-contract.md)'s.

## The backchannel — one ask, one id, one budget

`packages/editor/src/daemon/backchannel.ts` exists because of the two-bundle constraint. One
addressed `session-request` frame goes out to the claimed connection, one `session.answer` POST
comes back, correlated by `requestId`.

**A relay with a correlation table, never a reader.** `ask()` returns whatever the session said
and the daemon validates not one field of it, having no standing to police a shape neither half
would learn about from it.

### Every way an ask can end is a rejection that ARRIVES

That is the whole point of the type, and the literal reading of the settled policy's *"a typed
error, never a hang"*. **Three codes across four clauses** — and the distinction is the one a
caller branches on:

- **No claimed session, or more than one** → `no-session`, immediately, with the message
  carrying which. Many is **refused rather than resolved by picking**, because picking is the
  failure the design exists to avoid: an agent would read a tab the human is not in and nothing
  anywhere would say so. Two claimed tabs is a state the claim table allows by design (one claim
  per *world*), so it is a real branch rather than a defensive one.

  **Two tabs on two DIFFERENT worlds are still two claims, and the read still refuses.** That is
  the claim table's design, and the refusal is the right answer — typed, immediate, and carrying
  a remedy a human can act on (*"close all but the tab you want driven"*), which is strictly
  better than picking one.
- **The connection departs mid-ask** → `no-session` **now**, not at the timeout. The two
  sentences send a caller to different places — a timeout says "it is slow, wait longer", this
  says "the tab you were reading closed" — and only the second is true and has a remedy. It also
  lands in milliseconds rather than ten seconds. The close listener is registered by this module
  rather than by the server, unlike the claim table beside it: the claims module knows nothing of
  hubs and must be wired from outside, whereas this module is *handed* the hub, so watching it is
  its own business — one fewer line the server can forget.
- **Silence** → `session-timeout` at `DEFAULT_ASK_TIMEOUT_MS`, which is **10 s**. The number is
  chosen against the CLIENT's floor rather than against a feel for browser speed: Claude Code's
  per-request timer for an HTTP MCP server is 60 s and its config knobs can only *raise* it, so
  60 s is a floor no client configuration goes under and 10 s is strictly inside it for every
  client. **The pin asserts the inequality, not the number.**
- **The session answers that it could not serve the method** → `internal`. The chrome supplies
  PROSE, never a code: `EditorErrorCode` is the daemon's closed union and the chrome is not one
  of its throwers, so the chrome says the sentence and the daemon decides the code. Without this
  arm an unrecognised method would produce no answer and time out, and the route is routine
  rather than exotic — the `bun run edit` loop restarts the daemon on every source change while
  the tab keeps its bundle.
- **`params` that will not serialize** → `internal`. The emit is wrapped because
  `JSON.stringify` raises synchronously inside the frame builder, and a raw `TypeError` with
  `code: undefined` would escape a contract promising three codes while the entry sat out its
  full budget.

**One residue, stated rather than claimed away:** a chrome that REFUSES a method answers
`internal` — indistinguishable at the code level from a daemon fault, with only the remedy
sentence carrying the difference. Filed at
`docs/backlog/editor-and-tooling/backchannel-refusals-blur-two-causes.md`.

### One-shot is structural rather than remembered

Every exit routes through `takePending`, which removes the entry from the map *before* settling
it — so a duplicate answer, a late one that lost the race with its own timeout, and a forged
`requestId` are the same harmless miss. `session.answer` reports `{ delivered: false }` for all
three rather than refusing: a late answer is the routine race (the chrome cannot know its ask
has timed out), and a 4xx would manufacture a client-side failure for a tab that did exactly the
right thing a moment late.

### The chrome's half is a registry, not a component

The answer hook mounts at `App` with the answerer table as a parameter, so a new method is a row
rather than a change to the wire. It renders nothing and notifies nothing.

The seam **normalizes** rather than narrows — the handler's return is resolved as a promise with
the synchronous `catch` kept, both arms load-bearing and pinned separately — because a seam that
served only synchronous answers would push a worker round trip into a fire-and-forget inside a
sync body, i.e. the same silence one door over. What makes async safe is the correlation id:
answers may come back out of order, which is what the table is for.

### The claim key must be true, or a conflict test proves nothing

The claim is keyed by the **authored world**, and the claim hook re-claims under the new name the
moment it changes. One command does the re-key, because the claim table gives a connection at
most one world and a successful claim of `W` drops the previous key in the same step;
`session.release` is reached only on the REFUSED path, where the old key would otherwise survive
and the fix would manufacture the very lie it exists to end. A LOST tab still never re-claims:
the re-key is a second route into the same body, and the claim-lost cover's guard is inside it.

## The tool set — nine rows, ceiling of ten

`session_state`, `world_list`, `project_get`, `session_query`, `viewport_capture` are the
**reads**; `edit_apply`, `generate`, `action_run`, `session_interrupt` are the **writes**.

Derive the advertised set and its bound:

```sh
grep -nE '^\s+name: "' packages/editor/src/daemon/mcp.ts
bun test packages/editor/tests/mcp.test.ts
```

**A model pays for every row it must consider on every turn**, which is why `session.query` is
ONE parameterized read rather than three and why the tenth slot is deliberately unspent: the next
verb has to be worth the room it takes.

### `readOnlyHint` is a property of the ROW

It was hard-coded `true` for every tool, which is exactly the shape that would have gone on
claiming read-only over four writes. **The five reads carry it; the four writes carry no
`annotations` object at all**, because the specification's default for an absent hint is already
"not read-only" and an explicit `false` would be a second spelling of one fact.
`session_interrupt` counts as a WRITE: it changes the human's interaction state.

### Advertisement equals validation, structurally rather than by agreement

Every row advertised a hand-written empty document while `dispatch` enforced a real schema — which
worked only while all the commands took nothing. The door now resolves each row's command in the
registry and PROJECTS that command's own zod through `z.toJSONSchema(schema, {io: "input"})`.
There is one object; the agent reads one projection of it and the door enforces the other, so a
hand-written second spelling cannot exist to drift.

Two consequences fall out of doing it at construction rather than per request: the projection is
not redone per POST, and **a row naming a command the registry lacks is a STARTUP failure** —
which is what lets the error contract say `unknown-command` is unreachable through this edge
rather than merely unlikely.

**`type: "object"` is hoisted over the one union-rooted row.** The SDK types `Tool.inputSchema` as
an object schema with a `catchall`, so `session.query`'s discriminated union — which zod reflects
as a bare `oneOf` — would be rejected on both sides without it. Hoisting restates what every arm
already says; the `catchall` carries the `oneOf` through. Anything that is neither an object nor a
union of objects throws at door construction rather than being papered over with a `type` it does
not have.

### The tuple bug, and why the pins are about REFLECTION

`z.tuple([n,n,n])` projects to `prefixItems` and **no length keyword** (measured on zod 4.4.3),
and `prefixItems` alone constrains nothing. So every vector on this wire was advertised as an
array of any length while `dispatch` demanded exactly three: **the advertisement LOOSER than the
validator**, which is the single defect the projection exists to make impossible.

Both the op vector and the daemon's point type now restate the bounds through
`.meta({minItems, maxItems})`, which zod hoists onto the same node and which does not touch
parsing. Switching to `z.array().length(3)` would have projected correctly on its own but infers
`number[]` and so would have cost the daemon's drift pins. The pin is a KEYWORD INVENTORY over all
nine documents plus a "no `prefixItems` without matching length" rule, so the next lossily-reflected
construct reds before an agent reads it.

### Two rules this door enforces that its document cannot state

Counted rather than mentioned, because *"there is one"* was the first draft of this and it was
short. Each fails to project for a different reason, both refuse at the wire, and the probe
enumerates them so a third arriving unlisted is the thing that shows up.

1. **A zero direction vector** — JSON Schema has no "not this value", so the refinement rides
   `.describe()` and the suite pins the description as well as the refusal.
2. **A stray key on an action row's `input`** — `action_run` advertises `input` as `unknown`,
   which is exactly what its own schema says and what is TRUE for the bare verbs; the ids that
   take an object are parsed one layer deeper against the registry's input schemas, and a per-id
   `oneOf` in the document would be a lie for all the others.

Both are honest in the prose an agent reads, which is what a caller has instead of a keyword.

## The guest clause

**No `session.*` claim verb is projected.** `claim`, `steal` and `release` are not absent because
they would be dangerous — they are **unspellable**: all three take a connection token minted
*into* an SSE stream ([change-feed](change-feed.md)), and this door holds no stream, so an MCP
client can never present one, structurally rather than by a check. `session.answer` is the
chrome's return leg and names a pending ask, not a caller.

An agent therefore reads **through** whichever session is claimed and can never become one. A
call to an unadvertised name is refused as a protocol error rather than an `isError` result,
which is that same line.

**A server and a transport per POST**, closed in a `finally`. A stateless transport cannot be
reused in this SDK — the second request throws inside the SDK's own listener and the client sees
a bare 500 with an empty body, always on the second call and never the first, so it survives
every smoke test. A stateful transport was the other shape and is fenced out on purpose: it
serves exactly one client, so it would need a table keyed by `Mcp-Session-Id` and **the daemon
would then have two session concepts**. The editor's one session is the SSE claim a human's tab
holds; a per-request transport is what keeps that literally true, and it buys the guest clause
for free — **two agents are two independent POSTs reading through one human's claim.**

**`field.load` is deliberately not projected.** It answers with a whole world — every chunk and
`.mat` sibling base64'd, plus the oplog — which is megabytes against a per-result budget measured
in tens of thousands of tokens. There is no honest way to hand that to an agent as text, and a
truncation would be a lie in the one direction this door exists to close.

## The per-turn budget

The ceiling of ten rows exists because every row a model must consider is paid for on every turn.
**Pinning the discovery blurb and not the rows would have budgeted the cheaper surface and called
it discipline**, so three things are pinned in `packages/editor/tests/mcp.test.ts`:

| Budget | Pin |
| --- | --- |
| `MCP_INSTRUCTIONS` | ≤ 2,048 bytes |
| the nine row descriptions, totalled | ≤ 8,192 bytes |
| advertised rows | ≤ 10, asserted as an inventory AND as a bound |

**Head figures are measured, never typed here** — a byte total moves with every reworded
sentence. Derive:

```sh
bun test packages/editor/tests/mcp.test.ts
```

The description total is a TOTAL rather than a per-row cap, because `session_query`'s row
genuinely is a wall and it is the one length this door had to buy. **The prose cap is now the
binding constraint on a tenth tool before the ceiling of ten is**: the remaining headroom is
shorter than most of the nine rows.

The projected schemas ride the same response and are **deliberately uncapped** — they are derived
rather than authored, so a ceiling there would be a ceiling on the engine's op vocabulary wearing
a budget's clothes.

### What `MCP_INSTRUCTIONS` carries

Exactly four things an agent that has never heard of furnace cannot infer, each chosen because
not knowing it produces a specific mistake:

1. that the live half is **relayed** to a browser tab — without it a `no-session` refusal reads as
   a broken server;
2. the **claim model** — without it an agent watching two tabs cannot tell the human what to do;
3. that the **cursor is compare-only** — without it an agent caches a payload against a token
   certifying one member of it;
4. that **`{ready:false}` is a real answer** — the arm `shared/wire.ts` declares and this door
   really returns.

**That fourth clause is INSURANCE, not a description of today, and the wire type is explicit
about it: the arm is currently UNREACHABLE through the daemon.** Follow the gate — a tab is asked
only if it is claimed, it claims only after a token arrives, and the token arrives on a feed that
opens only once the editor is ready, by which point the field host is assigned and the shell has
long since committed. A tab that failed to boot never opens a feed at all and earns `no-session`
instead, which is the honest sentence and has a different remedy. The clause is in the
instructions because it is the answer that stays honest **when the gate moves**, which the wire
type names as the trigger.

**The closing READS-ONLY line is gone, and its absence is asserted** — a door with hands that
tells an agent "nothing here edits a world" is worse than one that says nothing, because that
sentence is acted on.

### How to connect

The daemon prints the URL at startup. `claude mcp add --transport http furnace
http://127.0.0.1:4500/mcp` registers it, and the tools then appear as `mcp__furnace__session_state`
and siblings — **the client namespaces by the key the human wrote in its own config**, which is
why the tool names here carry no prefix of their own and the server info identifies the server in
logs rather than the tools. Under `--port 0` read the port off the banner.

## `session_state` — what is armed, and the join that used to be missing

The payload once carried a `tool` and a `gesture` slot, each truthful, with the rule for joining
them living in a chrome hook's docblock the agent could not see — so an agent read "dig armed"
over a screen with nothing armed but the Select button.

**The shape now: one `armed` member, and the dormant configuration renamed to `brush`.**
`ArmedState` (`packages/editor/src/shared/wire.ts`) is a discriminated union on `does` —
`session`, `stampRegion` (+`generator`), `selectEntity`, `selectCells` (+`mode`), `segment`,
`brush` — and **the wire carries no `gesture` slot at all.** That is the load-bearing half:
keeping both would have left the misreading available and added a third field to disagree over.

**The rule an agent reads, in the row and in the instructions:** *`armed` is what LMB does right
now; `brush` is a standing SETTING and is NOT a claim that anything is armed.*

The rejected candidate was `tool: null` while the pointer is armed — which answers "is it armed"
by destroying the setting the agent's own verbs manipulate.

**Three facts feed the join, not two.** A live session and a pending stamp arm each SHADOW the
gesture slot — LMB routes to them first while they stand, and the slot goes on naming what the
button does underneath. A member that re-spelled the gesture alone would have reproduced the
identical misreading in exactly the states an agent's own verbs create. The two shadows are
mutually exclusive by construction.

**The shadow ORDER is single-sourced.** `shared/action-table.ts`'s `STATUS_PRECEDENCE` (`session`
▸ `pendingStamp` ▸ `gesture` ▸ `effect`) was already load-bearing for the status bar's keymap
line, so the armed derivation walks the SAME tuple through a resolver table rather than spelling
a third cascade: the keymap the human reads and the payload the agent reads take their order from
one declaration, and a fifth member of the tuple is a compile error in both tables.

**The vocabulary cannot drift, and that is a compile-time property rather than a promise.** The
gesture slot maps through a total `Record<ViewportGesture, ArmedState>` written as an object
literal, so a new host gesture fails to build here rather than falling through to a default arm.

**`armed` is the ONE derived member in a projection whose stated property is that it derives
nothing** — and the exception is the rule read from the other side. Picking three fields and
leaving the far end to combine them is not "not deriving"; it is deriving in the one place where
the rule is invisible to whoever performs it.

## `session_query` — the spatial read

**The posture is the design, and it comes from evidence rather than taste: *ask this; do not
squint.*** An agent must never read a rendered image to answer "is this prop resting on the
floor" or "do these two things interpenetrate" when the field can state it exactly. The tracked
research is `docs/research/2026-08-09-viewport-capture-technique.md`.

**ONE tool, parameterized on `about`, with six arms** — `entities`, `entity`, `ray`, `selection`,
`generators`, `flags`. Separate tools would have spent much of the door's remaining room on one
concern. A `z.discriminatedUnion` is what makes a bad request report against the arm it MEANT
rather than *"no union arm matched"* — and the trade got BETTER as the arms grew, which is the
test of whether it was a trade or a rationalisation: six questions, still one row, the tenth slot
still unspent.

It lives in `packages/editor/src/field-host/field-query.ts`, and the placement was decided rather
than defaulted: every answer derives from the LIVE store and LIVE log, so the module
value-imports `@furnace/core` — and the leakage test fails such an import from any
non-worker-entry file under `src/frontend/` ([bundling](bundling.md)). **A chrome version does not
compile past the suite; this is a machine-enforced constraint, not a preference.**

The `about` dispatch is a `switch` with a `const _never: never = req` exhaustiveness binding. The
first cut ended on a bare return, so a fourth arm added to the wire type would have compiled clean
and answered confidently about ENTITIES; the schema pin cannot cover it either, because a
narrower schema union stays assignable to a wider wire union. **The guard has since collected
twice**, on arms added in two separate slices, each failing the build before it had a branch.

### The contact rule

A prop is IN CONTACT when a ray cast straight down from the centre of its proxy box's BASE finds
a solid sample within one CELL SIZE. Each half is chosen for determinism:

- the probe is a function of the prop's own box and nothing else — no camera, no ordering;
- the one-cell tolerance is the answer's RESOLUTION rather than a fudge factor, because the
  raycast reports the entry into the first solid sample's cell and the extracted isosurface lies
  within one cell of it — anything tighter would report lattice noise as a defect;
- a prop BURIED in the floor reports contact at `gap: 0`, since core's raycast hits its own start
  voxel at `t=0` and "sunk in" is not the defect being hunted.

**Entities are not contact-probed at all**, and the asymmetry is not an oversight: a carver's
footprint is a volume of AIR it removed, so a downward probe from its base hits the rock under
the floor it just made — "in contact", always, for every hall. The question has meaning for a
thing PUT somewhere, which is a prop.

The rule is carried **verbatim into `session_query`'s advertised description**, because a tool
that says "ask me about contact" without saying what contact MEANS hands an agent a boolean it
cannot calibrate.

### The prop report is EXCEPTIONS, not a roster

`total`, `scanned`, `floating`, `overlapping`, `truncated`. A scatter emits hundreds of records; a
row per prop is tens of kilobytes of "this one is fine" for a reader whose whole question is which
ones are not. Both lists are empty on a clean world — the answer an agent most often wants and the
cheapest to read. **`total`/`scanned` beside `truncated` are what keep the empty lists honest:** a
silently-capped list reads as "no overlaps", which is the single most damaging thing this verb
could say.

### Two bounds, measured, and neither is silent

`MAX_QUERY_PROPS` (`field-query.ts`) is a **COST** ceiling, sized against the HUMAN's frame budget
rather than the ask timeout — the read runs synchronously on the tab's main thread, so an agent's
question is paid for in the editor's smoothness while somebody else is working in it. Measured
(bun, 2026-08-10): the O(N²) pair scan plus the full-reach contact probes total ~34 ms at 2048,
~96 ms at 4096 and ~319 ms at 8192, against the 100 ms interaction ceiling core already cites.

A sort-and-sweep was weighed and rejected: it would not change the degenerate case (props stacked
at one X stay quadratic), which is precisely the case a bound has to survive, so the bound does
the work either way and the simple loop is what it was measured against.

`MAX_REPORTED` is a separate **SIZE** ceiling on what is said — one number for both lists, because
they are one kind of thing.

`MAX_PROBE_M` (`packages/editor/src/shared/field-limits.ts`) clamps a ray in the host as well as
refusing it at the door, because the raycast's own step ceiling would otherwise start terminating
walks early and a `null` would stop meaning "nothing there". Until the clamp, this module's
central promise about `null` depended on a sibling door being in the call path. `dir` is refused as
the zero vector at the door: `z.number()` rejects `NaN`/`Infinity` but `[0,0,0]` survived, and core
normalizes by `hypot(...) || 1`, so it would have walked +X from the origin and answered about a
ray nobody cast.

### The selection answer never carries cells

A flood may hold hundreds of thousands of cells; as coordinate triples that is megabytes no agent
can act on. What travels instead is core's REPLAYABLE `SelectionSpec` — the same shape a
selection-masked op embeds — plus `count`, `truncated` and the metre `aabb`. An agent holding the
spec can write an op acting on exactly those cells without naming one. **The cells were never the
answer to "what is selected"; the spec is.** The count of cells the VIEWPORT draws as cubes is
dropped in the projection: it is a fact about the human's screen.

`Selection.info()` is one new host seam member, a **pull beside a push** — the channel serves a
React surface that re-renders when the selection moves, and the query is asked at an arbitrary
moment with no render to hang a subscription off. Both go through the one builder, so the sentence
an agent reads and the chip the human sees are one derivation.

### `{about:"entities"}` slims; `{about:"entity"}` details

The list arm carries id + generator + footprint per row plus a top-level `entityTotal`; everything
else an entity knows — seed, region, frozen/baked, what it placed — is the detail arm's, one
entity at a time, answering `entity: null` for an id no entity carries. The detail shape is a
SUPERSET of the summary rather than the fields the summary lacks, so an agent that asked about one
entity never has to hold the list row beside the detail.

**No numeric cap was added anywhere: the split IS the size answer**, and a cap would need a
measurement nobody has taken. `entityTotal` equals the row count exactly today and the doc says
so — it is the SIGNAL SLOT a bound would need, put in before rows start being cut rather than in
the same change that starts cutting them.

### `{about:"generators"}` relays the registry

Every generator's `id`, `name`, `paramSchema`, `defaults`, `placesProps` and `usesSeed`. An agent
could NAME a generator and not read its params, so it could compose and not tune.

**A tenth tool was the honest shape and was declined**: a registry catalogue is not a spatial
question, and `generator_list` would have been the fitting name — but it spends the door's last
budgeted slot permanently, so the next verb that wants it would argue against a full door. The
stretch is conceptual and the slot is not.

**It is a PASS-THROUGH where the entity arms project**, and the hazard of a pass-through is that a
member added for the panel's sake reaches an agent without anybody deciding it should — so
`packages/editor/tests/field-host/query.test.ts` pins the exact key set. The projection has ONE
home: the facade's `listGenerators` delegates to the same builder the query uses, because two
spellings would drift the day an archetype rule changed.

### `{about:"flags"}` — the advisor's findings

`total` and `byKindSeverity` over every deduped finding, `findings` rows for the CANDIDATE
severity band only, capped at `MAX_REPORTED` with `truncated` beside them, and `pending`. Four
decisions are worth the sentences:

- **Unfiltered, deliberately.** It reads the flag store's rows and NOT the visible summary,
  because "visible" answers what the HUMAN's filter chips admit and the chips default two bands
  OFF — an agent answered through that lens would silently lose whatever the human had hidden. The
  dedupe and the verdict join are the store's own, so a row read here and a row resolved by key
  cannot disagree ([advisor](advisor.md)).
- **`unreachable` is TRI-STATE and stays that way on the wire.** ABSENT means no reachability
  flood has visited the finding — the mixed-vintage steady state of a per-chunk advisor beside a
  whole-world pass, and the permanent state of every pit. Absence is "unknown", never "reachable";
  collapsing it to a boolean would have been a false negative wearing a tag's clothes.
- **`pending` is the freshness anchor.** The advisor is LIVE rather than computed at bake, so
  there is no bake to be stale against; what is honest is the count of passes still owed an
  answer. **Its zero is two states and the answer cannot separate them**: the count returns 0
  whenever no agent profile is in hand, so a project without `catalog/agent.json` reads
  `{total: 0, pending: 0}` forever. That is documented at the member rather than papered over, and
  the arm deliberately does not carry a second freshness fact about a different subsystem.
- **What the arm does NOT relay, discovered by using it.** The rows carry kind, severity,
  position, tri-state `unreachable` and any mover verdict — but NOT standability, which is the
  second leg of the "walkable ground" definition. Because `low-clearance` anchors on the OFFENDING
  NEIGHBOUR, candidates score zero on walkable ground across every world the analyzer covers, and
  the arm relays them as `severity: "candidate"`, indistinguishable from a genuinely actionable
  finding — enough of them to blow `MAX_REPORTED` and set `truncated: true` on the rows that
  mattered. **Building the door was necessary and not sufficient.** Filed with the filter/rollup
  design at `docs/backlog/editor-and-tooling/advisor-answers-volume-not-questions.md`.

### It writes nothing an answer depends on

Nothing on any path touches the store, the log or the undo stacks, and every box handed out is a
copy. The one hedge is exact: the footprint dep fills a signature-keyed memo of a pure log
derivation, which changes nothing observable and is why that dep is taken as a CALL. That is what
makes `readOnlyHint: true` on this row true rather than aspirational — and **the pin behind it
compares chunk CONTENTS, not chunk count**, after a review measured that a size check stays green
over a write into an already-allocated chunk (which is every chunk a probe walks through).

## The mutation seam

**Three doors, and only one of them is new machinery.** `edit.apply` and `generate` are answerer
rows reaching two `FieldHost` members; `action.run` is a door onto the verbs the editor already
had ([action-registry](action-registry.md)). All three are brokered commands on the existing
backchannel — same ask, same correlation table, same typed refusals — because a write does not
need a different relay from a read.

### `applyOps` is a composition, not a capability

It rides core's `field.logApplyGroup`, whose TSDoc names this exact caller. **One batched verb
rather than one per op, deliberately: the group is ONE undo entry, so an agent's batch is one ⌘Z
for the human.** That is the named-stroke guardrail, and it is unchanged by attribution — a batch
is still one entry, and attribution now says whose entry it is.

**The failure posture is the whole design, and it is the OPPOSITE of the interactive one.** The
tool commit path catches every setup-loud throw, reports it on the host's own channel, and DROPS
the op — right for a pointer drag, where a human is watching and a throw out of `pointerdown`
would strand the gesture mid-capture. None of that holds for a caller with no canvas. `applyOps`
**returns** its refusal, typed, and says nothing out loud: **an agent-caused refusal must not
interrupt the person in the tab.** What it DOES copy is the two visibility lines — the dirty-set
mark and the history notify — because a write that skipped either would land in the store and be
invisible, and an agent's edit must be the same event to every surface as a human's.

**The residue is declared, not fixed.** `logApplyGroup`'s all-or-nothing covers VALIDATION only.
`applyOps` tells the two cases apart and answers them differently, and **the discriminator is
structural, not prose**: a pass-1 rejection is wrapped with `cause` set and nothing else in that
file sets one, so `cause !== undefined` IS "validation refused this before touching the store".

- A pass-1 rejection is `refused(…, "input")` — nothing moved, fix the op.
- A pass-2 applier throw is **`failed`**, because the caller's argument is not what broke and the
  world is NOT fine; its message carries what no caller could otherwise discover — the ops before
  the failure are written, unrecorded and UNMESHED.

An earlier version lumped both onto `"input"` under a docblock asserting they *"cannot be told
apart"* — a claim the cited code disproves, and one that made the verb lie in exactly the case
that matters most.

### `generate` commits atomically and opens no session

The interactive stamp route opens one — or, with nothing selected, arms region-draw and waits for
two clicks that never come from a caller with no pointer. Worse than useless: a session left
standing refuses `world.bake` and every family key with it. So `generate` calls core's commit
directly — what the interactive path calls at its END — and touches session state at no point.

Every default is READ and never invented: params from the def's own `defaults` (overlaid, so
naming one keeps the rest), seed from a fresh roll, region from the current selection. **With no
region and no selection it REFUSES** rather than inventing a box at the origin — a silent guess at
the one input that decides where the world changes is the class of default that produces a
confident commit in the wrong place. The outcome is **the committed record READ BACK** — entity
id, generator, seed, region, params — never an echo of the request, so a caller that named no seed
can still reproduce what it made.

**`generate` classifies failures differently from `applyOps`, and the asymmetry is deliberate.**
Its catch covers arbitrary generator code, so the throws behind it span the caller's params, a
defect in the DEF, and a bug in the generator itself. Those disagree about whose fault they are
and nothing structural separates them, so the honest class is the one claiming nothing: `failed`.
Under `"input"` an agent meeting a broken def would retry with different params for ever. The two
causes it CAN attribute — an unresolvable id and a missing region — are settled before the call
and keep `"input"`.

### Both write verbs refuse under a live stamp session, and it is one rule

A session holds a GHOST computed against the store as it stands, and the commit then runs from
those same inputs, so **the ghost IS what will land** — with one exception, a store that moved
underneath the preview. The brush is suspended for the whole of a session, so the interactive path
cannot reach that state; a caller that is not the pointer is the only one that can. Both verbs
write cells, so the mechanism does not distinguish them and neither does the refusal. **A PENDING
stamp is not a session and deliberately does not block:** nothing has been evaluated, so there is
no ghost to invalidate.

### `edit.apply` and `generate` are NOT registry rows

That is a product decision. The command palette renders every descriptor, so a row would put
"Apply ops" and "Generate" in front of a human as commands they cannot meaningfully invoke —
nobody types a JSON op list into a command palette. What a row would have bought is the gate, and
the host applies the only clause of it that means anything for a write (the live-session refusal
above). It would also have forced `generate` to discard the entity id, since the `ok` result is a
payload-free frozen singleton and widening it would make most of the table carry a meaningless
field.

### `action.run` builds no allow-list and holds no deny-list

Which ids EXIST is the registry's answer, and one funnel knows the table — it refuses an unknown
id as `input` and names the verbs that do exist, because the caller cannot see a menu. Which ids
are ADVERTISED is this door's separate choice.

The daemon validates the half it can: the ids with an input schema have it applied from
`packages/editor/src/action-registry/schemas.ts`, which makes the daemon the first consumer of
that directory.

**The dispatcher ref is the one new chrome seam.** `action.run` travels through a ref that the
action-context provider fills — the session-state ref's shape exactly, one verb over, and for the
same reason: the ctx is assembled far below the mount point. The two together are one ref to READ
the session and one to DRIVE it, both closing over the same ctx, so **an agent's picture and an
agent's actions cannot come from different assemblies of the chrome.**

### `session_interrupt` — the Esc key as a verb

It calls `FieldHost.escape`, which drains exactly ONE rung of the recency-ordered capture stack
([interaction](interaction.md)) — a session, a stamp arm, a half-drawn box or segment anchor, the
selected entity, the cell selection. `escape` RETURNS whether it cancelled anything, which is what
makes the refusal writeable: nothing standing is `refused` with `because: "inert"`, so an agent can
tell a cancel from a no-op.

**It cannot stop a bake, a save or an analyzer pass** — there is no `AbortController` anywhere in
this editor, and a verb that accepted the call and did nothing would be worse than one that does
not exist; the honest answer for a long job is the ask budget's `session-timeout`. Its row carries
that limit.

Drain-one-rung is the shipped scope: a verb that emptied the stack would take away states the
HUMAN put there with nothing in the payload warning the agent it was about to.

**Two spellings, and which one the door advertises.** `action.run {id: "session.escape"}` reaches
the same host verb: it is a registry row (the human's Cancel) and it is never disabled. The
overlap is structural — `action.run` is a door onto the whole table by design — but the two are
NOT equivalent: the registry verb hands off and answers `ok` whether or not anything was
cancelled, while `session_interrupt` reads the boolean and refuses. **`session_interrupt` is the
advertised spelling; the `action_run` row's prose does not name `session.escape`**, and that
absence is machine-checked.

Making the registry verb refuse instead would speak a PERSISTENT error toast at the human every
time they press Esc with nothing standing, which is what that row's *"an Esc with nothing to
cancel is a no-op rather than a refusal"* stance exists to protect.

### `viewport_capture` answers an IMAGE block

The chrome base64s the PNG because an answer is JSON and JSON has no bytes; the door's presenter
is where the decode landed. The `png` member is destructured OUT and everything else (`width`,
`height`, `view`) rides a text block beside the image, so the base64 is carried exactly once. Left
as text it would have been roughly a megabyte in a model's context per call, with
`isError: false` the whole time.

## Presence — the chrome says an agent is here, and nothing else

The backchannel is invisible where REFUSALS and questions are concerned: an agent's business must
not interrupt the person in the tab, so no toast, either way. But a world changing under someone
with no sign that anyone else is working in it is a worse silence than the one that rule was
written against.

So `packages/editor/src/frontend/lib/agent-presence.ts` records **that a verb ran and which one**
— a framework-free store — and the status bar shows it, first in the right-anchored cluster (its
text moves oftenest, and an element's width change displaces only what is to its LEFT).

**The store is App's, not the module's**, and that is the one ownership decision here that was
made twice. A module singleton was written first, and the full suite failed within the task,
because every chrome test file is a second shell in one process and a case asserting "no agent has
been here" read the verb an earlier FILE had recorded. The chrome already has that rule written
down: cells are per provider, *never module-level*. So `App` holds it and it rides the editor
context, which makes every test isolated by construction and the absence pin an ABSOLUTE rather
than a delta.

**Four things it deliberately is not**, each a fence rather than an omission:

- **not a chat surface**;
- **not an outcome channel** — the record takes no result, so a refused write and an applied one
  are identical here, which is the quiet-refusals ruling built into the shape rather than
  remembered at a call site;
- **not attribution** — the chip is not where authorship is read;
- **no timestamp**, because a fading indicator would have to answer "has the agent left?", which
  this substrate cannot — an agent that stops asking is indistinguishable from one that is
  thinking, and the claim is what actually knows.

It is recorded AFTER the registry lookup, so a method the tab does not serve (version skew) never
reaches the bar: that is a refusal, not a verb.

## Attribution — the origin tag, and what an agent may undo

**`AGENT_ORIGIN = "agent:mcp"` is the editor's one origin tag**, and it lives in
`packages/editor/src/shared/wire.ts`. Absent = human is core's convention, so the chrome's own
surfaces dispatch with no tag at all and a human's ops and entries stay byte-identical to their
pre-attribution form.

**It is ASSERTED at the session-answerer seam, never relayed**, and that is the whole of the trust
argument. Everything arriving over the backchannel is agent-initiated by construction, so the tab
can state authorship rather than believe a claim: the three tab-side answerers that commit —
`edit.apply`, `generate` and `action.run` — pass the constant themselves. **No request type on the
wire carries an `origin` field, deliberately; an agent cannot spell one.**

For `action.run` the tag is a **DISPATCH argument rather than a member of `input`**, for the same
reason: `input` is the caller's, relayed unparsed, so an origin living there would be something
the agent DECLARES, where this is something the tab ASSERTS about where the call came from. **The
two must not share a channel.**

### The ownership guard

`FENCED_ACTIONS` — the daemon-side deny-list that refused `edit.undo`/`edit.redo` for every agent
— **is gone.** The session handlers hold no opinion about which verb an agent may name, and
`invalid-input` at this edge is schema-only.

In its place, `stepsOwnWork` in the chrome's actions module reads the top entry's `origin` off the
named stack and compares it to the dispatch's. **The guarantee is weaker than it first reads, and
the source says so where it lives: the comparison is against ONE shared tag, so what the guard
promises is AGENT-AUTHORED, not "your own".** Two concurrent agents are indistinguishable here and
each can step the other's top entry. **What holds absolutely is the direction that matters: the
human's entries carry no origin, so no agent ever pops one.**

Three properties are decisions rather than details:

- **Humans are not guarded, and the asymmetry IS the policy.** A chrome dispatch carries no
  origin, so the guard passes every one of them: the person owns the world and steps anything in
  it, an agent's work included. Guarding both directions would lock someone out of undoing what an
  agent just did in their own tab — the exact failure the fence existed to prevent, pointed the
  other way.
- **Only the TOP entry.** There is no "undo my last op wherever it is": burrowing into the stack
  is a compensating-op problem, not a history-step one, and the refusal names the remedy an agent
  actually has — apply the inverses as new content.
- **It runs AFTER `enabled`**, so an empty stack answers the inert hint rather than a sentence
  about the author of an entry that does not exist. A null host falls through rather than refusing
  here, leaving the no-engine sentence to the host hand-off seam — one refusal per condition.

**The residue: a STALE TAB under a restarted daemon.** The fence lived daemon-side on a property
the guard does not have — *a daemon-side fence holds regardless of what the tab believes* —
because `bun run edit` restarts the daemon on every source change while an open tab keeps the
bundle it booted with. That property is knowingly given up, not overlooked: **a guard that reads
state cannot live where the state is not, and the state is the tab's.** The residue is bounded by
exactly two facts, and neither of them is "an agent will be careful":

1. the exposed loop is single-user local dev — an agent driving a tab that outlived a daemon
   restart;
2. an errant step is **NON-DESTRUCTIVE** — the entry moves to the other stack and ⇧⌘Z brings it
   back; losing it takes a further mutation to clear the redo stack.

**It is NOT mitigated by the bundle-outdated watcher.** That watcher covers the CONSUMER's
extension source, and only when the project config names one ([change-feed](change-feed.md)), so
an edit to the editor's own chrome emits nothing and reloads no tab.

### `session.confirm` commits are left UNSTAMPED, whoever triggers them

Its commits carry no attribution at either altitude, and no one can step them through the guard.

**The reason is MIXED AUTHORSHIP.** A staged session is not one party's work: a human stages it —
the region, the params, the generator, the grab — and whoever calls confirm merely triggers the
commit that was already composed. Stamping such a commit as the agent's would hand the agent undo
authority over human-staged content, which is the one direction the whole scheme forbids. Leaving
it unstamped fails the other way, and that way is benign: an agent that grabs an entity and drops
it with a confirm cannot undo its own move. It asks the operator, exactly as the guard's refusal
already tells it to.

*"Whose work is a confirm"* is an open follow-up, not a settled answer — the honest reading is that
a confirm has two authors and the log has one field for them.

## What the door does NOT do

- **No attribution is surfaced to the human.** Showing who authored an entry is blame UI and is
  nobody's job yet.
- **No "added since your last look" rung** on the history read: the log attributes entries, it
  does not diff them for a reader.
- **No second origin tag.** The editor asserts exactly one, and a multi-agent vocabulary would
  want the claim to mint it rather than a constant to spell it.
- **Core stays POLICY-FREE.** Its `undo`/`redo` read no `origin` and the stacks arbitrate nothing;
  the only core code that reads the field is compaction's run-boundary predicate, which exists to
  PRESERVE attribution across a fold rather than to act on it.
- **An agent has no route to a param schema except `{about:"generators"}`**, and `generate`
  advertises `params` as a free-form object because that is what `dispatch` enforces. Mitigated by
  construction: every param has a default, so a params-free call is complete, and the generator
  lookup names the registered ids in its refusal.

## Two costs measured rather than paid

- **Constructing any MCP SDK `Protocol` object** — client or server, no transport, no HTTP, no
  request — inflates the wall clock of the rest of that `bun test` process by multiples, enough to
  drag several `@furnace/core` budget tests over ceilings they otherwise clear by an order of
  magnitude. Eliminated by measurement rather than argument (not the transport, not Ajv, not SSE,
  not GC, not module load — the daemon imports the SDK on every run and the suite is unaffected
  with the door mounted and unexercised). So `packages/editor/tests/mcp.test.ts` spawns a probe in
  a **fresh runtime**, which performs every exchange and prints one JSON transcript the cases
  assert on. Nothing in `src/` changed to accommodate it. The table and the eliminations are at
  `docs/backlog/editor-and-tooling/mcp-sdk-construction-slows-the-process.md`.
- **The cost was removed from the TEST process, not from the daemon.** The production daemon still
  constructs a server and a transport per POST, and **nobody has measured a daemon that has
  actually served MCP traffic.** Nothing predicts a problem, and nothing has looked.
