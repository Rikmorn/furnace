---
summary: The one dispatch choke point every client funnels through, and the command table with each verb's input schema and return.
verified: 2026-08-18
---

# Commands

`packages/editor/src/daemon/handlers.ts` builds a `Map<string, Handler>` where each `Handler`
is `{ input: ZodType, run(input): Promise<unknown> }`. `dispatch(handlers, command, input)`:

1. unknown command → `EditorError("unknown-command")`;
2. `handler.input.safeParse(input)` fails → `EditorError("invalid-input", …)` naming the
   first failing path;
3. otherwise runs the handler with the parsed input.

Every client — the chrome, a curl, the MCP door — funnels through `dispatch()`, so input
validation lives in exactly one place. All input schemas are `z.strictObject(...)`, so extra
keys are rejected.

**The agent door is no exception.** `packages/editor/src/daemon/mcp.ts` projects
<!-- derive: grep -cE '^ +command: "' packages/editor/src/daemon/mcp.ts -->9<!-- /derive -->
commands as tools and FORWARDS the caller's arguments into `dispatch()` rather than composing
its own, so a tool's advertised input schema and the schema that actually decides cannot
drift apart in silence — an invented argument earns `invalid-input` at the agent door exactly
as it does over HTTP. The advertisement is not merely consistent with the validator but
**derived from it**: each row's document is `z.toJSONSchema` over the command's own zod,
resolved once at door construction.

## How many, and who speaks them

There are
<!-- derive: grep -rhoE 'handlers\.set\("' packages/editor/src/daemon/ | wc -l | tr -d ' ' -->19<!-- /derive -->
commands — the dotted families plus one bare verb (`generate`) — and the chrome speaks
<!-- derive: grep -ohE '"[a-z]+\.[a-zA-Z]+"' packages/editor/src/frontend/lib/api.ts | sort -u | wc -l | tr -d ' ' -->12<!-- /derive -->
of them (`packages/editor/src/frontend/lib/api.ts`). The ones it does not are
`session.state`, `viewport.capture`, `session.query`, `edit.apply`, `generate`, `action.run`
and `session.interrupt`, and none of them has a client method on purpose: every one is a
question or an instruction the daemon relays INTO a tab, so a chrome method would be a tab
addressing itself.

Derive the two rosters and diff them:

```sh
grep -rhoE 'handlers\.set\("[^"]+"' packages/editor/src/daemon/ | sed 's/handlers.set("//' | sort
grep -ohE '"[a-z]+\.[a-zA-Z]+"' packages/editor/src/frontend/lib/api.ts | tr -d '"' | sort -u
```

The surface is deliberately thin: **the daemon owns bytes and the filesystem, the browser
owns the world.** Nothing here holds a document, a schema or a generator.

## The `session.*` family answers by caller

`session.*` is the only family whose answer depends on **which caller is asking** rather than
only on what it asked. Three of its members carry a connection `token`
([change-feed](change-feed.md)) — `session.claim`, `session.steal` and `session.release`, the
three that act ON a connection. The rest take none: `session.state`, `session.query` and
`session.interrupt` address whoever is CLAIMED rather than a named connection, and
`session.answer` names a pending ask instead. Derive the family and its token carriers:

```sh
grep -rhoE 'handlers\.set\("session\.[^"]+"' packages/editor/src/daemon/ | sed 's/handlers.set("//' | sort
grep -nE 'token: sessionToken' packages/editor/src/daemon/session-handlers.ts
```

- `session.answer` is the **only command the daemon is the logical originator of** — it is
  the return leg of a question the daemon asked, and it names a pending ask rather than a
  connection, so it carries a `requestId` instead.
- `session.state` is the **only command the daemon cannot answer**: it relays the question to
  whichever session is CLAIMED and hands back what that session said, so naming a connection
  would let a caller read a tab the human is not in — the failure the claim exists to
  prevent.

## The table

| Command | Input schema | Returns |
| --- | --- | --- |
| `project.get` | `{}` | `{ root }` — the absolute project root; the chrome scopes its persistence store by it. |
| `field.load` | `{ name }` (`WORLD_NAME_RE`) | `{ manifest, chunks, materials, oplog }` — one root-contained read of `worlds/<name>/`: the manifest, every chunk and `.mat` sibling as base64, and `oplog.json` (or `null`). |
| `generation.bake` | `{ files: WireFile[], cleanDir?: string }` (each file `{ path, encoding: "utf8"\|"base64", contents }`) | `{ files: <count written> }` — writes a browser-uploaded, root-contained file set and emits `generation-baked`. |
| `world.list` | `{}` | Every world under `worlds/`, read-only, with a **`tracked` tri-state** per row. |
| `world.makeDefault` | `{ name }` | `{}` — points `worlds/index.json` at an existing world (manifest-checked); emits `worlds-changed`. |
| `world.delete` | `{ name }` | `{}` — removes a world directory. **Refused for the current default**, and refused outright when `worlds/index.json` exists but is unparseable, because then it cannot tell whether this IS the default. Emits `worlds-changed`. |
| `world.rename` | `{ from, to }` | `{}` — case-insensitive-FS aware; emits `worlds-changed`. |
| `world.duplicate` | `{ from, to }` | `{}` — copies a world under a new name; `already-exists` (409) if the target is taken. Emits `worlds-changed`. |
| `session.claim` | `{ name: string \| null, token }` | `{}` — this connection is now the editing session for `name` (`null` = the untitled scratch). Refused `already-exists` (409) when a DIFFERENT live connection holds it; `no-session` (409) when the token names no live connection. Re-claiming a world this connection already holds succeeds. |
| `session.steal` | `{ name: string \| null, token }` | `{}` — takes the world whatever anyone else thinks, and sends the displaced connection a `claim-lost` frame. Never refuses on held-ness (an unheld world is simply claimed); `no-session` on a dead token. |
| `session.release` | `{ token }` | `{}` — drops whatever this connection holds. Reached on one path: a claim that RE-KEYS on a world switch can be REFUSED, and the daemon drops the old key only when a new claim succeeds — so without a release the tab would go on holding the world it just left. Never carries a `name`: the connection is what holds, so the connection is what is dropped. |
| `session.state` | `{}` | The claimed session's `SessionState` (`packages/editor/src/shared/wire.ts`), RELAYED. A discriminated union on `ready`: the not-ready arm carries nothing but the discriminant (the engine bundle is async and a tab is claimable before its field host exists, so an empty-looking world would be a false claim of emptiness), and the ready arm carries `cursor`, `world`, `armed`, `brush`, `session`, `selection`, `selectedEntity`, `camera`, `stats` and `history`. **No token and no input** — it addresses whoever is claimed, so zero and many both refuse with `no-session`, a silent tab earns `session-timeout`, and the daemon validates nothing on the way past: it cannot compute one field of this, which is the whole reason the backchannel exists. `cursor` is an opaque compare-only change token that rides the history payload. |
| `viewport.capture` | `{ view?, size?, overlays? }` | `ViewportCaptureResult` (`packages/editor/src/shared/wire.ts`) — a base64 PNG of the live viewport plus the `width`/`height`/`view` it actually produced, RELAYED. A command the daemon cannot answer, and one of the two carrying a **raised ask budget** (`CAPTURE_ASK_TIMEOUT_MS`, above `DEFAULT_ASK_TIMEOUT_MS`), because this ask makes the tab render, read back off the GPU and encode, where every other method reads a record it is already holding. `view` is validated against `CAPTURE_VIEWS` and `size` against the same bounds the host clamps to (`packages/editor/src/shared/capture.ts`) — the daemon REFUSES out of range where the host clamps, because a schema is also what the MCP door advertises. |
| `session.query` | `{ about: "entities" }` \| `{ about: "ray", origin, dir, maxDist? }` \| `{ about: "selection" }` | `QueryAnswer` (`packages/editor/src/field-host/field-query.ts`), RELAYED — the spatial read, and the answer to *ask this, do not squint*. `entities` returns every committed entity with its footprint plus the placed-prop LINT (floating props with their measured gap, interpenetrating pairs with their penetration extents, and a `truncated` flag so an empty list cannot read as a clean world); `ray` returns one `raycastField` hit with its distance; `selection` returns the replayable `SelectionSpec`, count and box — **never the cells**. A `z.discriminatedUnion` per arm, so a bad request reports against the arm it MEANT. **No budget of its own** (store and log arithmetic, with a measured cap on the only quadratic part). `maxDist` is bounded at `MAX_PROBE_M` where `raycastField`'s own step ceiling would otherwise make a `null` ambiguous (and CLAMPED again in the host, so the module's contract does not depend on this door); `dir` is refused as the zero vector, which `z.number()` alone admits and core would silently turn into a walk along +X. |
| `edit.apply` | `{ ops: BrushOpInput[] }` (`.min(1)`, full op vocabulary — `packages/editor/src/daemon/op-schema.ts`) | `ActionResult`, RELAYED — a batch landing as ONE undo entry for the human. The daemon validates the op SHAPE in full because a write arriving malformed and relayed anyway asks a tab to mutate a world nobody checked; core decides whether the shape is BUILDABLE. No budget of its own: the cost is bounded by the list the caller sent. |
| `generate` | `{ generatorId, params?, seed?, region? }` | `GenerateOutcome` (`packages/editor/src/field-host/field-mutation.ts`), RELAYED — one generator committed atomically, opening no stamp session and leaving none. `params` is `z.record(z.unknown())` and that is the honest ceiling: per-generator schemas live in core's registry, which this Node-portable daemon may not import, so core validates them at commit. Carries a **raised ask budget** of its own (`GENERATE_ASK_TIMEOUT_MS`, a separate constant from the capture one so the two are free to move apart) — a generator's `evaluate` runs on the tab's main thread. |
| `action.run` | `{ id, input? }` | `ActionResult`, RELAYED — the named-verb door onto the editor's own <!-- derive: grep -cE '^ +id: "' packages/editor/src/action-registry/descriptors.ts -->39<!-- /derive --> verbs. Builds **no allow-list** (which ids exist is `runNamedById`'s answer) and **no deny-list**: this handler holds no opinion about which verb an agent may name, and undo ownership is refused one bundle away by the tab's own guard. The ids with an input schema have it applied here, from `packages/editor/src/action-registry/schemas.ts`. |
| `session.interrupt` | `{}` | `ActionResult`, RELAYED — the Esc key as a verb. Drains **one** rung of the host's Esc capture stack (the most recent standing thing: a session, a stamp arm, a half-drawn anchor, the entity or cell selection) and refuses `inert` when nothing is standing, so a caller can tell a cancel from a no-op. **It cannot stop a bake, a save or an analyzer pass** — nothing in this editor is abortable, and the honest answer for a long job is the ask budget. `z.strictObject({})`: the stack is ordered by recency and addresses nothing by name, so there is no parameter to take. |
| `session.answer` | `{ requestId, ok: true, payload }` \| `{ requestId, ok: false, error }` | `{ delivered }` — hands one answer to the backchannel ask it names (`packages/editor/src/daemon/backchannel.ts`). **No token**: the `requestId` was minted into exactly one connection's stream, so holding it means holding that stream — the same structural argument the token itself rests on. `delivered: false` is the honest report for an id naming no pending ask (an answer that lost the race with its own ask's timeout, a duplicate, a forged one), not an error — refusing would manufacture a client-side failure for a designed race. A discriminated union so a refusal cannot pose as a success with a missing payload. |

## Two shared guards

**One world-name schema.** `field.load` and every `world.*` verb share
`z.string().regex(WORLD_NAME_RE)`, and `packages/editor/src/daemon/worlds.ts`'s top comment
tracks the other copies of that regex.

**`field.load` reads siblings through one guard.** `readSiblings` is a single root-contained
base64 reader used for BOTH sibling kinds (chunks and `.mat` materials), so the containment
check is applied identically; a copy per kind is how one path's guard drifts. A path escaping
the root is `outside-root` (404), and a dedicated path-traversal rejection test guards it.

## `generation.bake` — the browser produces the payload, the daemon only writes it

A determinism probe found that regenerating the same seed under a *different JS engine* than
the one that previewed it produces a different world placement: bun/JSC and node/V8 diverge on
the transcendental `Math` used to place pieces
(`docs/learnings/2026-07-06-cross-engine-placement-determinism.md`). So "the daemon
regenerates from the seed" would bake a world that does not match what the user saw. The
browser bakes in its own engine and uploads the produced file set; **the daemon holds zero
generator knowledge.** `run`:

1. resolves every `path` against the project root and rejects the **whole batch before any
   write** if any escapes the root or contains a dotfile segment (`outside-root`, 404);
2. when `cleanDir` is given, validates it (root-contained, never the root itself, no dotfile
   segment, and **every** payload file resolves under it) and `rm -rf`s it BEFORE any write —
   clean-previous-bake, so a smaller re-bake leaves no orphans from a larger earlier one; a
   mismatched payload throws and leaves the FS untouched;
3. writes each file — `mkdir -p` the parent, base64-decode when `encoding === "base64"`
   (binary `.fmesh` sidecars ride as base64 in the JSON POST);
4. emits `generation-baked` (`{ files: <count> }`) over SSE and returns `{ files: <count> }`.

The `path` `.min(1)` guard is load-bearing: an empty path resolves to the root dir and would
hit `writeFileSync(rootDir, …)` → `EISDIR` mid-batch, a partial write. The browser marshals
binary sidecars via `toWireFiles`
(`packages/editor/src/frontend/lib/generation.ts`, chunked base64 so a large sidecar cannot
blow the `String.fromCharCode` argument stack).

This was the first handler to emit an SSE event, which is why `HandlerContext` carries an
`emit(event: DaemonEvent)` field that `server.ts` fills with `hub.emit`; the `world.*` verbs
use the same field. The command is destination-agnostic (root-contained + `cleanDir`), which
is why the world verbs needed tests rather than changes when `worlds/<name>/` became the
destination.
