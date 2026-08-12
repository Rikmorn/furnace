# Editor Architecture

The as-built `@furnace/editor` package: **how the editor IS today**, at the F4.5 seal
(2026-08-03). The editor is a **field authoring tool** — one full-window canvas with an
overlay cockpit floating over it, a Node-portable daemon behind it, and no engine of its
own. The decision history that produced it lives in
`docs/backlog/editor-and-tooling/editor-backend-architecture.md`; this doc describes the
running system.

**Read it in two halves.** §1–§8 are the DAEMON and the serving contract — the parts that
have been stable since M3/M4 and that no chrome rewrite touches. §9–§18 are the FIELD
authoring tool: the inspector module, the field host and its workers, and the three F4.5
slices that made the chrome what it is. §19 lists what is deferred, and **§20–§24 are the
foundations T3 tranches** — T3a's framework primitives (§20), T3b1's five cluster extractions
and the layer chain (§21), T3b2's single-source tool and action tables (§22), T3c's
session/gesture machine and tool registry (§23), and T3d's finished facade plus the T3 exit
table and the objectives audit's rulings (§24) — the field host's decomposition, slice by
slice. **§25 is foundations T4a**, which decomposes nothing: it hardens the substrate an agent
is about to be pointed at. They sit after Deferred rather than before it because section
numbers here are append-only. *(T3d was missing from this paragraph until T4a — the tranche
appended §24 and did not amend the sentence that indexes its neighbours.)*

**What was cut, and where it went.** The editor once had a dockview chrome, a
scene-document surface (entities panel / inspector panel / GPU-id picking / translate gizmo
over a `ViewportHost`), a preview host, a World panel and a generation worker. F4.5a deleted
all of it. **Foundations T2 (2026-08-05) then deleted the daemon half too** — the `scene.*`
command family, the mutable document session, the pure mutation set, the Node-side registry
bundle and the scene-file watcher — in the same tranche that deleted `@furnace/core/scene`
itself. There is no scene document anywhere in furnace now: the field artifact IS the
content model. Sections describing deleted code are **gone from this doc** rather than kept
as marked-stale history — the surviving mechanisms were folded into the sections that own
them now (the inspector module into §9, `generation.bake` into §4, the promoted pure-math
modules into §14 and §17.3). The session's transactional `apply` design outlived its code as
a donor pattern: `docs/learnings/2026-08-05-session-apply-transactional-pattern.md`.

**Section numbers are stable and are never renumbered** — seals and backlog entries cite
them. T2 left two vacancies rather than shifting everything after them: §4 lost its
subsections (§4.1–§4.3 collapsed into one flat section) and **§10 (scene-loader coverage) is
retired**, since the built-in registry it tabled no longer exists.

**Lineage**, for anyone reading a commit or a seal entry and looking for its landing
place here: M3 (shell) + M4 (command layer) + M5A/M5B (the retired scene surface) built
§1–§8; the M1-slices batch built the core-side loader coverage (retired §10); Epic 3's
3.0/3.1/3.2 slices opened the procedural-authoring axis; the **One Field** phase built the
field tool —
F1+F2a (§11), F2b (§12), F3a (§13), F3b (§14), F4 (§15) — and the **F4.5 stage** rebuilt the
chrome over it in three slices: F4.5a the shell (§16), F4.5b the hands (§17), F4.5c the
finish (§18).

## 1. What the editor is

`@furnace/editor` is a **devDependency** of the consumer plus a long-running local daemon and a browser-served chrome. It is not a binary and not vendored into anything: the consumer adds it to `devDependencies` and runs it with a command, the Storybook/Vite model.

The editor contains **no engine**. This is the load-bearing invariant (called "project-first resolution"): every engine import — `@furnace/core`, the consumer's extensions, the field-host — is resolved and bundled *from the consumer's own `node_modules`*, never from the editor package's. The editor ships UI chrome and a daemon; the engine code is always the consumer's. (Verified: `packages/editor/package.json` declares `@furnace/core` only as a `devDependency`, used for types and the workspace symlink; the runtime engine bundle is built from the project root — see §3.)

**Dogfood / run command.** In `packages/hello-world`, `bun run edit` runs the `"edit"` script:

```
bun run --cwd ../editor build:frontend && bun ../editor/src/daemon/main.ts
```

It prebuilds the chrome (§7), then starts the daemon with the consumer's directory as the project root (`main.ts` uses `process.cwd()`). Source: `packages/hello-world/package.json` `"edit"`, `packages/editor/src/daemon/main.ts`.

## 2. The daemon

A **Node-portable** HTTP server. No `Bun.*` or `bun:*` anywhere in `src/` — enforced by the static scan in `packages/editor/tests/no-bun-leakage.test.ts` (regex-scans `src/` for Bun-API usage). It builds on `node:http`, `node:fs`, `node:path`, `node:crypto`, `node:os`, `node:url`; it runs under plain Node ≥20 and under Bun.

**Binding & lifecycle.** `startServer(opts)` (`src/daemon/server.ts`) creates a `node:http` server and listens on **`127.0.0.1`** only — one local single-user session. Port defaults to `4500` (`main.ts`), overridable with `--port`; tests pass `port: 0` to let the OS pick. `close()` tears down the server, the SSE hub, the extensions-directory watch, and the esbuild bundler context.

**The daemon's resident state — TWO tables of one kind, and no other** (foundations T4b,
2026-08-09). The **session claim** (`src/daemon/claims.ts`) records which SSE connection is
authoring which world; the **backchannel's pending asks** (`src/daemon/backchannel.ts`) record
which questions are out to that connection awaiting a `session.answer`. The claim is the first
daemon-resident state the editor ever had and the ask table arrived one task later — this
paragraph said *one* until the second existed, which is the correction rather than a
restatement.

Both reconcile with "the daemon stays stateless" rather than excusing it, and on the same
argument: **there is no DURABLE state here — each is the same class of thing as the subscriber
set beside them in `events.ts`.** A claim is born when a live connection asks for one and dies
when that connection departs; an ask is born when a command relays a question and dies when it
is answered, times out, or its connection goes. Nothing is written to disk, nothing is read back
at boot, and a restart begins with both empty because a restart begins with an empty hub. The
daemon still holds no document, no schema and no generator. See §5.1 for the claim's mechanics,
the connection token, and the runtime defect the wiring uncovered, and §26.1 for the relay.

**One check runs ahead of every route — the `Origin` refusal** (foundations T4a, 2026-08-09).
`route`'s first statement is `assertLoopbackOrigin(req.headers.origin)` (`src/daemon/origin.ts`):
a request that DECLARES a browser origin which is not this machine's loopback is refused
`403 forbidden-origin` (§6) before any branch runs — and before the request target is even
parsed, so the claim in this heading is literal rather than approximate.
It is **DNS-rebinding defence, and nothing else** — the loopback bind
stops a remote host reaching the port, but it does not stop a page the user merely visited:
`evil.example` can answer its own DNS with `127.0.0.1`, and the browser then issues requests
here believing them same-origin. The `Origin` header it attaches is the one thing that page's
JavaScript cannot forge. The MCP specification makes exactly this pair — validate `Origin`,
keep the loopback bind — a MUST for local HTTP servers (`docs/research/2026-08-08-t4-agent-editor-mcp-precedent.md`,
ruling 9), which is why it lands before T4 mounts an agent binding rather than with one.

It lives in its own module (`src/daemon/origin.ts`, ~100 lines) rather than in `server.ts`,
and the decisive reason is testing cost: extracted, the spelling table is a **pure unit test**
(`tests/origin.test.ts`, the way `errors.ts` is tested) instead of one live HTTP server per
row. `server.ts` keeps the WIRING question and answers it end-to-end, one case per route
branch. Three clauses decide the admission, each argued at `assertLoopbackOrigin` /
`isLoopbackOrigin`:

- **ABSENT passes.** curl, the CLI and a future MCP client over `node:http` send no `Origin`
  at all. **This is therefore not client authentication and must never be read as any** —
  anything that can omit a header could also have omitted a wrong one. It closes one class
  (a browser tricked into speaking for a stranger) and no other.
- **PRESENT-but-opaque refuses.** `Origin: null` — a sandboxed iframe, a `data:` or `file://`
  page — carries no provenance, and a `sandbox` attribute is one keystroke on the attacker's
  own page, so reading it as "absent" would hand back the bypass. Anything that fails to parse
  refuses on the same fail-closed rule.
- **Loopback is decided by PARSING, never substring-matching.** `http://127.0.0.1.evil.com`
  and `http://localhost.evil.com` are ordinary public hostnames that merely start with a
  loopback spelling. Parsing also buys canonicalization a table could not enumerate:
  `new URL(...)` case-folds the host, collapses IPv6 (`http://[0:0:0:0:0:0:0:1]` → `[::1]`),
  and normalizes the integer spellings of an IPv4 address, so `http://2130706433`,
  `http://0177.0.0.1` and `http://0x7f.0.0.1` all arrive as `127.0.0.1` and are admitted —
  correctly, since they ARE loopback.

**ONE AXIS DECIDES THE ADMITTED SET, and both of its clauses must hold: could a real local
caller PRESENT this spelling, and is it unmintable by the attack?** The second clause is the
security floor and it is absolute — an `Origin` derives from the NAME a page was loaded from,
never from the address that name resolved to, so a rebinding attacker (who controls DNS and
nothing else) can never mint *any* loopback name; holding one requires already running code on
this machine, which is strictly more than the attack being defended. Clause 2 therefore admits
every loopback spelling, and **clause 1 alone decides which are written down**: `localhost` and
`127.0.0.1` are the daemon's own two, `[::1]` is what a v6-bound local dev server presents, and
`https:` is what a TLS one presents. The rest of `127.0.0.0/8` fails clause 1 — servers bind
`127.0.0.1`, `localhost`, `::1` or `0.0.0.0`, not `127.0.0.2` — and so does a non-web scheme
that parses (`chrome-extension:`, `file:`), being an origin no local server serves. (An earlier
draft of this paragraph admitted `[::1]`/`https:` on a trust-class argument and declined
`127.0.0.2` on a no-caller one; each was defensible and together they were ad hoc. One axis,
stated once, is the correction.)

Nothing a human sees moved: the chrome is served BY this daemon, so it was reached over
loopback by construction and its `fetch` POSTs carry a loopback origin, while its
`<script>`/`EventSource` GETs carry none. Coverage splits by question: `tests/origin.test.ts`
holds the spelling table (12 admitted rows, 14 refused, each carrying why), and
`tests/server.test.ts` holds the wiring — the refusal on **all six** route branches (the sixth
is the T4b agent door, and it needs its own row precisely because it sits first on the ladder),
plus the loopback and absent cases.

**Then the request target is parsed, and that can fail** (foundations T4a, 2026-08-09).
`new URL(target, "http://localhost")` THROWS on targets the HTTP parser accepts — `//`,
`///////`, `/\` are each a protocol-relative reference with an empty host. Until T4a that
parse sat OUTSIDE `route`'s try, where the throw escaped an `async` function nobody awaits:
**measured, Bun left the socket open with no response and Node 22 took the unhandled rejection
as fatal and KILLED THE PROCESS** — a remote, unauthenticated daemon kill, one `fetch("//")`
from the very rebinding page the check above models. `requestUrl` now parses inside the try and
answers `400 invalid-input`; the pin asserts the server is still serving afterwards, which is
the half that matters. Node's behaviour is the one that governs, since the daemon must run on
plain Node ≥20.

**Routes** (matched in this order in `server.ts`'s `route`, all of them behind that check):

| Method + path | Behaviour |
| --- | --- |
| `<any> /mcp` | The **agent door** (foundations T4b, `src/daemon/mcp.ts`). A `POST` is handed to a freshly built MCP `Server` + streamable-HTTP transport, which reads the body itself and writes the whole response; **every other method gets `405` + `Allow: POST`** in plain text, since this endpoint opens no server→client stream. It matches on **path alone**, which is why it is FIRST: the `GET <anything else>` branch below is greedy, and a `/mcp` mounted after it would have its GET answered as a missing static file. |
| `GET /engine.js` | Builds and returns the browser engine bundle (§3) as `text/javascript`. esbuild build failure → `500` with the diagnostics as plain text. |
| `GET /api/events` | Subscribes the response to the SSE change feed (§5). Stays open. |
| `POST /api/<command>` | Reads the request body, JSON-parses it (`{}` if empty body; invalid JSON → `400 invalid-json`), and `dispatch()`es the command (§4). Always `200` with the handler result, or the error envelope on an `EditorError`. |
| `GET <anything else>` | Chrome first: serves a static file from the prebuilt chrome dir (§7), with a path-traversal guard. On a chrome miss, falls back to **project asset serving**: the path is mapped onto the project root (root-contained; dotfile segments and `node_modules` refused) so a project's root-absolute asset URLs resolve exactly as on the consumer's own dev server. This is how the chrome reaches the three project→editor catalogs (`/catalog/materials.json`, `/catalog/entities.json`, `/catalog/agent.json` — §11, §14, §15) and the archetype `/catalog/*.fmesh` meshes. Neither hit: missing chrome dir → `503` with a "run build:frontend" hint; otherwise `404`. |
| any other method | `404 not-found`. |

**Error handling.** The `route` body is wrapped in a try/catch: a thrown `EditorError` becomes `{ error: { code, message } }` at the code's HTTP status (`httpStatus`, §6); any other thrown value becomes `500 internal` with the error's message. **Ahead of both since foundations T4b sits the committed-response guard — `if (res.headersSent) { res.destroy(); return; }`** — because the `/mcp` branch returns with the response already written (measured: `res.headersSent` is true after every `handleRequest`). Without it a throw in that window makes `sendJson`'s `writeHead` throw a SECOND time from inside the one typed-envelope edge, and that throw escapes an `async` function nobody awaits — the same shape T4a's `requestUrl` closed, where Node takes the unhandled rejection as fatal and kills the process. Nothing in the branch throws there today, so the guard is unpinnable by a black-box test and is kept on that argument rather than on a red test. The `Origin` check sits INSIDE that try for exactly this reason — the catch is the daemon's one typed-envelope edge, and a second emitter beside it would be a parallel path to keep in step. There is **no request body-size cap** — by design, since the daemon binds localhost and serves a single user (`readBody` documents this; revisit if it ever accepts non-localhost connections). **Authentication is out of scope** and stays so: `forbidden-origin` is a rebinding refusal, not a credential check.

**What the daemon trusts, and where the untrusted bytes are actually checked.** Three things
are enforced HERE, and they are the whole list: the `Origin` (above), each command's zod input
schema at the one `dispatch()` choke point (§4), and root containment on every path a command
resolves (§4, `outside-root` in §6). Everything else the daemon touches, it does not
interpret — **it reads and writes bytes.** `field.load` base64s a world's chunks, `.mat`
siblings and `oplog.json` off disk and hands them to the browser without parsing any of it;
the daemon holds no schema, no document and no generator (§3), so it has no predicate to
apply. That makes the daemon the **untrusted edge** and puts the real validation boundary one
layer on: **`parseOps` in `@furnace/core/field` is where an oplog stops being bytes and
becomes typed engine objects, and nothing downstream re-examines them** — loaded ops go
straight into `log.ops` and never pass through `logApply`, whose appliers trust their input by
contract. Foundations T4a is the tranche that made that boundary true rather than nominal:
`parseOps` had checked every closed string union and no numbers at all, which was defensible
while an oplog was only ever something this machine wrote, and stops being defensible the
moment a shared world or an agent-authored log arrives (`core-modules.md` § *the oplog wire
format* carries the checked/unchecked list and the measured failure modes). The editor's own
authoring path is validated separately and more strictly, at commit time
(`assertOpValid`) — `parseOps` runs `assertOpStructure`, defined as that predicate's
table-independent half, so **an op the editor could commit can never fail to load**.

## 3. Project-first bundling — one target

The daemon builds the consumer's engine code in **one** esbuild bundle, resolving every import from the project root's `node_modules` so there is exactly **one** core / registry / zod instance (Branch A's instance-identity requirement). It was two until foundations T2: a second, node-platform *registry bundle* existed only to give the daemon `@furnace/core/scene`'s `validateDocument` for server-side mutation validation, and it went with the scene surface (below).

**The browser engine bundle** — `src/daemon/bundle.ts`, served at `GET /engine.js`. A virtual stdin entry imports the consumer's extensions (for their registration side-effects), re-exports the **one** engine host, and re-exports the consumer's extension module as a **namespace**:

```
import "<root>/<extensionsEntry>";                          // registration side-effects, when configured
export { createFieldHost } from "@furnace/editor/field-host";
export { getService } from "@furnace/core/registry";        // the consumer's service seam (T1b)
export * as extensions from "<root>/<extensionsEntry>";     // the consumer's public surface, when configured
```

esbuild bundles this `format: "esm"`, `write: false`, `sourcemap: "inline"`, with `resolveDir: root`. The bundler context is **incremental**: each `GET /engine.js` calls `ctx.rebuild()`. Build failure returns `{ ok: false, error }` carrying esbuild's formatted diagnostics.

`createFieldHost` is the editor's only host (§11); the scene viewport host and the Slice 3.1 preview host that used to ride beside it were deleted at F4.5a, and the directory that outlived them under the first one's name was renamed to match its one remaining occupant in T3b1 (§7). The `export * as extensions` is the **consumer-code seam**: it re-exports the same extension module the bare side-effect import already runs — so registration still fires exactly once — this time as a value namespace worker code can call the consumer's own functions through. When no extensions entry is configured the bundle emits `export const extensions = {}`. `EngineModule` (`frontend/lib/engine.ts`, the `loadEngine()` return type) is correspondingly `{ createFieldHost, extensions }` with `extensions: Record<string, unknown>`.

**The analyzer no longer reads the namespace** (T1b): the virtual entry re-exports `getService` from the CONSUMER's `@furnace/core/registry`, and `frontend/analyzer-worker.ts` resolves stage 2 via `mod.getService("analyzerVerify")` — a validated lookup that throws a nameable `FurnaceError` when the project registered nothing (the dungeon's `editor-extensions.ts` registers the service with `defineService` at import time, Branch A). The looked-up fn is still narrowed ONCE to `AnalyzerEngine["analyzerVerify"]` at the worker's boundary cast; the type stays structurally declared in `field-host/analyzer-protocol.ts` (the wire-twin rule survives unchanged). Nothing on the main thread reads `extensions` at all. The generation-era members (`runWorld` / `bakeWorldFiles` / `realizeRegion` / `MaterialCache` / `worldDir`) went with the World panel; the dungeon's `editor-extensions.ts` still exports far more than the editor consumes, and the engine bundle may tree-shake whatever nothing imports.

**The daemon holds no schema knowledge.** The second bundle (`src/daemon/registry-bundle.ts`) existed for exactly one job: import the consumer's extensions on the *Node* side so `session.apply` could run `validateDocument` against the project's own registry before committing a scene mutation. With the mutations gone there is nothing server-side to validate — every schema decision now happens in the browser, inside the field host and the generator registry it drives. The daemon writes bytes (`generation.bake`) and reads them back (`field.load`); it does not know what a generator is. Deleted with it: the `extension-build-failed` error code, whose only throwers were that bundle's build and import paths.

**Staleness model.** The browser bundle rebuilds on every browser refresh (each `GET /engine.js`). Historically the browser had no way to *know* an extension's TypeScript had changed, so a refresh had to be manual. Slice 3.0 closed that (§5, "Directory watching"): `server.ts` watches the extensions entry's directory and emits `bundle-outdated` over SSE, and the frontend hard-reloads on it (unless a world write is in flight — §16.8), so `GET /engine.js` picks up the change automatically. Slice 3.1's second half of this — invalidating the daemon-side registry cache on the same watch — went with the registry bundle; the watch itself is unchanged and still the whole mechanism.

## 4. Commands

`src/daemon/handlers.ts` builds a `Map<string, Handler>` where each `Handler` is `{ input: ZodType, run(input): Promise<unknown> }`. `dispatch(handlers, command, input)`:

1. unknown command → `EditorError("unknown-command")`;
2. `handler.input.safeParse(input)` fails → `EditorError("invalid-input", …)` naming the first failing path;
3. otherwise runs the handler with the parsed input.

Every client — the chrome, a curl, the MCP door — funnels through `dispatch()`, so input validation lives in exactly one place. All input schemas are `z.strictObject(...)` (extra keys rejected). The "future AI binding" this sentence named until foundations T4b is now present and is no exception: `src/daemon/mcp.ts` projects **nine** commands as tools (three at T4b, six more at T4c) and FORWARDS the caller's arguments into `dispatch()` rather than composing its own, so a tool's advertised input schema and the schema that actually decides cannot drift apart in silence — an invented argument earns `invalid-input` at the agent door exactly as it does over HTTP. Since T4c the advertisement is not merely consistent with the validator but **derived from it**: each row's document is `z.toJSONSchema` over the command's own zod, resolved once at door construction (§27.4).

There are **19 commands** — eight dotted families plus one bare verb (`generate`) — and the chrome speaks **12** of them (`frontend/lib/api.ts`). The **seven** it does not are `session.state`, `viewport.capture`, `session.query`, `edit.apply`, `generate`, `action.run` and `session.interrupt`, and none of them has a client method on purpose: every one is a question or an instruction the daemon relays INTO a tab, so a chrome method would be a tab addressing itself. See the table. (The chrome's twelve was 11 until foundations T4c gave `session.release` a caller: the claim now RE-KEYS on a world switch, and a re-key refused mid-session is the one moment a tab has a claim to give up without closing. §26.1.) It was 25 until foundations T2 deleted the 17-command `scene.*` family with the document session it drove, 8 until foundations T4b added `session.*`, and 13 until T4c added the six relayed verbs above. The remaining surface is deliberately thin: **the daemon owns bytes and the filesystem, the browser owns the world.** Nothing here holds a document, a schema or a generator.

*(Counts re-derived at T4c Task 4 rather than incremented: `grep -rhn 'handlers\.set("' src/daemon/` lists eighteen names, and each was tested against `frontend/lib/api.ts` for a client method. The paragraph had said "14 in six families, the TWO it does not" — accurate through Task 2 and left behind by Task 3's three verbs, which is exactly the rot a count nobody re-measures acquires.)*

`session.*` is the first family whose answer depends on **which caller is asking** rather than only on what it asked, which is why three of the five carry a connection `token` (§5.1). The other two are the two halves of the backchannel and neither takes one. `session.answer` is the **only command the daemon is the logical originator of** — it is the return leg of a question the daemon asked, and it names a pending ask rather than a connection, so it carries a `requestId` instead. `session.state` is the **only command the daemon cannot answer**: it relays the question to whichever session is CLAIMED and hands back what that session said, so naming a connection would let a caller read a tab the human is not in — the failure the claim exists to prevent.

| Command | Input schema | Returns |
| --- | --- | --- |
| `project.get` | `{}` | `{ root }` — the absolute project root; the chrome scopes its persistence store by it (§16.2). |
| `field.load` | `{ name }` (`WORLD_NAME_RE`) | `{ manifest, chunks, materials, oplog }` — one root-contained read of `worlds/<name>/`: the manifest, every chunk and `.mat` sibling as base64, and `oplog.json` (or `null`). |
| `generation.bake` | `{ files: WireFile[], cleanDir?: string }` (each file `{ path, encoding: "utf8"\|"base64", contents }`) | `{ files: <count written> }` — writes a browser-uploaded, root-contained file set and emits `generation-baked`. |
| `world.list` | `{}` | Every world under `worlds/`, read-only, with a **`tracked` tri-state** per row (§16.4). |
| `world.makeDefault` | `{ name }` | `{}` — points `worlds/index.json` at an existing world (manifest-checked); emits `worlds-changed`. |
| `world.delete` | `{ name }` | `{}` — removes a world directory. **Refused for the current default**, and refused outright when `worlds/index.json` exists but is unparseable, because then it cannot tell whether this IS the default. Emits `worlds-changed`. |
| `world.rename` | `{ from, to }` | `{}` — case-insensitive-FS aware; emits `worlds-changed`. |
| `world.duplicate` | `{ from, to }` | `{}` — copies a world under a new name; `already-exists` (409) if the target is taken. Emits `worlds-changed`. |
| `session.claim` | `{ name: string \| null, token }` | `{}` — this connection is now the editing session for `name` (`null` = the untitled scratch). Refused `already-exists` (409) when a DIFFERENT live connection holds it; `no-session` (409) when the token names no live connection. Re-claiming a world this connection already holds succeeds. §5.1. |
| `session.steal` | `{ name: string \| null, token }` | `{}` — takes the world whatever anyone else thinks, and sends the displaced connection a `claim-lost` frame. Never refuses on held-ness (an unheld world is simply claimed); `no-session` on a dead token. |
| `session.release` | `{ token }` | `{}` — drops whatever this connection holds. It had **no chrome method** through T4b, on the argument that a tab which stops authoring is a tab that closed and the SSE departure hook has already released it. T4c found the exception and gave it one: a claim that RE-KEYS on a world switch can be REFUSED, and the daemon drops the old key only when a new claim succeeds — so without a release the tab would go on holding the world it just left (§26.1). Reached only on that refusal, and never with a `name`: the connection is what holds, so the connection is what is dropped. |
| `session.state` | `{}` | The claimed session's `SessionState` (`src/shared/wire.ts`), RELAYED — the first command that asks rather than answers. A discriminated union on `ready`: the not-ready arm carries nothing but the discriminant (the engine bundle is async and a tab is claimable before its field host exists, so an empty-looking world would be a false claim of emptiness), and the ready arm carries `cursor`, `world`, `armed`, `brush`, `session`, `selection`, `selectedEntity`, `camera`, `stats` and `history`. `armed`/`brush` were `gesture`/`tool` through T4b and were renamed WITH a shape change at T4c (§27.3): the pair could only be read correctly by joining them, and an agent got the join wrong at the T4b gate. **No token and no input** — it addresses whoever is claimed (§5.1), so zero and many both refuse with `no-session`, a silent tab earns `session-timeout` (§6), and the daemon validates nothing on the way past: it cannot compute one field of this, which is the whole reason the backchannel exists. `cursor` is an opaque compare-only change token that rides the history payload (§17.6). |
| `viewport.capture` | `{ view?, size?, overlays? }` | `ViewportCaptureResult` (`src/shared/wire.ts`) — a base64 PNG of the live viewport plus the `width`/`height`/`view` it actually produced, RELAYED. The **second** command the daemon cannot answer and the first with a **budget of its own**: 30 s rather than the default 10, because this ask makes the tab render, read back off the GPU and encode, where every other method reads a record it is already holding (§26.1). `view` is validated against the host's own `CAPTURE_VIEWS` (`src/shared/capture.ts`) and `size` against the same bounds the host clamps to — the daemon REFUSES out of range where the host clamps, because a schema is also what the MCP door advertises. |
| `session.query` | `{ about: "entities" }` \| `{ about: "ray", origin, dir, maxDist? }` \| `{ about: "selection" }` | `QueryAnswer` (`src/field-host/field-query.ts`), RELAYED — the spatial read, and the tranche's answer to *ask this, do not squint* (§27.2). `entities` returns every committed entity with its footprint plus the placed-prop LINT (floating props with their measured gap, interpenetrating pairs with their penetration extents, and a `truncated` flag so an empty list cannot read as a clean world); `ray` returns one `raycastField` hit with its distance; `selection` returns the replayable `SelectionSpec`, count and box — **never the cells**. A `z.discriminatedUnion` per arm, so a bad request reports against the arm it MEANT. **No budget of its own** (store and log arithmetic, with a measured cap on the only quadratic part). `maxDist` is bounded at `MAX_PROBE_M` where `raycastField`'s own step ceiling would otherwise make a `null` ambiguous (and CLAMPED again in the host, so the module's contract does not depend on this door); `dir` is refused as the zero vector, which `z.number()` alone admits and core would silently turn into a walk along +X. |
| `edit.apply` | `{ ops: BrushOpInput[] }` (`.min(1)`, full op vocabulary — `daemon/op-schema.ts`) | `ActionResult`, RELAYED — a batch landing as ONE undo entry for the human (§27.1). The daemon validates the op SHAPE in full because a write arriving malformed and relayed anyway asks a tab to mutate a world nobody checked; core decides whether the shape is BUILDABLE. No budget of its own: the cost is bounded by the list the caller sent. |
| `generate` | `{ generatorId, params?, seed?, region? }` | `GenerateOutcome` (`src/field-host/field-mutation.ts`), RELAYED — one generator committed atomically, opening no stamp session and leaving none (§27.1). `params` is `z.record(z.unknown())` and that is the honest ceiling: per-generator schemas live in core's registry, which this Node-portable daemon may not import, so core validates them at commit. Carries a **30 s budget** — a generator's `evaluate` runs on the tab's main thread. |
| `action.run` | `{ id, input? }` | `ActionResult`, RELAYED — the named-verb door onto the editor's own 39 verbs (§27.1). Builds **no allow-list** (which ids exist is `runNamedById`'s answer) and holds one **deny-list**: `edit.undo` and `edit.redo` are fenced at the daemon until op attribution ships. The six ids with an input schema have it applied here, from `action-registry/schemas.ts`. |
| `session.interrupt` | `{}` | `ActionResult`, RELAYED — the Esc key as a verb (§27.3). Drains **one** rung of the host's Esc capture stack (the most recent standing thing: a session, a stamp arm, a half-drawn anchor, the entity or cell selection) and refuses `inert` when nothing is standing, so a caller can tell a cancel from a no-op. **It cannot stop a bake, a save or an analyzer pass** — nothing in this editor is abortable, and the honest answer for a long job is the ask budget. `z.strictObject({})`: the stack is ordered by recency and addresses nothing by name, so there is no parameter to take. |
| `session.answer` | `{ requestId, ok: true, payload }` \| `{ requestId, ok: false, error }` | `{ delivered }` — hands one answer to the backchannel ask it names (`daemon/backchannel.ts`). **No token**: the `requestId` was minted into exactly one connection's stream, so holding it means holding that stream — the same structural argument the token itself rests on. `delivered: false` is the honest report for an id naming no pending ask (an answer that lost the race with its own ask's timeout, a duplicate, a forged one), not an error — refusing would manufacture a client-side failure for a designed race. A discriminated union so a refusal cannot pose as a success with a missing payload. |

`field.load` and every `world.*` verb share ONE name schema — `z.string().regex(WORLD_NAME_RE)` — and `worlds.ts`'s top comment tracks the other copies of that regex.

**`field.load` reads siblings through one guard.** `readSiblings` is a single root-contained base64 reader used for BOTH sibling kinds (chunks and `.mat` materials), so the containment check is applied identically; a copy per kind is how one path's guard drifts. A path escaping the root is `outside-root` (404, §6), and a dedicated path-traversal rejection test guards it.

**`generation.bake` — the browser produces the payload; the daemon only writes it.** A Pr-2 determinism probe found that regenerating the same seed under a *different JS engine* than the one that previewed it produces a different world placement: bun/JSC and node/V8 diverge on the transcendental `Math` used to place pieces (`docs/learnings/2026-07-06-cross-engine-placement-determinism.md`). So "the daemon regenerates from the seed" would bake a world that does not match what the user saw. The browser bakes in its own engine and uploads the produced file set; **the daemon holds zero generator knowledge.** `run`:

1. resolves every `path` against the project root and rejects the **whole batch before any write** if any escapes the root or contains a dotfile segment (`outside-root`, 404 — the hidden-existence rationale in §6);
2. when `cleanDir` is given, validates it (root-contained, never the root itself, no dotfile segment, and **every** payload file resolves under it) and `rm -rf`s it BEFORE any write — clean-previous-bake, so a smaller re-bake leaves no orphans from a larger earlier one; a mismatched payload throws and leaves the FS untouched;
3. writes each file — `mkdir -p` the parent, base64-decode when `encoding === "base64"` (binary `.fmesh` sidecars ride as base64 in the JSON POST);
4. emits `generation-baked` (`{ files: <count> }`) over SSE and returns `{ files: <count> }`.

The `path` `.min(1)` guard is load-bearing: an empty path resolves to the root dir and would hit `writeFileSync(rootDir, …)` → `EISDIR` mid-batch (a partial write). The browser marshals binary sidecars via `toWireFiles` (`frontend/lib/generation.ts`, chunked base64 so a large sidecar cannot blow the `String.fromCharCode` argument stack). It was the **first handler that emitted an SSE event**, which is why `HandlerContext` carries an `emit(event: DaemonEvent)` field that `server.ts` fills with `hub.emit`; the `world.*` verbs use the same field. The command is destination-agnostic (root-contained + `cleanDir`), which is why the world verbs needed tests rather than changes when `worlds/<name>/` became the destination.

## 5. Change feed + directory watching

### SSE change feed

`src/daemon/events.ts` is the SSE broadcaster. Events are **notification-only dirty-bits** — there is no payload protocol beyond the event itself; a consumer refetches whichever command owns the changed state (`world.list` on `worlds-changed`), so a slow consumer naturally coalesces N changes into one refetch. Each subscriber gets a 15 s heartbeat comment (`: ping`); the heartbeat interval is `unref`'d so it never holds the process open.

The feed carries **six** events (`src/daemon/events.ts`, verified against the source). It carried five more until foundations T2 — the document session's own `SessionEvent` union (`scene-opened`, `document-changed`, `saved`, `file-conflict`, `file-invalid`) died with the session — and gained three in foundations T4b. **The last three are ADDRESSED rather than broadcast**: they are written to ONE connection through `hub.emitTo`, because a broadcast token would hand every tab the name of every other tab's connection, a broadcast `claim-lost` would blank the tab that just WON the world, and a broadcast `session-request` would have N tabs answer one question — N−1 of them about a session nobody asked about, with the first answer to arrive winning. Everything else about them is identical — the same generic frame, the same `ServerEvent` arm, the same `EVENT_TYPES` row.

| Event `type` | Payload fields | Emitted when |
| --- | --- | --- |
| `bundle-outdated` | none beyond `type` | a source file under the extensions entry's directory changed ("Directory watching", below) — the browser should reload to pick up the freshly-rebuilt `/engine.js`. |
| `generation-baked` | `files` (count written) | `generation.bake` wrote the browser-uploaded file set to the project root (§4). |
| `worlds-changed` | none beyond `type` | the worlds directory or its index changed — `world.delete` / `rename` / `duplicate` / `makeDefault` each raise it AFTER their FS mutation succeeds. Consumers refetch `world.list` (§16.4). |
| `session-token` *(addressed)* | `token` | **the first frame every subscriber gets** — the name the daemon minted for this connection, which `session.*` commands echo back. §5.1. |
| `claim-lost` *(addressed)* | `world` (`string \| null`) | another session stole the world this connection was authoring. Only the displaced connection receives it. §5.1. |
| `session-request` *(addressed)* | `requestId`, `method`, `params` | the daemon is relaying a question to the claimed session and expects a `session.answer` POST back (`daemon/backchannel.ts`, §4). The **only arm both sides import rather than mirror** — it composes `SessionRequest` from `src/shared/wire.ts`. |

The SSE wire frame is `event: <type>\ndata: <json>\n\n` — every event rides it generically. The frontend `ServerEvent` union + `EVENT_TYPES` subscription list (`frontend/lib/events.ts`) mirror this daemon union, and since foundations T4b **both halves are compile-time pinned** in `tests/events.test.ts`: the unions against each other (mutual assignability), and `ServerEvent["type"]` against `EVENT_TYPES` — the second closing a hole that was prose until then, where an arm added to both unions but not to the subscription list type-checks, ships, and silently never arrives, because an `EventSource` delivers only the names it was asked for. `tests/chrome/session-answer.test.tsx` reds on the same gap at runtime.

**There is no file watching any more.** `WatchFile` / `chokidarWatchFile` — the single-file watcher with the scene session's conflict matrix behind it (echo suppression by canonical form, dirty-conflict, clean-reload-as-undoable-mutation) — was deleted with the session in foundations T2. The daemon watches exactly one thing now, a directory:

### 5.1 The session claim, and the connection token (foundations T4b)

`src/daemon/claims.ts` is a `Map<world, ServerResponse>` — at most one connection per world,
at most one world per connection (a partial bijection). The three commands live in
`src/daemon/session-handlers.ts`, their own module on the daemon's existing convention
(`worlds.ts`, `claims.ts`, `bundle.ts`, `origin.ts` are each one concern): `handlers.ts` is the
filesystem verbs, nothing there touches connection identity, and nothing in the session module
touches a file. `createHandlers` merges the map it returns. `server.ts` wires the table to the hub
in two lines: `hub.onClose(conn => claims.release(conn))` and
`claims.onDrop((conn, world) => hub.emitTo(conn, { type: "claim-lost", world }))`.

**The world key is `string | null`.** `null` is the untitled scratch a fresh editor boots into,
mirroring the chrome's own `WorldState.name` (§16.4), which is "never prefilled" by design. It
is a KEY rather than an absence, because the commonest session in the editor's life — a user
digging before they have named anything — must be claimable, or an agent could never reach a
fresh editor at all. Two untitled tabs then contend for the same key, which is the policy's own
answer: they cannot both be the session an agent drives.

**No grace period across a reconnect, because none is needed** — measured at the T4b Task 0
spike, not assumed: the daemon notices a departure ~3.5 ms after the socket dies and the
browser's automatic re-subscribe arrives ~3.0 s later, so the claim simply drops and the
reconnecting tab re-claims and wins. What IS structural is that `release(conn)` is
**identity-conditional** — an entry is dropped only when its holder IS that connection —
because a new subscribe can land ~52 ms before an old close, and an unconditional release would
let a reloading tab's late close revoke the claim its own new connection had just taken.

**The connection token.** A POST and the SSE stream are different HTTP requests, so a command
acting for *this* connection needs a way to say which one it is. The hub mints an opaque
`randomUUID` inside `subscribe`, writes it as the stream's first frame (`session-token`), and
resolves it back to the `ServerResponse` by live-table lookup. It rides the **body**, not a
header, because `dispatch()` has exactly one input channel by design and a header would carry a
transport assumption into the module built to outlive its transport.

*What the token is NOT*: authentication. The daemon binds loopback and serves one local user
(§2); the question a token answers has N equally legitimate answers, one per open tab — *which*
of my subscribers are you, never *may* you. A leaked token grants exactly what a second tab
already has. It is not a second thing to steal either, on `origin.ts`'s own threat model:
obtaining one means reading a response body, the rebinding page cannot open this stream (403
before `subscribe` is reached) and could not read it if it did (no CORS headers). **An MCP
client can never present one**, structurally rather than by a check: the mint is written into
the stream it opens, so holding a token means holding that stream, and the `/mcp` door never
routes there. Guests, not claimants.

**A runtime defect this uncovered, and fixed.** `res.on("close", …)` — the daemon's only
liveness signal since its first commit — **never fires under Bun** (1.3.14, measured by raw
socket destroy, `fetch` abort and reader cancel alike; Node 22 fires it in 2–5 ms). Both `edit`
scripts start this daemon with `bun`, so the SSE subscriber cleanup had been a silent no-op in
the live editor the whole time. `req.on("close")` fires on **both** runtimes within 2 ms, and on
neither while a client is still connected. `subscribe` now watches both halves, latched so one
departure is announced once. Pinned in `tests/claims.test.ts` (the request half alone releases;
one departure, one announcement) and end-to-end in `tests/server.test.ts` (a hang-up frees the
world for the next connection, with no steal — the case that pins `server.ts`'s own wiring).

**A lost tab never claims again.** `onToken` returns early while the claim-lost flag is set, and
the case is routine rather than exotic: after a steal, the daemon restarts (every source change in
the `bun run edit` loop does that) or the stream blips, `EventSource` reconnects **both** tabs, and
the daemon has no memory of who lost what — so without the guard the covered tab re-claims and may
win the race. It would then HOLD the claim while displaying "another editor session took over" and
suppressing its own keyboard: an agent driving "the session" wired to a tab the human cannot
operate, and the tab the human is actually in refused and steal-prompted. The early return is what
makes the cover's own sentence true — *reload to claim it back*, a reload being the one thing that
legitimately produces a fresh tab with no memory of having lost.

**Chrome side.** `hooks/useSessionClaim.ts` claims on the **token frame**, not on `onOpen`: the
token arrives as the stream's first frame, so at open there is nothing to present yet. `onOpen`
keeps the one job it can honestly do — forget the dead connection's token, so no POST goes out
carrying a name the daemon has already dropped. A refusal opens the steal prompt through the
existing `useConfirmDialog`; losing the claim raises `components/ClaimLostOverlay.tsx`, a
full-viewport cover no gesture dismisses whose one control is a reload. **True read-only mode is
NOT built** — that narrowing of the settled policy ("a second tab gets read-only or an explicit
steal") is deliberate and filed at
`docs/backlog/editor-and-tooling/read-only-chrome-for-an-unclaimed-session.md`.

**The cover is the whole enforcement of that narrowing, so it has to be terminal in both
channels.** Two things make it so, and neither is free:

- **It outranks the portalled layer.** React mounts into `#root`; every Radix overlay portals to
  `document.body`, a sibling AFTER it — so at equal `z-50` a confirm prompt paints *over* the
  cover. The cover declares `z-[60]`, one step above the control library's whole layer, and
  `tests/chrome/session-claim.test.tsx` derives that maximum from `components/ui/` rather than
  hard-coding it, so a library-wide raise reds instead of silently going over the top.
- **It suppresses the keyboard.** A full-viewport layer stops a pointer by existing; the window
  keydown listener is on the WINDOW and never saw one, so ⌘K, ⌘S, ⌘Z and every tool letter would
  keep dispatching behind it — ⌘K's palette being itself a portalled dialog, i.e. the first
  bullet in action. `useGlobalKeybindings` takes a third ref (`claimLostRef`) and returns before
  it matches anything. A ref **of its own**, not `confirmRef`: that one also feeds
  `ctx.isConfirmOpen()` into the gate env, so reusing it would make a claim-lost refusal answer
  `because: "modal"` — false in the vocabulary T4a built (§22.6). It short-circuits BEFORE the
  funnel rather than refusing through it, because a refusal speaks through the toast stack, which
  renders inside the canvas cell — behind the cover, where nobody can read it. Nothing is
  prevented, matching what a modal-refused key already does. Pinned in
  `tests/chrome/keybindings-dom.test.ts`, with its control case.
- **It traps focus.** The third channel, and the one neither of the above touches: **tab order
  follows DOM order and z-index does not affect it.** `<Shell />` stays mounted behind the cover
  with real buttons in the top bar and status bar, so Tab off "Reload" walked into the shell and
  ⏎ invoked that button's own `onClick` — not a keybinding, so the window guard cannot see it.
  The cover installs a capture-phase `focusin` listener that hands focus back to its one control:
  a bounce, which is what a focus scope is. Pinned by a case that MOVES focus, with a control
  case proving the trap is not always on — `aria-modal` is a declaration and happy-dom implements
  no `inert` semantics, so a pin written against either would pass while the hole stayed open.
  The residue is named at the source: `aria-modal="true"` is the only thing telling assistive tech
  to ignore the rest of the document; there is no `inert`/`aria-hidden` enforcement, because
  marking the shell subtree means either a wrapper element around `<Shell />` (against its own
  layout contract) or a component mutating its siblings.

### Directory watching

`src/daemon/watch.ts` also defines the `WatchDir` capability — `(dir, onChange) => unwatch` — and its production adapter `chokidarWatchDir`: a **chokidar v4 recursive watch** over `dir` (`node_modules` and `dist` paths ignored), firing `onChange` on any `add`/`change`/`unlink` beneath the tree (chokidar's `"all"` event, debounced by the same `awaitWriteFinish` settling as `WatchFile`). Like `WatchFile`, it is **injected** — `server.ts` takes an optional `watchDir` in `ServerOptions` for tests to fake, defaulting to the real `chokidarWatchDir` in production.

`server.ts` wires this to close the inner-loop staleness gap (§3): when `config.extensions` is set, it watches `dirname(resolve(root, config.extensions))` — the consumer's extensions-entry directory — and on any change calls `registry.invalidate()` (Slice 3.1 — so the daemon-side registry rebuilds on the next command; §3, Staleness model) *then* emits `hub.emit({ type: "bundle-outdated" })`. The frontend (`App.tsx`) reloads the page on that event when the session isn't dirty; if dirty, it leaves the reload to the user rather than risk losing unsaved edits.

## 6. Error contract

`src/daemon/errors.ts` defines a **closed string-code union** `EditorErrorCode`. Codes are the contract — clients branch on `code`; the human-readable `message` is for display only. Each transport edge owns its own mapping; the HTTP edge's table is `httpStatus(code)` (copied verbatim from `errors.ts`):

| `EditorErrorCode` | HTTP status | Meaning |
| --- | --- | --- |
| `invalid-input` | 400 | zod validation of a command's input failed — or (T4a) the request target does not parse as a URL (`server.ts`'s `requestUrl`, §2). One code, because both mean "the client sent something this daemon will not accept"; a malformed target earns no new contract surface. |
| `invalid-json` | 400 | the request body is not valid JSON (`server.ts`, at the route boundary). |
| `unknown-command` | 404 | no handler for the command name. |
| `not-found` | 404 | the named world does not exist or has no manifest; also `server.ts`'s no-route fallback for an unsupported method/path. |
| `outside-root` | 404 | a resolved path escapes the project root. *(404, not 400 — don't reveal what exists outside root.)* |
| `already-exists` | 409 | **two occupancy classes** since T4b: the write would clobber something already there (`world.duplicate` / `world.rename` onto a taken name), OR the world is already claimed by another live editor session (`session.claim`). Both mean "what you asked for is occupied; pick differently or displace"; the remedies differ (another name / `session.steal`) and the DISAMBIGUATOR is the command, which every caller has in hand. A ninth code would be surface no consumer needs — split it the day a caller must tell the two apart without knowing which command it ran. |
| `no-session` | 409 | the caller named a session connection the daemon does not have — a token from a feed that has since closed, or one it never minted (T4b, §5.1). Since the backchannel (`daemon/backchannel.ts`, §4) it also answers an ask made with **no** claimed session, with **more than one** (there is then no single session to speak for), and one whose connection departs mid-ask. *(409, not 404: nothing is hidden here, unlike `outside-root`. 404 already carries three meanings in this table, and an agent must be able to tell "no such command" from "you hold no session" — this code exists precisely so that call answers discriminably and never hangs. 409 is also the accurate one: a conflict with the CURRENT STATE of the target, RFC 9110 §15.5.10.)* |
| `session-timeout` | 504 | the claimed editor session was asked something over the backchannel and did not answer inside the budget — 10 s by default, chosen strictly under the 60 s per-request floor an MCP client cannot lower (`daemon/backchannel.ts`, T4b). **The budget is PER METHOD since T4c**: `ask()`'s third parameter got its first production caller when `viewport.capture` took 30 s, because that ask makes the tab render and read back off the GPU where every other one reads a record it already holds. Both numbers sit under the same floor, for the same reason. *(504, and the first status here that describes a RELATIONSHIP rather than a request: a gateway that "did not receive a timely response from an upstream server", RFC 9110 §15.6.5 — the backchannel is where this daemon acquires an upstream. Not 408, which says the CLIENT was slow to send; not 500, which is `internal`'s row and would misplace the blame and the retry semantics; not 409, since nothing conflicts — the session exists and simply did not speak. "The session is gone" and "the session is silent" have different remedies, which is why a departed connection answers `no-session` instead.)* |
| `forbidden-origin` | 403 | the request declared an `Origin` that is not this machine's loopback (`daemon/origin.ts`, called ahead of every route — §2). *(403, not 404 — unlike `outside-root` there is nothing to hide: the page already knows the port answered, and no CORS headers are sent, so the body is unreadable to it anyway.)* |
| `internal` | 500 | any other uncaught error at the route boundary. |

Wire shape on every error: `{ "error": { "code": "<EditorErrorCode>", "message": "<human text>" } }`.

**The second edge arrived in foundations T4b, and it is what "each transport edge owns its own mapping" was written for.** `src/daemon/mcp.ts`'s `AGENT_REMEDY` is `httpStatus`'s sibling: an exhaustive `Record<EditorErrorCode, string>`, so an eleventh code is a compile error until this edge has said what to do about it too. A throw out of `dispatch()` becomes an `isError: true` tool result whose text is `<code>: <the daemon's message>` followed by **what the AGENT should do** — whether retrying is sensible, and whether a human has to move first. That second half is the part no daemon-side message is written for: the messages are addressed to a human reading an error envelope, and an agent needs to know that `no-session` will not change until someone opens a tab (so do not poll), that `session-timeout` is worth one retry, and that `internal` is not worth any. `isError` rather than a JSON-RPC error, deliberately — "no editor is open" is an answer and must reach the agent's model, not its error handler; a name that was never advertised (`session_claim`, `field_load`) is the opposite case and is refused as a protocol error.

**Which codes actually reach that edge, re-derived at T4c Task 6 — and the prediction this paragraph used to carry was WRONG.** It read *"T4c will project verbs that reach four more"*. T4c tripled the door (three no-argument reads → nine rows, five taking arguments, four writing) and **the reachable set did not move**: it is still exactly four — `no-session` and `session-timeout` (the backchannel's own refusals, and the reason `AGENT_REMEDY` exists), `internal` (a chrome that could not serve the method, and a genuine daemon fault alike) and `invalid-input` (every schema refusal, plus `action.run`'s fence). The other six are stated because the union is CLOSED, not because they are merely unlikely, and each is unreachable for its own reason: `not-found` / `outside-root` / `already-exists` are thrown by world, bake and claim commands, none of which is projected — the near miss is `action_run` reaching `world.makeDefault`, but through the CHROME's own HTTP client, so the code is thrown one bundle away and arrives here as a relayed `ActionResult` rather than as this edge's throw; `invalid-json` is thrown parsing an HTTP body, which the MCP transport reads for itself; `forbidden-origin` is refused ahead of the route branch, so no tool call is running when it is thrown; and **`unknown-command` became structurally unreachable at T4c**, because `createMcpDoor` resolves every row's command against the registry when the door is BUILT — a table naming a command the registry lacks fails at startup, so no tool call can be in flight to discover it. `AGENT_REMEDY` carries this derivation at source, where the next person to add a row will read it.

**The union gained its ninth and tenth members in foundations T4b** — `no-session` and
`session-timeout`, argued in the rows above and at `errors.ts`. The tenth is also the table's
first non-`internal` 5xx. **Its eighth arrived in foundations T4a** — `forbidden-origin`, the first code
whose thrower is neither a handler nor `dispatch()` but the route boundary itself, and the
first 403. Its NAME is the contract half that matters: it says which fact was refused (the
origin) rather than which status HTTP chose, so a future MCP binding maps it without inheriting
`403`, and a general `forbidden` stays free for a genuinely different refusal class. `HTTP_STATUS`
is an exhaustive `Record<EditorErrorCode, number>`, so adding a member is a compile error until
its status is stated; `tests/errors.test.ts` restates the whole table independently.

**Seven codes went with the scene half in foundations T2** — `validation-failed`, `no-session`, `unsaved-changes`, `nothing-to-undo`, `nothing-to-redo` and `unreadable` (all thrown only by the session, the mutations or the scene reader), plus `extension-build-failed`, whose only throwers were in the deleted registry bundle (§3). `invalid-json` survives on its own merit: `server.ts` still throws it for an unparseable request body. Deleting a code is a wire-contract change, which is why they went in the same commit as their throwers rather than being left as unreachable rows.

**One of the seven came back, and it is worth saying which and why.** `no-session` is spelled the same in T4b and means something else: the T2 one was the *document* session — "no scene is open" — and the T4b one is the *editing* session, a connection identity (§5.1). Nothing carries over from the old meaning; the name was simply the right one for the new fact, and reserving a retired spelling forever would be an odd thing to owe a deleted feature.

## 7. Serving the chrome — the build, and the zero-engine rule

The browser frontend is **React 19**, Tailwind-styled. It is **prebuilt** to `dist/frontend` by `packages/editor/scripts/build-frontend.ts` (`bun run --cwd packages/editor build:frontend`) and served same-origin by the daemon's static route (§2). `bun run edit` rebuilds it before starting the daemon. The build is production-mode React on purpose, and it takes **two** levers rather than one: `process.env.NODE_ENV = "production"` on the build process picks react-dom's `production` package export (which file is bundled), and `define` inlines the same value for residual runtime `process.env` checks. `Bun.build` sets neither by default, so without both react-dom ships in dev mode.

**Three entrypoints, because a worker is reached by URL and not by an import graph.** `src/frontend/index.html` is the chrome; `src/frontend/field-worker.ts` (§11) and `src/frontend/analyzer-worker.ts` (§15) each ship as their own module bundle, since the chrome spawns them with `new Worker("/<name>.js", { type: "module" })` and neither can ride the html entry's graph. Both run engine code (`@furnace/core/field`) **directly**, not through `/engine.js` — the analyzer worker additionally loads `/engine.js` at runtime for its stage-2 verify, which drives the project's own mover (§3a).

**Zero engine value-imports.** The chrome must never `import` `@furnace/core` at value level — doing so would create a *second* core instance alongside the engine bundle's, the exact bug project-first resolution prevents. `packages/editor/tests/frontend-no-engine-leakage.test.ts` scans `src/frontend` **and `src/shared`** and forbids value imports / side-effect imports / value re-exports of `@furnace/core`, **`field-host` and `field-protocol`** (`import type` / `export type` are erased and allowed). The chrome reaches the engine **only** through `loadEngine()` (a dynamic `import("/engine.js")`) and type-only imports of `field-host/index.ts` — which is why a host constant the chrome needs is normally restated as a local literal beside a comment saying so (`lib/field-host-mirrors.ts`, §16.7) — with three exceptions since T3b2: `MAX_SEGMENT_M`, `SELECTION_UI_BUDGET` and the `LATTICE` step now live in `src/shared/` (`field-limits.ts`, `field-brush.ts`), where BOTH layers value-import the same number instead of agreeing by review (§22), and why deriving a fact host-side and pushing it is often cheaper than the chrome computing it (§13's drift `entityIds`, §17.1's pick tiers).

**The import arrow runs one way — `frontend/ → { field-host/, action-registry/ } → shared/`** (foundations T3b1; the fourth node arrived in T3b2, §22.5). `src/frontend/` is the React half, `src/field-host/` the engine-facing half, `src/action-registry/` the editor's verbs as rows, and `src/shared/` the neutral floor. The two middle nodes were SIBLINGS through T4b — neither imported the other — and **since T4c they are a chain: `field-host/ → action-registry/`.** `tests/no-chrome-leakage.test.ts` pins BOTH directions, and each for its own reason. Upward is forbidden outright (the registry taking a `FieldHost` type would put a host dependency in the one module the daemon is meant to be able to hold). Downward is permitted for EXACTLY ONE module, `action-registry/result.ts`, and asserted as a membership rather than merely left unguarded: `field-host/field-mutation.ts` answers a caller instead of the room, and `result.ts` puts the refusal vocabulary below the chrome precisely so non-chrome callers can hold it — *"there is ONE vocabulary of refusal in this editor"*. The alternative was a host-local result type converted in the chrome verb, which is the second-name-for-a-subset that file argues against. It is the FILE and not the barrel, so `schemas.ts`'s zod never becomes reachable from anything the host pulls in. Before T4c the reverse edge was simply unguarded, which is the accident-of-file-layout the repo's boundary rule exists to prevent — silence is not permission. `src/field-host/` carried the deleted scene-editing viewport host's name until T3b1's last task renamed it (2026-08-06), tests included (`tests/field-host/`); four dated records — three under `docs/learnings/`, one under `docs/research/` — are the only tracked files where the old spelling still reads as current, and they keep it deliberately. Each layer may import DOWN the chain and never up; `shared/` imports nothing ABOVE it. **Foundations T4b added a fourth reader that is not on that arrow at all: the daemon.** `src/shared/wire.ts` holds the backchannel's two frame types, and `daemon/events.ts` + `daemon/session-handlers.ts` `import type` them exactly as the chrome does. It changes no rule — the daemon sits above the floor like everything else and the floor still imports nothing above itself — and the two leakage suites turn out to have been enforcing precisely what a daemon-facing module needs from the other direction: React-free, engine-free and zod-free is also Node-portable. `wire.ts` is types-only, so both edges are erased. **T4c added the floor's first module the daemon VALUE-imports**: `src/shared/capture.ts` holds `CAPTURE_VIEWS` and the capture size bounds, read by the host (which derives and clamps), by `wire.ts` (type only) and by the daemon's zod schema (which validates); the MCP door joins them when the tool is advertised. It is on the floor for exactly the reason the rule exists — the daemon may not touch anything that imports `@furnace/core`, and every file in `field-host/` does — and it changes no rule either: a plain array and three numbers are React-free, engine-free, zod-free and Node-portable, which is the same four properties `wire.ts` satisfies by being empty at run time. It stopped importing nothing *at all* in foundations T3b2 (2026-08-06), which added two intra-layer edges — `action-table.ts` reads `field-brush.ts` and `field-limits.ts` — and those are legal by the same rule: they point sideways within the floor, not up out of it. The guard was written for this (`tests/no-chrome-leakage.test.ts` deliberately pins "nothing out of `frontend/`" rather than "no `../` specifier", precisely so a legitimate intra-layer import does not trip it). Until T3b1 seven host files reversed it by importing eight modules out of `frontend/lib/`, and the modules moved rather than the rule bending:

- **Host-only** (`field-host/`): `analyzer-client.ts`, `analyzer-protocol.ts`, `field-client.ts`, `field-protocol.ts`, `field-size.ts`. The two protocol modules VALUE-import `@furnace/core/field`, so they carry core and could never sit in `shared/`; their only chrome-side consumers are the two worker ENTRIES (`frontend/field-worker.ts`, `frontend/analyzer-worker.ts`), which are separate bundles in their own Worker realms and are the leakage guard's only exemptions.
- **Chrome-shared** (`shared/`): `catalog.ts`, `field-brush.ts`, `field-entity.ts`. Two of the three are VALUE-imported by chrome components as well as by the host; **`catalog.ts` is the exception and always was** — the host `import type`s it at all four of its sites (`field-host.ts`, `field-placements.ts`, `field-props.ts`, `substrate.ts`), so only the chrome (`hooks/useCatalogs.tsx`) takes a value edge. It belongs here on the *type*-sharing half of the rule rather than the value-sharing half, and the earlier wording claiming otherwise was corrected in T3b2 Task 5. T3b2 added three more, all value-imported by both layers: `field-limits.ts`, `action-table.ts` (Task 5 switched the chrome onto it — §22), and `field-brush.ts`' `LATTICE` gained a registry-side reader too. T3c added a fourth, `tool-registry.ts`, value-imported by `tool-params.tsx` for the dead-control answer — and the floor is where it had to go for exactly the reason this bullet states, which §23.4 works through as three independent facts. `shared/` holds protocol-shaped types and pure derivations: **React-free and engine-free**, where engine-free means no VALUE import of `@furnace/core` (type-only is erased and allowed). Moving one of these into `field-host/` instead would have broken every chrome file that value-imports it, because the guard forbids a chrome value-import of any `field-host` specifier — the guard is right, and it is what decided the split.

The guard scans `src/shared/` with no exemptions precisely because the original three modules left `src/frontend/`: a chrome file's `../../shared/catalog.ts` matches none of the specifier rules, so without the extra scan a core value-import added there would reach the chrome bundle unseen. The host-only five left the scan too, and that narrowing is deliberate — they are host files now, and the invariant that mattered is enforced at the boundary instead, since any chrome value-import of one writes a `field-host` specifier. That specifier rule ends the segment (`field-host/` or the end of the specifier) so it does not also catch `frontend/lib/field-host-mirrors.ts`, a chrome-internal helper that shares the prefix and nothing else.

**Both directions are machine-enforced.** `tests/no-chrome-leakage.test.ts` is the mirror of the engine guard: it scans `src/field-host/` for React imports and for any specifier reaching back into `frontend/`, and `src/shared/` for React imports — closing the React-free half of the `shared/` rule, which was prose until T3b1's last task. It is stricter than the engine guard in one respect: `import type` counts, because the question is which layer a module belongs to rather than what reaches a bundle.

**The host owns resize-rendering, and the chrome must not.** The field host subscribes its own re-render via `gpu.onResize`. Because the engine's `onResize` sets the canvas backing store *before* emitting, the host's render runs at the new size; a chrome-side `ResizeObserver` fires before the backing-store resize and blanks the surface. This was a real bug caught only by a manual visual gate, and the constraint is documented at the source.

## 8. `furnace.config.json` namespacing

`src/daemon/config.ts` reads the consumer's `furnace.config.json` from the project root. The file is **shared with the `furnace` CLI** (Rust), so namespacing is explicit:

- **Top level** belongs to the CLI (`identity`, `source`, `window`, …) — parsed **loosely** (`z.object`, unknown keys ignored). Not the editor's to validate.
- **The `"editor"` block** is the editor's namespace — parsed **strictly** (`z.strictObject`), so a typo'd key inside it fails loud (setup-loud policy). It has exactly **one** field: `extensions` (optional path to the consumer's extension entry, relative to root). The `scenes` glob went with the `scene.*` family in foundations T2 — and because the block is strict, a project that still declares `scenes` now fails setup-loud on `bun run edit` rather than silently ignoring it (hello-world's whole `editor` block was removed for exactly that reason).

If the file is absent, all editor settings fall back to defaults. Malformed JSON throws loud, naming the file.

## 9. The inspector module — `frontend/inspector/`

The inspector was built at M5A as an editable, reflection-driven form over `scene.introspect()`. The scene surface it served is deleted, and so is the core module behind it; **the inspector survived both intact** and is now the form the session card renders a generator's `paramSchema` into (§17.5). It has exactly ONE consumer, and the whole point of the boundary is that it could have another.

### 9.1 Where a schema's field semantics come from

The inspector reads one optional annotation off a schema node: a `furnace` bag carrying `kind` (which control) and/or `unit` (the display suffix). It is written with zod's `.meta({ furnace: … })` and hoisted to the node ROOT by `toJsonSchema` in `@furnace/core/registry` (§9.3) — which is the whole contract, and deliberately so: the annotation is a *registry* convention, not a scene one.

The scene module's `t.color()` (a 4-tuple carrying `kind: "color"`) used to be the canonical emitter; it went with `@furnace/core/scene` in foundations T2. Today **nothing in the repo emits a `furnace.kind`** — core's generator schemas carry only `furnace.unit`, and every control the one consumer renders is chosen by the schema's SHAPE (§9.3). The `kind` half of the contract is live code with no current writer, which is a fact worth stating plainly rather than leaving a reader to discover.

### 9.2 The boundary

The inspector is a **self-contained, swappable boundary**: the chrome consumes it only through `<SchemaForm>` and the types in `index.tsx`. Input is standard JSON Schema (with a root-level `furnace` field-semantics key) plus the target's value plus change callbacks; output is rendered controls. Swapping the inspector library touches only this directory.

**JSON Schema contract (`types.ts`).** The inspector's `JsonSchemaNode` is a plain frontend-local type — deliberately NOT core's, because the module must not value-import `@furnace/core` (§7). There is exactly ONE boundary cast, in `SessionCard.tsx`, where a generator's `paramSchema` (typed `Record<string, unknown>` in core for that same reason) becomes a `JsonSchemaNode`. The cast that used to sit beside it, over `scene.introspect()`'s return, died with the scene surface.

### 9.3 Kind resolution and the shape rules

**Kind resolution (`kind.ts`).** `resolveKind(schema)` maps a schema node to a `FieldKind` in priority order: `schema.furnace.kind` (for furnace-specific kinds) → `enum` (by CARDINALITY) → numeric SHAPE → JSON type string → `"unknown"`. The furnace kinds handled are the five in `FURNACE_KINDS`: `vec2`, `vec3`, `vec4`, `quat`, `color`. (`resource` and `ref` left the union in foundations T2 with the scene resource tables that were the only thing that ever named them.) **Note:** `furnace` sits at the schema-node ROOT, not nested under `meta` — `z.toJSONSchema` hoists zod's `.meta({ furnace })` to the node root. (Reading it from `meta` was the M5A holistic-review CRITICAL bug.) Every member of `furnace` is optional, `kind` included, so a node can carry only a `unit`.

**Shape rules (D-25, F4.5b Task 11).** Two kinds are chosen from the schema's SHAPE rather than from a `furnace.kind`, and both decisions live in `resolveKind` so the registry keeps its single lookup:

- an `enum` of **≤ 4** members → `segmented`; above that → `enum` (the Select).
- a **bounded** number (`minimum` and `maximum` both finite, `lib/numeric-schema.ts`) → `stepper` when every reachable value is a whole number AND the step spans ≤ 12 intervals, else `slider`. An unbounded number keeps `number`.

The bounded control's STEP comes from `multipleOf` when the schema declares one, from `type: "integer"`, or otherwise from the span (a 1-2-5 value near span/100). It is never inferred from how the bounds happen to look: `cave.chamberRadius` has integer bounds `[3, 8]` and `numParam` admits 5.5 m. Core's generator schemas carry `multipleOf: 1` on exactly the params `intParam` narrows, and `furnace.unit` on the params whose unit is not already in their name (`"m"` on `cave.chamberRadius` / `scatter.minSpacing`, `"cells"` on the hall's dimensions — a hall of width 8 is 4 m across). Both annotations are declarative: nothing in core reads either, and `packages/core/tests/field-generators.test.ts` (gone) asserts the `multipleOf` half BEHAVIOURALLY (a fractional value must be refused iff the schema claims it).

### 9.4 The kind→renderer registry

**`registry.tsx`.** A `Partial<Record<FieldKind, FieldRenderer>>` maps each kind to its React component. Current registry (verified against source):

| Kind | Renderer |
| --- | --- |
| `number` | `NumberField` — unbounded numeric input with drag-scrub |
| `slider` | `SliderField` — range + scrubby label + exact text input, all quantized by `snapToStep`; renders `furnace.unit` |
| `stepper` | `StepperField` — −/exact/+ over a short integer range; renders `furnace.unit` |
| `string` | `StringField` — text input |
| `boolean` | `BooleanField` — checkbox |
| `enum` | `EnumField` — Radix `Select`, commits the schema MEMBER (`lib/enum-options.ts`) |
| `segmented` | `SegmentedField` — `role="radiogroup"` of buttons, roving tabindex, commits the MEMBER |
| `vec2` / `vec3` / `vec4` | `makeVecField(n)` — N-component number row |
| `color` | `ColorField` — RGBA color picker |
| `quat` | `QuatField` — Euler XYZ degree inputs (converted via `lib/euler.ts`) |
| `object` | `ObjectField` — nested properties |

`fallbackRenderer` is `DefaultField` — displays the value as JSON read-only.

**Four of these rows have no live emitter** (§9.1): no schema in the repo sets `furnace.kind` at all, so `vec2`/`vec3`/`vec4`/`quat`/`color` are unreached today and every field the one consumer renders resolves by SHAPE or by JSON type. They are kept because they are the inspector's own vocabulary, not a scene concept — the `resource` / `ref` pair that went in T2 *was* the scene concept, and its renderers had already collapsed to read-only JSON at F4.5b Task 11 when the `InspectorOptions` provider that fed their pickers disappeared.

### 9.5 `<SchemaForm>` — drafts, validation, the echo guard

**`SchemaForm.tsx`** iterates `schema.properties`, resolves each field's kind, looks up (or falls back to) the renderer, and renders it wrapped in a **`RowErrorBoundary`** — a React class error boundary that catches per-row render errors and displays them inline without crashing the whole form. It manages the working draft (`useState`) and re-seeds it when the committed `value` reference changes (the `seed` ref guard). Props: `{ schema, value: unknown, onPreview, onCommit, onCancel, onInvalid? }` — a pure callback contract, no internal fetch and no mutation of its own.

**Field-level validation (D-25).** Before writing a draft, the form runs `validateNumber(fieldSchema, value)` (`lib/validate.ts`: bounds + `multipleOf`). A refused draft is **not written and not previewed** — the worker never evaluates a ghost the generator would throw on — and the reason renders in that row with `role="alert"`. Refusals are held per-path (an unrelated row's edit must not clear one whose bad text is still on screen), but only the FIRST offending field in schema order leaves the component, through `onInvalid`. One slot, not a bag: a consumer holding a list is one render away from printing a bottom-of-form dump, which is the pattern D-25 exists to retire. `SessionCard` turns that slot into the commit verb's disabled reason (`"Chamber Radius must be at most 8"`) and retracts it on unmount.

**Row wrappers (`fields/common.tsx`).** `FieldRow` wraps its control in a `<label>`; `FieldGroupRow` uses a `<div>` and is what a row with SEVERAL controls (stepper, segmented) uses. A `<label>` labels exactly one control, so wrapping a group makes every member answer to the row caption instead of its own name, and a `<label>` with no `for` activates its first labelable descendant — clicking the "Chambers" caption steps the value down. (A third symptom, one press dispatching two commits, is a happy-dom artifact rather than a browser defect — WHATWG says a label does nothing for events targeted at interactive content descendants — but it is what made the wrapper visible, through a call-count assertion.)

**The echo guard** (`lib/echo-guard.ts`) is what stops an incoming push clobbering a half-typed number. `shouldReseed(focusWithin)` is a pure predicate; `SchemaForm` tracks whether any input inside it is focused (`onFocusCapture` / `onBlurCapture`) and gates the re-seed on it, so a value arriving while the user is editing waits for the blur. Being a predicate rather than an inline condition is what makes it unit-testable.

**The drag-scrub** (`lib/scrub.ts`) is `scrubValue(start, dxPixels, sensitivity, fine)`. `NumberField` and `SliderField`'s label capture the pointer, record the start value, call `scrubValue` with the accumulated `dx` on each move and `onCommit` on release. ⇧ during the drag applies `FINE_FACTOR = 0.1`. Pointer Events rather than mouse events and no pointer-lock — Safari-safe by construction, and the capture matters more here than it did in the dock era: this form floats over a canvas that orbits on pointermove, and the two are DOM siblings (§17.5).

**The form serves ONE target** (foundations T2). M5A's inspector could select N entities and edit them together; the field chrome that replaced it edits one thing, so `values: unknown[]` had become an array of length 1 and every renderer still carried a branch for a disagreement it could no longer be handed. `value` is singular now, `lib/mixed.ts`'s `isMixed` is deleted, `lib/vec-fan.ts`'s `fanComponent` is `lib/vec-component.ts`'s `setComponent` (there is no fan left), and `commit-guard.ts` dropped the NaN-baseline arm that encoded "mixed, so always commit". What survives from the multi-target era on its own merit: omitted fields seed from the schema's `default` rather than showing `0`; and two "no member matches" branches, kept because a value matching no enum member is also what a STALE param looks like — `EnumField`'s placeholder and `SegmentedField`'s `null`. (The `Checkbox` primitive keeps its indeterminate glyph regardless: Radix's `CheckedState` is tri-state whatever the caller passes.) `ColorField` commits on the input's native **`change`** event rather than on blur — Safari only blurs `<input type=color>` when focus moves to a focusable element, so a blur commit landed only if the user's next click happened to be one.

### 9.6 Labels, numbers, and the label column

Field and section labels are **humanized** (`frontend/lib/humanize.ts` — `castShadow` → "Cast Shadow"), applied in `FieldRow`, the object-group header and every bounded control's own caption. Numeric DISPLAY is rounded on the data surface: `inspector/lib/format.ts`'s `roundForDisplay` strips IEEE-754 noise (`1.2000000000000002` → `1.2`) in `NumberField` and `SliderField` — **full precision stays in the value**, and because the rounded number is ALSO the dirty-check baseline (`lib/commit-guard.ts`'s `commitIfChanged`), a focus-and-blur with no edit never commits a truncation. Vec and quat rows show x/y/z(/w) axis chips; `QuatField` renders Euler XYZ degrees.

Every row's caption sits in ONE app-wide label column — `--spacing-label-col` (5 rem) in `styles.css`, ruled at the F4.5 gate (§18). A per-surface width is how two forms in one cockpit come to disagree about where their values start.

**Euler / quat duplication (`lib/euler.ts`).** The `quatToEulerDeg` / `eulerDegToQuat` math is hand-rolled in the inspector because the frontend cannot value-import `@furnace/core` (§7). The conversion matches `core/transform quat.fromEuler` (intrinsic XYZ) and is pinned to core's convention by a test. It is the only remaining frontend duplication of core logic in this module — the material `"default"`-kind detection that used to sit beside it (`lib/resource-kind.ts`) travelled out with the resource/ref pickers in F4.5b Task 11.

**Swap escape hatch.** The `frontend/inspector/` boundary is the swap seam: replacing the rendering library means rewriting only `SchemaForm.tsx` + the field renderers in `fields/`, keeping the module's CONSUMER untouched. The `JsonSchemaNode` type and the `onPreview` / `onCommit` / `onCancel` / `onInvalid` callback contract are the stable interface.

## 10. *(retired — scene-loader coverage)*

This section tabled the built-in registry of `@furnace/core/scene` — the geometry / shader /
texture / material / effect kinds, the five components, the settings schema and the
physics-from-data rule — because the daemon's registry bundle (§3) validated `scene.*`
mutations against exactly that set. **The module, the bundle and the commands were all
deleted in foundations T2** (2026-08-05), so there is nothing left to table. The number is
kept vacant rather than renumbered; git history is the record of what it said.

## 11. One Field F1+F2a — the FieldHost, the tools, and the remesh worker (2026-07-16)

**§11–§15 are the FIELD TOOL as built, slice by slice.** Everything here about the host, its
workers, its catalogs and its ops is current — this is the machinery §16–§18's chrome drives.
The one thing to read past is the CHROME of the era: `FieldPanel`, its toolbar and its layers
row were deleted across F4.5a/b (§16.7, §17.9), and each mention below carries its own note
saying where the organ went. Where a later slice changed a host contract, the change is
recorded inline at the claim it falsified rather than left for the reader to reconcile.

- **`FieldHost`** (`field-host/field-host.ts`) — a PreviewHost-class host (own
  canvas/context/camera/rAF loop) owning the field authoring loop: a
  `@furnace/core/field` store + op log (undo/redo = chunk-keyed two-channel inverse
  deltas, ⌘Z/⇧⌘Z), LMB tool strokes, RMB fly-look + WASD/QE (camera-control reuse), a
  **flat-shaded** (`shader.normalColor`, unlit normal-distinct — material classes
  deliberately indistinct here) vs LIT (per-class colors visible) toggle — F4.5a renamed
  the pair `normals`/`studio` and made `studio` the default (§16.5), ground grid + origin marker (blank-canvas bootstrap).
  Threaded to the chrome through the `/engine.js` runtime channel (the same channel the
  now-deleted PreviewHost used) — the chrome never value-imports engine code;
  `tests/frontend-no-engine-leakage.test.ts` machine-enforces the ban against
  `@furnace/core`, `field-protocol`, AND `field-host` value-imports.
  What is actually IN that closure — all 293 bindings assigned to 23 clusters, with every
  cross-cluster read and mutation listed — is mapped in
  `docs/reference/field-host-clusters.md`, which is what any further extraction out of it
  should be planned against.
- **Tools (F2a)** — `setTool({effect, materialId})` over dig/fill/paint;
  `setMaterialTable` (re-marks all chunks dirty — a table swap re-buckets the world).
  Targeting is the pure `shared/field-brush.ts`: surface hits bite 0.7·radius INTO rock,
  an embedded eye mines radius-deep ahead, kit fills snap to the 0.5 m lattice
  (`snappedKitBox` — the host constructs only valid kit ops by design). A
  hologram-blue **ghost marker** (ring for spheres, box edges for kit fills) shows the
  target every frame. Default radius 1.25 m (max 4). Rendering: per-class organic
  sub-meshes + kit backing (lit materials from the table) and ONE instanced kit draw
  per chunk (white litInstanced material; piece color × variant jitter rides the
  per-instance tint). F1's dig-feel backlog entry resolved here; the F2b feel register
  (`fill-tool-solid-volume-surprise.md`) was resolved in F2b — stamps + hollow fill +
  the filled kit ghost (§12). The F2b gate's deferred remainder was consumed into the F4.5
  stage and is discharged except for one item, now its own entry:
  `docs/backlog/editor-and-tooling/editor-M5B-viewport-interaction.md` §"A box selection is two clicks, not a press-drag-release".
- **Remesh worker** (`frontend/field-worker.ts` + `field-host/field-protocol.ts` /
  `field-host/field-client.ts`) — a third frontend bundle entry that imports core's mesher +
  skinner DIRECTLY (engine code; the project `/engine.js` is not involved). v2
  protocol: 20³ density+material apron pair + the material table in, per-class mesh
  buckets + kit instance lists out, buffers transferable both ways; dirty-SET
  coalescing lives host-side. Measured 0.71 ms median per 16³ chunk WITH dispatch +
  skinning (M1, bun/JSC; 5 ms ceiling asserted in tests).
- **Catalog (F2a)** — the project→editor world-materials contract, DATA only: the
  panel fetches `/catalog/materials.json` off the daemon's project-root GET mapping
  (no new command), parses it with the setup-loud `shared/catalog.ts` hand validator
  (typed `CatalogError` naming the offending path; type-only core imports — leakage
  guard clean), and applies it via `setMaterialTable`. Absent file → builtin rock-only
  + status note. Catalog-wins semantics vs the artifact's embedded table (the
  embedded table is the GAME's snapshot); Load-until-catalog-settles hardening is an
  F2b carry-over (resolved in F2b — see §12's module extractions).
- **FieldPanel** (panel id `field`) — thin chrome: world name **empty by default**
  (explicit name required — the W3/W4 gate-clobber fix), tool radios (Dig/Fill/Paint)
  + material dropdown (all classes for Fill, organic-only for Paint, hidden for Dig —
  conditional axes), radius slider, shading toggle, New/Load/Save/Bake+make-default.
  Saves/bakes ride the existing destination-agnostic `generation.bake`; loading uses
  the ONE daemon command **`field.load`** (root-contained read via the shared
  `readSiblings` helper — manifest + base64 chunks + material siblings + oplog; a
  dedicated path-traversal rejection test guards it). Host lifecycle is v0:
  panel-reopen re-init throws and is surfaced as a panel status.
- **Init robustness** (`lib/init-when-sized.ts`) — **RETIRED at F4.5a (D-1).** All three
  hosts (viewport, preview, field) deferred init to the first NONZERO canvas measure via a
  one-shot ResizeObserver, because dockview panels mounting hidden (e.g. behind the Field
  tab) latched core's "width and height must be positive" throw until a manual tab-close +
  refresh. With one full-window canvas sized by the layout contract there is nothing to
  wait for: init is EAGER and a zero measure THROWS (§16.1). Distinct from
  resize-RENDERING, which the host still owns via `gpu.onResize`.

## 12. One Field F2b — the palette (2026-07-21)

The tool system over F2a's material field. Three Safari gate rounds (the third
accepted); two rounds were consumed by ONE pre-existing core bug — `frame.drawLines`
built an invalid pass on MSAA contexts, so every field-viewport line overlay (grid,
dig ring, selection) had rendered NOTHING since F1. Record + rules:
`docs/learnings/2026-07-21-invisible-line-overlays.md`.

- **Brush chassis** — `FieldTool { effect: dig|fill|paint|smooth, materialId, mask,
  smooth, hollow }`; masks map to core `BrushMask` (selection choice embeds the host's
  current `SelectionSpec`; no selection → mask dropped + reported). Shortcuts: `[`/`]`
  + wheel = radius, **Alt-click eyedropper** (samples the aimed cell's class),
  **Shift-held = momentary Smooth**, **Ctrl-held = momentary Dig**; `subscribeTool`
  mirrors the effective tool back to the chrome. It began as a HOST-initiated-only seam
  (eyedropper, momentary enter/leave), then took the brush RADIUS alongside at the F4.5
  gate's W-2 (§18), and is a plain STATE seam since foundations T3b2 (§22.8): every set
  that changes something publishes, and subscribing pushes the current pair. Two clauses of
  the host-initiated era survive and both are load-bearing — a `setTool` landing under a held
  modifier re-derives, so the push carries the DERIVED value rather than what the caller set
  (which is why a mirror must value-compare before pushing back), and that re-derive
  notifies UNCONDITIONALLY, so it is the one path where an identical set publishes an
  identical payload. The kit-fill ghost renders as a
  translucent solid cube (rebuilt per snapped-size change) plus edges; the brush ghost
  persists off-canvas so panel-slider size drags preview live.
- **Selection (a tool class, not an op)** — `setGesture("box"|"material"|"void")`
  arms LMB gestures (applyTool bypassed; F3b widened the setter to one armed-gesture
  slot that also holds the `segment` brush — §14; F4.5b added `pointer` to the same
  slot and made it the DEFAULT a host opens armed with, so the first click on a world
  selects rather than digs): box = two clicks with an anchor cross + a
  LIVE snapped-region preview following the cursor (fix round 1); material/void =
  one-click floods seeded from the raycast hit / its last-air `prev` voxel,
  `SELECTION_UI_BUDGET = 200_000` under core's ceiling, truncation surfaced in the
  panel. Amber AABB overlay (occlude:false), `reselect()` one-slot restore,
  `subscribeSelection` + `subscribeToolError` feed the panel footer. Cell-level
  display was deferred to F4 and LANDED at F4.5b (§17.7).
- **Layers + slice** — the state itself (the flags, the plane, `sliceOpts()`, and both
  facade seams) lives in `field-host/field-view.ts` since foundations T3b1 (2026-08-06),
  not in the host; behaviour unchanged by the move (§20.3), and all 25 read sites stayed
  behind as calls (`viewState.layers()` / `viewState.sliceY()` / `viewState.sliceOpts()`).
  `FieldLayers { field, kit, props, ghost, selection, grid,
  flags, voidCast }`; the first SEVEN gate the render lists per frame (display-only; a
  hidden selection keeps masking ops), and two of them arrived later: `props` with F3b's
  placed-prop layer (§14) and `flags` with F4's advisor markers (§15). The eighth,
  `voidCast`, is NOT a plain gate — it is F3b's X-ray view mode, default off, built by its
  own enabling edge and dropped by the next edit (§14); `LayersRow` renders it under a
  separate "view" group and machine-checks the split with
  `type VisibilityLayer = Exclude<keyof FieldLayers, "voidCast">`. F4 Task 11 additionally
  reshaped the rendered set from an ARRAY into `LAYER_TITLES: Record<VisibilityLayer,
  string>` (the row's labels are its keys, so there is one string per layer), which makes
  the group EXHAUSTIVE rather than merely closed: an extra key already failed to compile, a
  MISSING one did not — which is exactly how `flags` first shipped with no toggle at all.
  The
  Ghost checkbox is DISABLED with a hint while a selection tool is armed and no stamp
  session runs (suppression honesty — the brush ghost is mode-suppressed but the stamp
  hologram is not). Slice = **remesh clip**: the worker clamps aprons at/above `sliceY`
  (density→air, material→rock) before mesh+skin, yielding capped cuts for free;
  `raycastField { maxY }` makes ALL gesture raycasts + the buried-eye probe
  slice-coherent ("what you see is what you target" — an executor extension of the
  spec's targeting rule, adopted).
- **Stamp sessions** — `field-stamp.ts` pure session transitions (run-counter
  supersession; stale previews dropped) + host `startStamp` (region = current
  selection, snapped outward — or, with NO selection, an ARM for region-draw
  published on `subscribePendingStamp`, rather than a refusal: F4.5b, D-F4.5-7) /
  `updateStamp` / `rerollStamp` (crypto uint16 seeds) /
  `nudgeStamp(dx,dy,dz)` in 0.5 m lattice steps (panel buttons + arrow keys, world
  axes, ⇧↑/⇧↓ = ±Y; known focus trap: a nudge-button click moves focus off-canvas —
  gate-findings item 6) / `commitStamp` (core `commitGenerator` — one undo entry,
  entity op recorded) / `cancelStamp`; Enter/Esc. Preview = scratch-store evaluation
  in the worker (`stamp-preview` protocol v3 request; region+halo chunk snapshot,
  density buffers COPIED then transferred), meshed via the same path and rendered as a
  hologram-blue translucent ghost — surface buckets only, no kit pieces (documented
  v0). Ghost-vs-commit divergence window: ⌘Z during a live keep-existing-air
  session (documented, accepted at gate; F4.5b narrowed it from "strokes/⌘Z" — both
  field-writing arms are suspended while a session stands, D-F4.5-7).
- **Panel restructure** — `components/field/`: ToolPalette (brush + selection tools +
  one button per generator from `listGenerators()`), MaterialSwatches (persistent
  strip, eyedropper-tracked active ring), BrushInspector (radius/mask/smooth/hollow —
  plain controls, NOT SchemaForm), StampInspector (SchemaForm over the generator's
  paramSchema + visible hand-editable seed + ⚄ re-roll + merge policy +
  Commit/Cancel), EntitiesList (▦ rows → footprint highlight; F3a made rows the
  smart-object surface — Open/Freeze/Bake, §13), LayersRow + slice slider,
  FieldToolbar. *(F4.5a: `LayersRow` and `FieldToolbar` are deleted — the layer gates and
  the slice slider moved to the top bar's View popover, the world verbs to the shell, and
  the catalog fetch to `hooks/useCatalogs.tsx`; §16.)* The controls stack is bounded
  (scrollable) and the canvas cell floors at `min-h-24` — it can never reach zero
  (measured fix; the unclamped-resize core hop is
  `docs/backlog/engine-architecture/resize-unclamped-zero-size-canvas.md`).
- **Field-first default layout** — `DEFAULT_LAYOUT_PANELS = ["field", "inspect"]`
  (World + scene Viewport + Entities leave the DEFAULT only; `PANELS` still owns
  View▸Panels re-add). Persisted layouts unaffected; View▸Reset lands on the new
  default. *(F4.5a: deleted with the dock. The layout is now the fixed Shell contract
  plus a floating palette arrangement — §16.1–§16.2.)*
- **Load gating (F2a carry-over closed)** — Load stays disabled until the catalog
  settles (success or 404-fallback); catalog-wins semantics stand.
- **Host extractions (F2a carry-over closed)** — pure modules with tests:
  `field-kit-render.ts` (yawQuat/pieceColor/packKitMatrices — since folded back into
  `field-host.ts`/`catalog.ts`), `field-ghost.ts`
  (ring/box batch math), `field-stamp.ts`, `input-map.ts` additions; FieldHost keeps
  the GPU calls.
- **Core underneath (see `core-modules.md`)** — the FieldOp union + op-list undo,
  masks, smooth, hollow fill, selection, the generator registry (hall + maze; cave + scatter
  joined at F3b — §14) + `commitGenerator`, raycast `maxY`; and the two F2b frame fixes: drawLines
  MSAA-awareness and blend-partitioned draw order (translucent ghosts now draw over
  instanced kit).

## 13. One Field F3a — smart objects (2026-07-23)

Committed generators became reconfigurable smart objects; the editor half rides the
F2b stamp-session machinery end to end.

- **Reconfigure session** — an EntitiesList row's Open starts a stamp-mode session
  seeded from recorded provenance (`startReconfigureSession`; params/seed/region;
  merge policy is NOT recorded — opens at core's `"replace"` fallback, surfaced in the
  inspector). Same ghost-preview worker path (known v0 limit: the ghost previews
  against CURRENT field state — `docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Reconfigure ghost previews against CURRENT field state*); StampInspector
  relabels commit as **Apply** → `applyReconfigure` runs core `reconfigureGenerator`
  (in-place span splice, affected-set-culled downstream replay), remeshes the dirty
  set, ONE undo entry. Frozen entities refuse Open at the row (badge + reason);
  freezing cancels a live session on that entity.
- **Freeze / Bake verbs** — row buttons (inline, not a menu — the original reason, Radix
  portals not rendering under the happy-dom harness, no longer holds; three verbs simply
  sat under the threshold where a menu earns its click) through core `setGeneratorFrozen` /
  `bakeGeneratorEntity`; bake confirms through the App-owned `useConfirmDialog` (stays
  inside the no-clobber + keybinding-suppression guards). `subscribeEntities` ticks the
  panel on entity-record changes that dirty no chunk (freeze/bake/undo of either).
  *(F4.5b Task 4 adopted D-14's glyph map — freeze / bake / delete (emoji then, lucide SVG
  since the F4.5 holistic gate — see §the entities palette below), with Open
  keeping its word until D-13's session card takes it — added `deleteEntity`, and made the
  row half of a bidirectional selection sync with the viewport. Duplicate is deliberately
  NOT a row verb: `FieldHost.duplicateEntity` exists and Task 7 binds it to ⌘J and the Edit
  menu, per the mock's burger placement.)*
- **Drift report** — `applyReconfigure` pushes core's drifted/orphaned findings to
  `subscribeDrift`; `DriftReport` renders a dismissible list, click → `frameChunks`
  (fly-camera orbit-target re-center on the chunk-set centroid). The report clears on
  ANY history step (undo/redo — an F3a gate fix) and on world load; never recomputed.
  F4.5b Task 4 widened the push to a `FieldDriftReport` = `{ findings, entityIds }`, where
  `entityIds` is the committed entities whose FOOTPRINT box the findings' chunks fall in —
  the palette's Δ badge rows. Derived host-side and at push time, because only the host
  holds both inputs (the findings speak chunk keys, the rows entity ids, and relating them
  needs `CHUNK_DIM · cellSize`, which the chrome cannot value-import core to reach). The
  alternative — publishing each entity's chunk box down `listEntities()` — was built first
  and removed: it allocates a key per chunk of every footprint, growing with the CUBE of
  region size, on a general read whose other callers never want it.
- **Op-cost meter** — `logStats` fields appended to the field footer line, pushed with
  the rAF stats under a log-signature dedup (ops/undo/redo lengths). Compaction runs
  at WORLD LOAD only (`COMPACT_THRESHOLD_OPS` 200): core's `compactRuns` requires a
  quiescent history (both stacks empty — its splice/entity-update entries address
  `log.ops` by position; durable fix backlogged as
  `field-log-entries-anchored-by-index.md`). A failed fold never fails a load.
- **Entity selection box = stamped footprint** (F3a gate fix) — the box outlines
  `generatorFootprint(log.ops, entity, cellSize)` (union of the span's op bounds,
  patch-op aware; pure, in `field-ghost.ts`), falling back to the recorded selection
  region only when the span holds no field-writing ops. The recorded region routinely
  over-draws the content (stamps anchor at the snapped min corner, size from params).
  F4.5b turned it from a display-only `highlightEntity` call into the emphasis of the
  host's ONE entity selection (`selectEntity` / `subscribeEntitySelection`, written by
  the `pointer` gesture) and repainted it in the chrome's `--primary`, so the palette
  row and the viewport box agree by colour as well as by state. The footprints are
  memoized per log mutation — the pick needs every entity's box on every click.
- **Stamp ergonomics** — `deriveSizeDefaults` seeds hall w/h/d and maze cellsX/Z from
  the active selection's extent (clamped to schema bounds; maze fit =
  `floor((extentCells − 1) / MAZE_PITCH_CELLS)`, the pitch now a public core
  constant); quarter-turn `rotation` + per-wall door offsets ride the generator
  schemas (core F3a) straight into the SchemaForm.
- **Field undo/redo as host API** — `FieldHost.undo()/redo()`, at the time a SECOND
  history beside the scene document's; the canvas ⌘Z handler was made to
  `stopPropagation()` because it was ALSO stepping the scene undo (pre-existing, fixed
  here; F/Delete still leak by design pending a semantics decision, noted at the fix
  site). *(T2: the scene history is gone, so the field log is now the editor's ONLY
  history — §17.6.)*
- **Deferred UX set** — mouse-driven region move, an in-viewport pointer/select tool, and
  box/wand selection feel. All three were taken by the F4.5 stage: the pointer tool and the
  committed-entity move shipped (§17.1, §17.3), and what is still owed is two entries —
  `editor-M5B-viewport-interaction.md` §"A CREATE session's ghost cannot be dragged" and `editor-M5B-viewport-interaction.md` §"A box selection is two clicks, not a press-drag-release".

## 14. One Field F3b — scatter authoring, placed props, and two tools of its own (sealed 2026-07-25)

The editor became the third consumer of core's F3b placement work (after the generator
itself and the dungeon's field-world loader): it authors scatter stamps and renders the
props they commit. It also gained two tools of its own that owe nothing to placements —
the void cast (an X-ray view mode) and the segment brush (a two-click swept capsule).

- **Entity catalog** — the second project→editor catalog contract, DATA only, exactly
  parallel to the F2a materials one: the run-once catalog effect (FieldToolbar's then,
  `hooks/useCatalogs.tsx`'s since F4.5a) also fetches `/catalog/entities.json`, parses it with `shared/catalog.ts`'s setup-loud
  `parseEntityCatalog` (same `CatalogError`, path-naming, type-only core imports) and
  installs it via `FieldHost.setEntityCatalog`. Both fetches live in ONE effect so they
  cannot race onto the status line; only MATERIALS gates Load (props render from the op
  log whether or not the entity catalog resolves). *(F4.5a: the status line is gone —
  a catalog error is a toast plus a durable log entry, §16.3.)* The parser normalises the catalog's
  authoring vocabulary into the scatter generator's param spelling (`scaleRange` →
  `scaleMin`/`scaleMax`) and deliberately drops the `meshes` paths — editor props are
  proxies (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Editor props render as collision PROXIES, not the archetype's actual meshes*). **The catalog SEEDS, it never gates:** absent
  file → scatter still runs on schema defaults and every prop draws at a nominal 0.5 m box.
- **Archetype-driven params** — `listGenerators()` fills any generator's `archetypeId`
  property with an `enum` of the catalog ids (`withArchetypeOptions`); the inspector's kind
  resolver reads `enum` first, so the SchemaForm field renders as a picker instead of free
  text. `startStamp` overlays the chosen archetype's authored `scatter` block on the schema
  defaults (`seedArchetypeParams`). Seeding is ONCE-at-open — switching archetype
  mid-session keeps the current numbers
  (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Switching archetype mid-session keeps the previous archetype's scatter hints*).
  **`listGenerators()` is a SNAPSHOT, and the catalog necessarily lands after the first
  possible read** (engine-ready fires before an async fetch can settle), so the catalog
  owner signals once the catalog is installed and the panel re-reads the registry — the
  toolbar's `onEntityCatalogInstalled` callback then, the catalog provider's
  `entityCatalogTick` since F4.5a. The signal carries NOTHING — the host is the source of
  truth, and a payload would invite reading it instead. Reading once left `archetypeId` free text
  forever. **Both halves are pinned, in the two files the two halves belong to** — which
  host-level tests structurally cannot do, because they install the catalog first. The
  INSTALL half is `tests/chrome/host-seams-and-catalogs.test.tsx` ("the entity catalog is
  fetched, parsed and installed on the host"). The RE-READ half is
  `tests/chrome/session-card.test.tsx` ("archetypeId becomes a PICKER when the catalog
  lands AFTER the card opened"), which opens the session BEFORE the fetch settles so the
  card's mount-time read is the pre-catalog one, then asserts the field turns from an
  `<input>` into D-25's segmented control and that `listGenerators` was last called AFTER
  `setEntityCatalog`. It sits there because `shell/SessionCard.tsx` is where the
  `entityCatalogTick` consumer lives.

  *(Corrected 2026-08-07. This passage read "the RE-READ half currently has no pin … the
  re-read case went with the panel" — written when `field-panel.test.tsx` was folded into
  `host-seams-and-catalogs.test.tsx`. The case did NOT go with the panel: it was ported to
  the session card in `c0ad6d07` (2026-07-31, the commit that created that file — its own
  comment says "review B1, ported from the panel"), so the gap was already closed when it
  was written down. Verified by sabotage: forcing the `entityCatalogTick` effect to
  early-return reddens that case.)*
- **Context-threaded preview** — `stamp-preview` now passes an `EvaluateContext { store }`
  (the scratch store the snapshot was installed into) for any `contextFree: false`
  generator, which is what lets scatter's ghost read the field at all. `stamp-previewed`'s
  `placements` reach the session as `placementCount` and the ghost as ONE merged
  hologram-blue wireframe batch of oriented proxy boxes (`placementGhostBatch`,
  `occlude:false`, under the `ghost` layer gate). No mesh loading in the ghost (v0).
- **Committed prop layer** — the cluster (`rebuildProps`, `proxyGeometry`, `destroyProps`
  and the per-archetype instance counts) lives in `field-host/field-props.ts` since
  foundations T3b1, not in the host; behaviour unchanged by the move (§20.3), and the nine
  call sites below stayed behind. It rebuilds one instanced draw per archetype from
  the op log's `PlacementOp` records: `groupPlacements` (group size = instance count) →
  core `packPlacementMatrices` over `proxyRecords` (the collision primitive's extents folded
  into each record's scale) on a unit cube / sphere / cylinder, tinted per archetype on the
  shared `litInstanced` kit material. Called from every path that changes which placement
  ops are in the log — commit, reconfigure apply, ⌘Z/⇧⌘Z, world new/load — plus `init` and
  `setEntityCatalog`; placements dirty NO chunk, so the layer cannot ride the remesh drain.
  Whole-layer teardown-and-rebuild (instance counts are fixed at creation). The layer is
  otherwise write-only GPU state, so `FieldHost.propInstanceCounts()` exposes its
  per-archetype instance counts — the one readable fact, and what the rebuild is held to in
  tests. Two filed gaps: props are NOT slice-clipped
  (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Placed props ignore the slice plane*), and the rebuild is UNCONDITIONAL — it runs whether or
  not a placement op actually moved, re-creating the three unit proxy geometries each time
  (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *The editor's prop layer rebuilds unconditionally*; a change-detection signature has to cover
  record CONTENT, since a re-cook can return the same count at different poses).
- **Entity rows carry a prop line** — a scatter is an ordinary generator entity, so F3a's row
  already had every verb and the generic params `<dl>`. What it lacked is the one fact the row
  summary could not carry: a scatter writes NO field cells, so "1 ops" says nothing about what it
  put down. `listEntities()` now returns `FieldEntityInfo` = core's `GeneratorEntity` + `placed:
  PlacedArchetype[]`, attributed by `placementsByEntity` — a placement op belongs to the entity
  whose `opSpan` contains its op id (orphans are skipped; no commit path makes one) — and the row
  reads `scatter · seed 3 · 1 ops · rock · 24 placed`. A row with no records shows nothing extra,
  deliberately UNLIKE the StampInspector's zero rule, which gates on the generator
  (`FieldGeneratorInfo.placesProps`) and does show `0 props`: a settled preview at zero is the
  state whose commit refusal it is about to explain, whereas a committed row has no such state and
  the chrome sees records, not schemas. The panel's `sameEntities` push guard gained a `samePlaced`
  leg — it had none when `placed` shipped, so a tick whose only change was a placement count could
  be swallowed as "nothing changed" — plus a destructure-and-`satisfies Record<string, never>`
  exhaustiveness backstop, so a field added to core's `GeneratorEntity` can no longer land in this
  intersection without the compiler forcing the comparison question. (`type` and `region` are deliberate non-compares;
  `params` was one too until F4.5b Task 4 closed it — compared through the row's own
  `formatParam`, since what must not go stale is the string the `<dl>` shows.)
- **Prop drift in the chrome** — reconfiguring an upstream generator (a cave) leaves the
  scatter's records byte-identical (a placement replays as data) but flags the op
  `drifted`; core's D-F3-4 finding now reaches `DriftReport` through the existing
  `subscribeDrift` seam with no editor-side work beyond the test that pins it.
- **Empty-result policy (settled)** — core rejects an evaluate with no ops AND no
  placements, and KEEPS that stance. Right for a carver, wrong-feeling for a READER driven
  to zero props, so the EDITOR refuses first — but for PROP generators only
  (`def.emits !== "ops"`, core's own declaration — D-F4-15): `previewIsEmpty(session)`
  gates both `commitStamp` and `applyReconfigure` and reports a sentence about props
  through `subscribeToolError`, while a carver still goes to core and surfaces core's own
  wording ("raise density, lower spacing" is nonsense advice for a hall). Core never sees
  the empty commit for the case it reads wrong. StampInspector shows `N props` beside
  `N ops` for a prop generator whenever a preview has settled, including at zero, and never
  for a carver. The F3b review settled the open design question; core's
  `field-scatter.test.ts` pins the strict side, and its comment records the decision.
- **Entity footprint covers placements** — `generatorFootprint` grows by each record's
  `position ± scale/2` world AABB (core's own placement-bounds convention), so a pure
  reader's selection box outlines its props instead of falling back to the recorded
  selection region.
- **The void cast — an X-ray view mode (D-F3-15)** — sealed with its pixels visually
  UNCONFIRMED (accepted gate variance: round 1 predated the visible-refusal fix
  `10551f9e`, so the user never distinguished refusal from silence; the lifecycle is
  GPU-test-held, the render is not pixel-checked — the `2026-07-21-invisible-line-overlays`
  caution applies until someone sees it). F4's marker layer took the OTHER route and is
  pixel-CONFIRMED at its gate, by a committed re-runnable recipe
  (`packages/editor/scripts/analyzer-pixel-check.md`, §15) — which leaves the void cast the
  one field overlay whose render nothing has ever checked, and gives whoever checks it a
  template. `FieldLayers.voidCast` is the one flag
  with an EDGE effect. false→true copies every allocated chunk's density into ONE worker
  `void-cast` job (a copy, because the client TRANSFERS the buffers and sending the store's
  own would detach the field). The worker installs the snapshot into a scratch store, and
  per chunk extracts the 20³ apron FIRST, then inverts that window
  (`d === 0 ? -1 : min(AIR, -d)` — the clamp covers a decoded −128, which nothing in core
  writes but a chunk file can carry, and which negates back to itself), then meshes it with
  the ordinary `meshChunkField`. Inverting AFTER extraction is load-bearing: the apron's
  outer ring reads unallocated space as SOLID, which is what the real field holds there, so
  the cast caps against the rock outside instead of running open past every allocated
  boundary. Host side: one mesh per non-empty bucket at chunk origins, all under a dim-CYAN
  premultiplied material at `depth: { write: false, compare: "always" }`. Depth-always is
  the load-bearing half — under the default `less` ANY nearer front-facing opaque surface
  (a terrain top, a nearer cavity's far wall, kit, props) buries the cast, which is exactly
  the case the tool exists for. It is NOT a z-fighting fix: the cast's triangles ARE the
  field's, wound backwards, so back-face culling already keeps exactly one of any coincident
  pair. It is submitted FIRST of the three translucents: all three sort after every opaque, so
  this position decides nothing against the field, but submission order IS preserved within the
  blended group — submitted last, a depth-ignoring cast would wash cyan over every ghost in the
  frame; submitted first, the two hologram ghosts (which keep the default depth compare) read on
  top of it. A ghost is the action the user is steering; the cast is the room around it.
- **Void-cast refusals + lifetime** — the whole cluster (`requestVoidCast`,
  `invalidateVoidCast`, `voidCastGen` / `voidCastJobGen`) lives in
  `field-host/field-voidcast.ts` since foundations T3b1, not in the host; behaviour
  unchanged by the move (§20.3). Four refusals, in the order a user meets them, all via
  `subscribeToolError`: a cast already in flight (the client is one worker with a synchronous
  per-message handler, so a second sweep would delay every remesh behind it); an empty world;
  a world over `VOID_CAST_CHUNK_BUDGET` = 512 chunks (measured at that ceiling as ~630 ms–1.3 s
  of worker time depending on fill, on bun/JSC — and browser V8 is not JSC, so re-measure
  before moving it); and a torn-down context, which is silent by design. Refusing where
  COALESCING belongs is a filed gap, not a settled shape
  (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *The void cast monopolises the one field worker*): there is no cancel — an invalidated job grinds on
  in the worker — and a toggle-off-then-on during a cast drops the user's last intent instead
  of queueing it, though `createPreviewCoalescer` already solves exactly that for the stamp
  preview. **The sequence to watch at the gate**, because it will read as "the editor
  hitches" and be hard to attribute: enable the cast on a big world → immediately dig → the
  stroke lands but its remesh queues behind ~1 s of cast work, so the viewport freezes → and
  the cast, when it arrives, is thrown away by the very edit that was waiting on it. Every
  part of that is working as designed; the whole is not. The cast also ignores the slice
  plane — `requestVoidCast` sends the worker no `sliceY`, so the X-ray paints over the cut
  (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Placed props ignore the slice plane*, third instance; arguably right for an X-ray, but it is
  the third display layer to disagree with the slice and wants one rule with the other two).
- **Void-cast lifetime — it is a snapshot, not a live view** — `invalidateVoidCast` sits at the single density-mutation
  choke point (strokes, stamp commits, ⌘Z/⇧⌘Z, reconfigure apply) and DROPS the cast, saying so
  — a silently vanishing X-ray beside a still-ticked box would read as a bug — and it is
  self-limiting, since the second mutation finds nothing live and returns. Re-toggle to refresh;
  a `setLayers` call that merely leaves the flag true rebuilds nothing, which is also why the
  cast stays gone across a dispose/re-init or a world load while the flag rides through.
  Two pieces of state keep this honest: `voidCastGen` strands in-flight results after a discard
  (nothing can call the worker off, only agree to ignore it), and `voidCastJobGen` is the
  single-flight latch — cleared in BOTH `.then` and `.catch` BEFORE the staleness guard, since a
  stranded job that left it set would refuse every later cast forever.
- **The segment brush (D-F3-14)** — a two-click swept capsule. `setGesture("segment")` arms LMB
  from the same ONE slot as the three selection gestures (arming any disarms the rest); the first
  click sets an anchor, the second builds ONE `{ kind: "capsule", a, b, radius }` op and commits
  it through the ordinary log path — so it is one ⌘Z, exactly like a stroke, and needs no undo
  machinery of its own. Both endpoints are `selectionPoint`'s RAW surface hits, not
  `computeTarget`'s bitten-past centres: a tunnel must start and end where the user clicked (the
  box-select corner rule). It is a BRUSH gesture, not a selection — it makes no selection, and the
  active tool's effect/material/mask/radius stay live under it (dig carves a tunnel, fill raises a
  rampart). That is why the panel keeps `BrushInspector` open for `segment` and hides it for the
  other gestures (`brushLive = gesture === null || gesture === "segment"`), why
  ToolPalette keeps the brush effects highlighted under it, and why picking a brush effect disarms
  a SELECTION gesture but deliberately leaves `segment` armed ("sweep a rampart instead of a
  tunnel", not "stop segmenting"). It WAS also the first editor gesture with unbounded op
  extent — every other one is bounded by construction (a stroke's sphere by `digRadius`, a
  kit fill by the snapped box, a flood by `SELECTION_UI_BUDGET`), but the fly camera stays
  live between the two clicks, so the sweep length is whatever the user walks and the op cost
  is linear in it. F3b shipped it uncapped and recorded the asymmetry with the void cast's
  same-phase budget; **F4 closed it** — `MAX_SEGMENT_M` (§15).
- **Segment preview + failure path** — the preview is the WHOLE preview: a hologram-blue anchor
  cross plus the wireframe capsule the second click would commit (`segmentGhostSegments` in
  `field-ghost.ts` — a 16-segment ring at each endpoint plus 4 rails, degenerating to the sphere
  ghost below a 1e-6 axis length), both under the `ghost` layer, since a pending capsule is a
  preview of a brush op rather than a selection. No worker ghost and no scratch mesh: a brush op is
  cheap and reversible, and the generator preview protocol exists for recipes whose output cannot
  be guessed from their inputs — a swept capsule can. It is rebuilt on pointer MOVE, so a radius
  change with a still cursor does not re-fatten the pending capsule until the next move (accepted,
  and RESOLVED at F4.5b Task 9). Esc drops a pending anchor, but only when no
  stamp session owns the key — the box anchor's identical Esc is a separate UX change, filed rather
  than folded in. `commitToolOp(shape)` is the shared build→apply→report path the stroke and the
  segment both take, so both carry ONE failure contract: every setup-loud throw the apply raises —
  a kit fill off the lattice, a kit class under a non-box shape (reachable ONLY through this
  gesture), an unknown material class — is caught, reported to the panel, and the op DROPPED. (The
  op is built inside that try too; the reasoning for that placement, and its honest status, live at
  the source.) Core's half — the `capsule` `BrushShape` and the capsule branch of
  `assertOpValid`'s shape leg (finite endpoints, finite positive radius, kit-class
  rejection; T4a widened the leg to cover sphere and box too) — is in `core-modules.md`; the
  box cross-section variant is explicitly NOT shipped
  (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Segment brush: a BOX cross-section*).
- **Host extractions + the worker seam** — `field-host/field-placements.ts` (pure: proxy
  extents/scale, oriented corners, `groupPlacements`, `placementGhostBatch`,
  `placementsByEntity`, and the two catalog-seeding helpers) with
  `tests/field-placements.test.ts`, the `field-ghost.ts` precedent; `field-ghost.ts`
  itself gained `segmentGhostSegments`. `createFieldHost(deps?: { spawnWorker })` adds a
  DI seam for the worker: production omits it and gets the real `/field-worker.js`, while a test
  injects the protocol handler directly — the host's worker-backed paths are otherwise unreachable
  under `bun test`, where a job posted to a Worker spawned from that browser URL never settles
  in-process. Backlog status: `docs/backlog/editor-and-tooling/editor-test-harness-fragility.md` § *FieldHost's worker seam exists now*.

## 15. One Field F4 — the walkability advisor in the editor (tranche B, 2026-07-26)

> **SEALED 2026-07-27 (user Safari gate, no fix round).** The flag-and-fix loop, the
> flags-layer pixel toggle, prop anchoring/blocking (with a bake-and-walk inside it)
> all passed live. **Depth-testing on markers is now a USER-RATIFIED decision, not a
> default** — gate item 5c: markers are IN the world, occluded like props; the layer
> toggles are the occlusion answer, the Flags panel the per-finding see-through
> channel. Accepted variances (machine evidence stands in): quiet-by-default
> (P-F4-3b: 0 pits / worst 3 candidates on the 12 walked configs — the user was
> structurally blocked from loading a committed world by the world-management hole),
> the verify badge (Task 13: 8 browser verifies, outcomes 2 trapped / 1 clear /
> 5 inconclusive), and the segment clamp (pinned by tests; the arming flow is the
> known discoverability gap). Gate finding — selected-flag identification (the frame
> box is chunk-sized; direct-click-to-select is the wanted direction) — deferred with the
> sibling sets to the F4.5 UX stage, per the standing features-now/polish-later sequencing
> decision, and LANDED there (§17.7: the pick volume is the anchor CELL, and clicking a
> marker selects it).

The editor gained its THIRD worker: an advisor that runs core's stage-1 walkability passes
over a mirror of the field as the user digs, draws what it finds as severity-coloured
markers in the viewport, lists it in a Flags panel section, and — on demand — drives the
PROJECT'S OWN mover at one finding to see whether it really sticks.

**Advisory throughout (D-F4-1), and that is a design commitment, not a v0 limit.** Nothing
the advisor reports blocks a verb, mutates a field, or is auto-fixed. A filter HIDES a
finding and a reachability demotion tags one; neither deletes one. The only thing that
retires a finding is a re-analysis that no longer reports it — the analyzer changing its
mind.

- **The analyzer worker** (`frontend/analyzer-worker.ts` + `field-host/analyzer-protocol.ts` /
  `field-host/analyzer-client.ts`) — a FOURTH `build-frontend.ts` entrypoint beside the chrome, the
  generation worker and the remesher, spawned by URL as `/analyzer-worker.js`
  (`tests/build-frontend.test.ts` pins that all three worker bundles land un-hashed at the
  outdir root, or those URLs 404). It holds a MIRROR
  `FieldStore` and runs `analyzeChunk` / `markUnreachable` / `detectPits` from
  `@furnace/core/field` directly. All logic lives in a PURE handler factory
  (`createAnalyzerWorkerHandler({ loadEngine, post })`, the `createFieldWorkerHandler` shape),
  so the whole protocol unit-tests with no real Worker; the entry wires only the real
  `self.postMessage` and the real dynamic import.
- **The mirror is EVERY allocated chunk, not a window**, and that costs a second copy of the
  world's density (one 4 KiB `Int8Array` per chunk). A window cannot be made correct: stage
  1's ceiling scan is uncapped, so any chunk missing ABOVE an anchor manufactures a false
  ceiling and silently drops every rise beyond it. Buffers are structured-CLONED and never
  transferred — the host goes on editing its own. There is no reset verb: a world swap lists
  the outgoing keys as `removed` (upserts apply BEFORE removals, so `postMirrorSync` filters
  the removal list against the LIVE store — a new world can reuse an old key), and a
  `cellSize` that differs from the live mirror's resets it outright.
- **Re-analysis set** — a caller lists what it WROTE; the worker owns the widening.
  `reanalysisKeys` takes each dirty chunk, its 26 neighbours, and every allocated chunk BELOW
  it in its own XZ column plus the 4 CARDINAL ones, intersected with what the mirror holds.
  The column term is not belt-and-braces: `ceilingAbove` scans the anchor's own column
  uncapped and `scanRise` scans each cardinal neighbour bounded only by that ceiling, so a
  hole dug in one chunk can let a floor anchor several chunks below see through it for the
  first time. Measured on the fixture committed beside it (the "cardinal-column term is
  load-bearing" test): analysing `"1,-4,0"` before and after a floor appears inside `"0,0,0"`
  — four chunks up, one column across — goes from 0 `ledge` to 1. The cardinal spread past
  the anchor's own column is the executor's deviation from the LETTER of D-F4-9's amendment
  and miss-safe in the right direction (a wider set costs time, never correctness). ABOVE
  stays excluded: a higher chunk reads down into the dirty one only at its own bottom row,
  i.e. only when it is already a 26-neighbour. The halo's sufficiency for the BOUNDED probes
  is lattice-dependent and filed:
  `docs/backlog/editor-and-tooling/field-host-internals.md` §"Analyzer re-analysis halo assumes every bounded probe reach stays under one chunk".
- **Serialized dispatch, and it is load-bearing.** `self.onmessage` re-enters per message
  regardless of whether the previous one settled, and `verify` suspends twice (the bundle
  import, then inside `analyzerVerify`, which awaits `createWorld` BEFORE reading the store).
  A `sync` landing in either window would mutate the very `FieldStore` the in-flight verify
  captured, and the verdict would describe a half-updated mirror — not corruption, but a
  wrong answer in exactly the edit-while-verifying case the editor is for. So the handler
  chains every message onto one tail, and the tail's rejection is caught (a rejected tail
  makes every later `.then` skip its callback, wedging the worker permanently). That catch
  also MARKS the rejection handled, which silences the runtime's own report — so
  `analyzer-worker.ts`'s `console.error` is the ONLY remaining signal for the one failure the
  protocol cannot report over the wire (`post` itself throwing). Do not delete it as
  decoration.
- **jobId discipline** — every request has exactly one response, `acked` included, so a
  FAILED mirror update reaches a waiter instead of being dropped. The client's `pending` map
  discards any response nobody asked for, resolves by the response kind the request DERIVES
  (`RESPONSE_KIND satisfies Record<AnalyzerRequest["kind"], …>`), and rejects a wrong-kind
  answer rather than casting it. The dispatch's `default` arm throws through a
  `never`-parameter guard, so a new request kind with no `case` is a COMPILE error — and it is
  a real runtime refusal too, which is the half that matters: the `if/else` chain it replaces
  would have sent anything unrecognised into the LAST arm, `placements`, silently clobbering
  the collider set and acking success.
- **One `PhysicsContext` per worker lifetime.** `loadEngine` is memoized on first use and
  never re-run per verify. The ES module registry would dedupe a same-URL re-import anyway;
  what the memo adds is that a DIFFERENT url can never be loaded into this worker — the
  project's verify path holds one headless `PhysicsContext` as a module singleton, and core's
  context ids are 16-bit and wrap without aliasing detection. Only a LOAD failure drops the
  memo, so a later verify can retry a bundle that has since built.
- **Host wiring** (`field-host/field-host.ts`) — the mirror syncs at the SAME density
  choke point the void cast invalidates from, so every write is mirrored by construction. A
  latest-wins `createAnalyzePump` collapses bursts: `analyzerFire` is read at FIRE time (so
  the accumulated dirty set goes out, not the one current when a key was pressed), posts the
  mirror sync and the analysis in ONE turn, and relies on the worker's arrival-order dispatch
  rather than awaiting the ack. `undefined` leaves the latch idle. It is a COMMAND as much as
  a query, deliberately.
- **Two cadences, and the split is the whole cost story.** Per-edit passes analyse what was
  written and go out immediately. The two CONNECTIVITY passes — the reachability demotion and
  the pit hunt — are whole-world by nature (one dug cell can open or seal a trap anywhere) and
  ride an idle tail, `ANALYZER_IDLE_MS = 500`, re-armed by every density write so a drag pushes
  them out rather than running them. F4 tranche A measured the whole-world re-flood at ~72% of
  a full `analyzeWorld` on top of it (2.9–3.2 ms against 4.1–4.2 ms over 108 chunks, both
  growing with the world) — that debounce is the budget knob.
- **NOTHING is posted without an agent profile.** The advisor is parameterized on the
  project's capsule and a guessed one would be the advisor inventing its own premise, so with
  no profile the pending flags accumulate (an install later catches up in full), nothing goes
  out, and the host says so ONCE — "walkability advisor idle — this project installs no agent
  profile" — at the first edit that would have analysed, as a **`warn`** rather than an
  error (`ToolErrorSeverity`): the advisor is behaving correctly and no verb was refused, so
  this must not light the ⚠ chip on an otherwise clean boot. It is the only `warn` the seam
  sends; every refusal on it, `verifyFlag`'s included, stays `error`. Reachability + pit
  SEEDS are the loaded world's manifest `playerStart`, and EMPTY for a new world honestly
  so: both passes refuse an empty seed set outright rather than demoting everything or
  guessing where the agent enters. `FieldStats.analyzerPending` is 0–2 (1 in flight + 1
  queued; the latch admits no more) and counts work the pump would actually RUN, not flags
  the host happens to hold. Two states set a flag and owe nothing, and both read 0: no
  profile IN HAND — off, not busy — and a world with no chunks in it, where the whole-world
  request `analyzerFire` DEFERS rather than consumes has nothing to analyse until something
  is dug or loaded. `analyzerFire` and `analyzerPendingCount` decide that on ONE predicate
  (`analyzerHasWork`), so the meter cannot claim a pass the pump has already declined — the
  F4.5 gate's F-3, where a brand-new world read "1 pass owed" for the life of the session.
  `StatusBar`'s analyzer chip is absent at 0 and names the count above it, because the count
  is PASSES owed, not chunks.
- **The idle notice waits for the profile QUESTION to be answered.** `setAgentProfile` takes
  `AgentProfile | null`, and the `null` is load-bearing: the profile arrives over HTTP
  (`useCatalogs.tsx` → `/catalog/agent.json`) and the analyze pump does not wait for it, so
  "no profile in hand" reads identically before any answer and after a negative one. The
  notice is a claim about the PROJECT and its one-shot makes it permanent, so posting it from
  the in-flight state would state — for the session — whichever of two async arrivals won the
  race, on a project that may well ship a profile (proven on `packages/dungeon` by delaying
  only that one request 3 s). `setAgentProfile(null)` is the negative answer, "asked, and this
  project has none": it catches nothing up, requests no pass, and posts nothing itself — it
  only licenses the next pass to say so, which keeps the notice's moment at the first edit
  that would have analysed rather than at load. **Only the catalog 404 may send it.** A
  failed fetch does not know (a 500 over a project with a fine `agent.json` is the ordinary
  case) and a malformed catalog knows the opposite; both already reported what happened with
  the status or the JSON path in the line, and the idle sentence would be a second, less true
  account of it. Everything else that reads `agentProfile` — the pump, the `verifyFlag`
  guard, `analyzerPendingCount` — treats the two null-ish states the same on purpose: neither
  has a capsule, so neither owes any analysis.
- **Flag presentation state — `field-host/field-flags.ts`**, pure and GPU-free (the
  `field-ghost.ts` / `field-placements.ts` sibling). `createFlagStore()` holds stage-1
  findings by OWNER chunk, pits beside them (a pit region can span chunks, so its anchor's
  chunk is not a complete owner), and verdicts keyed by `${kind}@${cell}` — the same key the
  presentation dedupe uses, which is not a coincidence: a verdict is about a finding the user
  can see. A `flags` response REPLACES every chunk it names, empty lists included, which is
  how a fixed problem stops being reported AND how a stale `unreachable` tag clears
  (`markUnreachable` leaves prior demotions standing on its skip paths, so a store that
  MERGED tags would hide those findings for the session). `pits` replaces the pit set
  wholesale when present and is ABSENT on an incremental response — emitting `[]` there would
  clear every trap on the next keystroke.
- **Cross-border duplicates are real and paid for here.** `low-clearance` anchors on the
  offending NEIGHBOUR cell, so a border cell is emitted by both owners' passes (tranche A
  measured 48 duplicated cells of 208 on a border-aligned fixture). Suppressing that in core
  would LOSE flags at the border, so `dedupeByKey` keeps the LEAST-demoted copy — the two can
  carry different `unreachable` tags, having been analysed by different passes, and a stale
  demotion on one owner must never hide a finding the other has nothing against. Ordered by
  key string: determinism, not spatial order, so a list does not reshuffle between responses
  that found the same things.
- **Filters are one-sided by design.** `DEFAULT_FLAG_FILTERS` is candidates only. The
  reachability test hides `unreachable === true` and nothing else: `undefined` is the normal
  mixed-vintage state of a per-chunk analyzer beside a whole-world pass (and the PERMANENT
  state of every `pit`, which that pass skips), so testing `=== false` for "reachable" would
  silently hide every never-flooded finding — a false negative wearing a filter's clothes.
  Filters survive world loads, like the layer flags; `clear()` drops findings, pits and
  verdicts but not filters.
- **Viewport markers** — ONE instanced unit cube per visible finding, `FLAG_MARKER_SIZE_M =
  0.18` (under the 0.25 m cell, so it reads as a pin ON a floor cell rather than a block
  filling it), lifted `cellSize / 2` so it occupies the AIR cell its flag anchors on.
  UNLIT instanced (`shader.unlitInstanced`, white base), deliberately: a marker that dims when
  the camera-following key light looks away is a marker that stops doing its job in the
  shading mode meant for mood. Whole-layer teardown-and-rebuild, the `rebuildProps` rule
  (`field-host/field-props.ts`). Colour is the stage-2
  verdict if there is one, else the triage band — `CANDIDATE_TINT` red, `INFO_TINT` the
  selection amber (shared with `SELECTION_COLOR` rather than restated: both mean CONTEXT),
  `VERIFIED_TRAPPED_TINT` the candidate red darkened, `VERIFIED_CLEAR_TINT` a muted green. An
  `inconclusive` verdict falls THROUGH to the band: a verify that ran out of budget proved
  nothing, and a third colour would read as an answer. `FieldHost.flagMarkerCount()` is the
  `propInstanceCounts()` twin — the layer is otherwise write-only GPU state, so the count the
  rebuild settled on is the one readable fact and what tests hold it to.
- **⚠️ Nothing in the automated suite proves the markers REACH THE SCREEN.** Deleting the
  `layers.flags && flagMarkers` push from `renderScene` fails no test in this repo, and neither
  does whitening the tint at its UPLOAD site (`mesh.setInstanceTint` inside
  `rebuildFlagMarkers`). Keep that second one qualified — `flagTint` itself IS pinned
  (`tests/field-host/field-flags.test.ts` asserts all four constants and the `inconclusive`
  fall-through), so the gap is the hop from that pure function to the GPU, not the colour
  policy, and the unqualified version under-claims real coverage.
  `tests/field-host-analyzer.gpu.test.ts` builds the layer against a real device and pins its
  instance count, and its tick tests do call `renderScene` — but the host requests its context
  WITHOUT `surfaceFormat: "linear"`, so under bun-webgpu that render is invalid (asynchronously,
  as uncaptured device errors, which is why the tick still returns), and there is no draw-list
  seam and no pixel read. The weight of "the markers are visible" therefore rests entirely on
  `packages/editor/scripts/analyzer-pixel-check.md`, which owns the four claims, the procedure,
  the expected colours, and the warning that its pixel counts are one camera's reading rather
  than constants. **Run it whenever anything under the marker layer changes.** Precedent:
  `docs/learnings/2026-07-21-invisible-line-overlays.md` — ONE bug class (a `drawLines` MSAA
  sample-count mismatch) that shipped dead pixels through TWO sealed slices and passed every
  headless test.
- **Stage 2 — the verify verb, and the one place the editor loads the PROJECT'S engine into a
  worker.** `verifyFlag(key)` posts the flag to the analyzer worker, which imports
  `/engine.js` (`ANALYZER_ENGINE_URL`) and resolves `getService("analyzerVerify")` off the
  bundle (T1b: the validated registry lookup replaced the `extensions` namespace read) — the
  dungeon's own `walk-probe.ts`, driving the real `CharacterMover` down directed lanes in a locally
  built physics scene. There is no engine-generic form of this and there should not be: "test
  the code, not the data" only means anything if the code under test is the project's own.
  The verdict crosses as `VerifyVerdictWire`, a deliberate STRUCTURAL twin of the dungeon's
  `VerifyVerdict` and NOT an import of it — the editor is project-first, has no dependency on
  any project, and the bundle crosses that boundary untyped. Keep the fields identical; do not
  "unify" them by importing, because the import is what the architecture forbids and the twin
  is what makes the boundary honest.
- **Verify is ONE at a time, budgeted, and refuses four ways.** `VERIFY_BUDGET_MS = 8000`;
  past it the verdict is `inconclusive` with reason `budget`, which the panel paints as no
  answer rather than a third one. The four refusals, in the order a user meets them, all
  through `subscribeToolError`: a verify already running; no agent profile (checked BEFORE the
  key lookup, so the message names the root cause instead of sending the user hunting a flag
  that was never analysed); a key that no longer resolves ("that flag was re-analyzed away");
  and a `pit`, refused in the HOST as well as disabled in the panel — stage 2 drives lanes at
  one anchor cell and a pit is a whole region, so one anchor's lanes would prove nothing about
  it. A `worldEpoch` counter drops a verdict landing after a world reset; every OTHER
  staleness route is the flag store's own rule (a chunk's re-analysis drops its verdicts). The
  in-flight latch releases on every SETTLEMENT, or one dead bundle would cost the verb for the
  session. It does NOT cover a `bundler.build()` that never settles — that import runs before
  `budgetMs` is consulted and nothing bounds it, and a host-side timeout was deliberately not
  added: the worker dispatches on a serialized tail, so a hung import has already wedged sync
  and analyze too, and a timeout would trade a visibly stuck verb for an invisibly stuck one.
- **P-F4-2 is GO on BOTH transports, and they ARE two.** `tests/analyzer-verify.test.ts` rides
  the real path headlessly — the real daemon serving the real dungeon project, the real
  `analyzer-worker.ts` spawned as an actual Bun Worker, a headless `PhysicsContext` with no GPU
  behind it, Rapier's wasm initialising in that realm, and the shipped `CharacterMover` driven
  at a flag. It carries ONE honest deviation, recorded in its own header: Bun cannot
  dynamically import over http (`import("http://…")` fails with `ENOENT`, measured 2026-07-26),
  so the test fetches `/engine.js` from the running daemon and writes those exact bytes to a
  temp FILE. The artifact is the daemon's; only the transport differs — which is why the
  browser's native `import("/engine.js")` over http had to be checked separately, and was, at
  the Task 13 gate: verdicts landed as chips with a SPREAD of outcomes and no error
  raised beside them. That is the pixel-check recipe's own claim 4 — "a verify that raises
  an error instead of a chip is a P-F4-2 NO-GO" (it read "status-line error" when the panel
  still had a status line; F4.5a routes it to a toast + the log, §16.3). All-`inconclusive` would not have been a failure
  on its own (it is a real outcome); a `clear` and a `trapped` in the set are what prove the
  mover actually walked lanes.
- **The Flags panel section** (`components/field/FlagsSection.tsx`) — presentational, like
  `DriftReport`: every host verb arrives as a prop. It renders on what was FOUND, not on what
  is shown, because gating on the visible rows would unmount the only control that could bring
  them back. Findings group into rows by band (`kind/severity/unreachable`) and then
  agglomerate greedily within `CLUSTER_RADIUS_M = 2` — single-linkage, so a run of pinches
  along a corridor chains into one row; greedy rather than connected components, which leaves
  boundaries arrival-order dependent and therefore STABLE, since the store hands findings over
  in key order and the sort is stable. Clicking a row frames its chunks (`frameChunks`, a
  pit's whole region via `flag.chunks`, a per-cell finding's owner chunk). Verify runs on the
  row's ANCHOR — for a cluster that is a sample, not a survey, which is why the verdict chip
  reads `first: trapped` on a clustered row and why the scope rides the TEXT rather than a
  tooltip (a `title` reaches a mouse and nothing else, and `narrow ×3 · trapped` read as three
  proven traps is the exact misreading). The triage band reaches assistive tech as a word in
  the frame button's accessible name and colour-blind eyes as a filled-vs-hollow dot glyph —
  colour alone would be the only signal of the axis the list is triaged BY (WCAG 1.4.1). The
  Verify button's `disabled` is DERIVED from its refusal string, never restated, so a third
  reason cannot leave the button live while its own name announces why it is not.
- **The filters gate BOTH surfaces**, because the host applies them once in its store and both
  the marker rebuild and the list read what survives — so a checkbox in the panel also changes
  what the viewport draws. `publishFlags()` is the ONE path from "the findings changed" to
  "everything that shows them agrees": it rebuilds the markers FIRST and notifies the
  subscriber second, because a subscriber may read the host back synchronously (the panel
  does) and none may observe a summary whose markers are stale.
- **Chrome state and its honest cost.** The summary is the host's; the filter set and the
  in-flight verify key are CHROME state, and since F4.5b Task 2 they live in the shell's
  provider rather than in a palette — in `FieldFlagsContext` until foundations T3b1
  (2026-08-06), and since then in two provider-held CELLS (`chrome.filters`,
  `chrome.verifying`) that each surface latches for itself (§21.3). `verifying` cannot live in the host
  because releasing it needs two signals no single host seam carries — a verdict arrives on
  `subscribeFlags`, and each `verifyFlag` refusal arrives on `subscribeToolError` having pushed
  no flags at all; putting both halves in one file is why the state moved there. Both releases
  are deliberately BLUNT (an unrelated tool error also clears it; so does any flags push, not
  just the one carrying the verdict), because that way round costs a button that looks live for
  a moment against a column that sticks for good. The filters follow the layers/slice precedent
  — one effect keyed on the value, so engine-ready and every later edit are ONE mechanism — and
  the provider mounting with the shell is what makes them survive a palette being closed and
  re-opened. That remount used to RESET them, because the host keeps the last set across world
  loads and a re-mounted section reading "candidates only" beside markers still drawing the
  info band would be a straight lie. Remembering them across SESSIONS is D-3's, still open.
- **The `flags` layer** is the SEVENTH display gate (§12). Hiding it does NOT stop the
  analyzer — findings keep arriving and `subscribeFlags` keeps firing, exactly as a hidden
  `selection` layer keeps masking ops.
- **The analyzer worker's realm holds TWO core instances, and the two workers are exempt from
  the leakage rule for DIFFERENT reasons.** The field worker is the easy case — its realm never
  loads `/engine.js`, so it holds exactly one core. The analyzer worker holds the copy bundled
  via `analyzer-protocol.ts` AND the one esbuild inlines into the project's `/engine.js`. The
  duplicate is REAL, so do not cite this exemption as evidence that a worker realm cannot have
  one. It is inert on two conditions that both have to keep holding: everything crossing the
  seam is plain structural DATA (no class identity, no `instanceof`, no symbols, so which core
  minted a value cannot matter), and the two share no module-level state (our copy runs the pure
  column pass and the placement rasterizer; the bundle's owns the physics context and the
  collider derivation). That second one is a claim about EXECUTION, not bundle content — even
  when Rapier ships inside a worker bundle, nothing in this realm calls it.
  `tests/frontend-no-engine-leakage.test.ts` widened its rule to `(field|analyzer)-protocol` and
  carries the full argument and the measurements in its exemption comment. The value import
  that historically dragged core's whole graph in (`field/artifact.ts` → `@furnace/core/scene`)
  was severed 2026-08-04 (foundations T1a): the codec is its own engine-tier leaf,
  `@furnace/core/mesh-blob`, and a field-only entry bundles no Rapier.
- **`catalog/agent.json` — the third project→editor catalog contract**, DATA only, exactly
  parallel to the F2a materials and F3b entities ones. The run-once catalog effect
  (`FieldToolbar`'s then, `hooks/useCatalogs.tsx`'s since F4.5a) fetches all three in ONE
  pass so they cannot race;
  `shared/catalog.ts`'s `parseAgentCatalog` validates it setup-loud with the same `CatalogError`
  and path naming, and the host takes it through `setAgentProfile`. It is STRUCTURAL validation
  only — every field present and finite — because the numeric CONTRACT (positivity,
  `climbCeiling > stepHeight`, `clearance` at least the capsule's height, `skin` under the
  radius) belongs to core's `assertAgentProfileValid` — reached through `assertAnalyzeInputs`,
  the setup-loud gate every analyzer entry point runs FIRST — and reports through the worker's
  typed error channel; restating it here would be a second source of truth that can disagree
  with the gate that decides. Both good outcomes are SILENT: a
  parsed profile shows itself in the markers, and a 404 is a project with no agent — which the
  host already reports at the first edit that would have analysed, a better moment than load.
  Only a MALFORMED catalog has something to say here, and it must be said, or nothing would
  tell the user why the advisor never lit up. The agent catalog gates nothing; only MATERIALS
  gates Load.
- **The collider `anchor` (D-F4-14), editor half.** `EntityCollision` gained an optional
  `anchor: "center" | "base"` — structurally core's `PlacementCollision["anchor"]` — and the
  catalog parser carries it explicitly on all three kinds, because that parser is a WHITELIST
  and a dropped `anchor` would draw a base-anchored prop's proxy half-buried while the runtime
  stands its collider up. `proxyRecords` and `proxyCorners` now position on core's
  `collisionCenter(collision, record)` rather than the record's own `position`, so the
  committed prop layer, the placement ghost, the analyzer's rasterized solidity and the game's
  rigid bodies all agree on one pose. Called rather than composed, deliberately: the extent
  rule and the rotation into the record's frame both have to be right, and a hand-written copy
  is how the editor's proxy and the runtime's body drift apart. `proxyScale` also gained
  `Math.abs` on every axis — an extent is a DISTANCE, so a mirrored record covers the same box,
  whereas signed arithmetic would shrink a box's proxy through zero and make `Math.max` pick
  the LEAST negative axis for a round one.
- **`GeneratorDef.emits` replaces the schema sniff (D-F4-15) — for TWO of the four branches,
  and the split is the fact to carry.** `field-placements.ts`'s `placesProps(emits)` (rule,
  rationale and its synthetic-`"both"` unit test live at the source) supersedes
  `placesArchetypes`, which inferred "does this place props?" from an `archetypeId` param and
  would have mis-read any placer naming its archetype another way. It is read at exactly two
  sites: the editor-side empty-result refusal (§14) and `FieldGeneratorInfo.placesProps`, which
  the StampInspector's props count reads. **The other two prop-generator branches still sniff
  the schema key** — `withArchetypeOptions` (the `archetypeId` picker) and `seedArchetypeParams`
  both gate on `ARCHETYPE_PARAM in …` and never consulted the predicate, before or after. The
  deleted `placesArchetypes` TSDoc called itself "the one predicate behind" all four; it was
  not, and that claim should not be carried forward. **Consequence:** a generator that declares
  `emits: "placements"` (or `"both"`) but names its archetype param something else gets the
  refusal and the count, and silently gets NO picker and no seeding — the exact divergence class
  `placesProps`' own TSDoc warns about, one level up. Unifying the remaining two is unbuilt.
- **The segment brush gained its cap (D-F4-16), closing the asymmetry §14 recorded.**
  `MAX_SEGMENT_M = 2 · DIG_RANGE_M` = 60 m, checked in `segmentClick` before the anchor is
  cleared, so a refusal leaves the pending start armed and the fix is one nearer click; its
  TSDoc owns why twice the dig range is the geometry and not a round number. F3b shipped this
  gesture uncapped while the void cast shipped a budget in the same phase, and recorded the
  mismatch rather than resolving it — this is that debt paid. Pinned by a GPU test straddling
  the threshold (an over-length second click commits nothing and leaves the anchor ARMED), and
  restated in `ToolPalette`'s tooltip, which agrees by REVIEW rather than by import: the chrome
  cannot value-import anything under `field-host/`, the same rule that keeps `flagKey`
  private and puts `rowByKey` in the store.
- **Deliberately untouched: the void cast's worker scheduling.** F3b's X-ray still monopolises
  the one FIELD worker with no cancel and refuses where coalescing belongs (§14); F4 gave the
  advisor a worker of its OWN rather than touching that, so its passes never queue behind a
  cast and the cast's scheduling is exactly as F3b left it.
  The gap stands as filed —
  `docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *The void cast monopolises the one field worker*.
- **Panel-orchestrator slope.** *(F4.5a reversed it: 817 → 463 lines and 8 → 4
  subscriptions, by moving the stats/tool-error/entity/drift seams to a shell provider and
  the world, view and catalog concerns out entirely; F4.5b Task 2 finished it at 261 lines
  and 0 subscriptions — §16.7.)* Tranche B took
  `FieldPanel.tsx` from 15 `useState` slots and 7 subscriptions to 18 and 8 (711 → 817 lines): three new slots — the flags summary, the filter
  set, the in-flight verify key — plus `analyzerPending` on the existing stats mirror and its
  footer segment. The file was the dig loop's single orchestrator, and the backlog entry
  tracking that slope retired with it: F4.5a moved the entity list out, F4.5b took every
  remaining organ (§17), and Task 14 deleted the component and the `controls` palette id
  together. What the orchestration became is `hooks/useFieldHostState.tsx` plus the pure
  `lib/field-host-mirrors.ts` it was split against — see §17.

## 16. F4.5a — the overlay shell (2026-07-30)

**This section is the authority on the editor's SURFACES**, §17 on its VERBS, §18 on the
vocabulary both are spoken in. Read the three in order — each supersedes a figure or two in
the one before it, and says so at the point where it does.

F4.5a rebuilt the chrome as an *overlay cockpit*: one full-window canvas with everything
else floating over it. The dock, the field toolbar, the World panel and the entire
scene-document surface were deleted. The editor became **field-only**, with the daemon's
`scene.*` family left standing behind it — a parked capability nothing called. Foundations
T2 finished the cut and deleted that half too (§4), so field-only is now true on both
sides of the wire.

`grep -rn "MIGRATION (until" packages/editor/src` is the live list of anything still marked
provisional. **At the F4.5 seal it is empty**: F4.5b worked the `MIGRATION (until F4.5b)`
markers this slice left, each at the task that made its provisional shape unnecessary.

### 16.1 The layout contract (D-1) and the canvas layer

`components/shell/Shell.tsx` states the one rule the cockpit rests on: **the canvas
cell's insets are decided by the two fixed-height bars (`TopBar`, `StatusBar`) and
nothing else.** No palette opening, no selection changing, no surface resizing may move
them. Every floating surface — the palette layer, the axis triad, the toast stack —
therefore mounts as an **absolute layer inside that cell**, over the canvas, never as a
flex sibling of it. A viewport that re-lays-out under the user is what the dock era got
wrong.

Shell is split out of `App.tsx` deliberately: App owns the engine bootstrap (the dynamic
`/engine.js` import plus a WebGPU probe), neither of which can reach "ready" outside a
browser, so a layout living inside App would be a layout no test can drive. Shell reads
what it needs from `EditorContext`, which a test supplies.

The provider stack, in dependency order — `WorkspaceProvider` → `PaletteStackProvider` →
`FieldHostStateProvider` → `ViewProvider` → `WorldProvider` → `CatalogProvider` → the
chrome. The order is not cosmetic: the world state derives its dirty bit from the stats
the host-state provider owns, and `useGlobalKeybindings` binds ⌘S to a world verb, so the
listener has to sit *below* the provider it reads.

**`shell/CanvasHost.tsx`** mounts the one canvas and inits the host on it:

- **Init is EAGER.** The dock-era `lib/init-when-sized.ts` deferral is retired: this
  canvas is an absolute fill of a cell whose height comes from two fixed-height bars, so
  it is sized by construction at the first effect. A **zero measure is therefore not
  "not laid out yet" — it is the layout contract broken**, and it logs then throws rather
  than waiting for a resize that will never come. (The log precedes the throw on purpose:
  there is no error boundary above it, so the throw blanks the page.)
- **`init` takes the canvas and nothing else** (foundations T4c). It took a `sampleCount`
  until MSAA left the editor; the context is now `sampleCount: 1`, full stop, which is
  what makes an offscreen capture of this viewport possible at all (core's
  `frame.renderToTexture` refuses every other count). The View popover's AA switch went
  with it, and so did the one thing in the chrome that performed a re-init on demand.
- **The re-init chain, now insurance.** The host holds one context and throws on a second
  `init`, and its dispose is *deferred* (dispose only once `init` has SETTLED, because init
  awaits the GPU context and disposing mid-await pulls it out from under trailing
  creations). Any cleanup and effect landing in the **same** React commit therefore needs
  the next init to wait for the previous teardown, which a `teardown` ref carries forward.
  The AA switch was that caller; with it gone the shape is un-reached today — `App` builds
  one host and `main.tsx` renders without `StrictMode` — and the chaining is kept, and
  labelled as insurance in its own comment, because either of those is a one-line change.
  `dispose()` + `init()` on one host stays in `FieldHost`'s contract and
  `tests/field-host-reinit.gpu.test.ts` still walks it on a real device.
- The canvas is `tabIndex={0}` with a visible focus ring: the host attaches its WASD/QE
  fly, `[`/`]` radius and arrow-nudge keydowns to the CANVAS, so the ring is the only
  signal those keys will land anywhere.

### 16.2 The palette layer, the workspace store, and persistence v2

**`lib/palette-store.ts` is pure data** — no DOM, no persistence, no React. The cell's
size is the one fact it cannot know, so it arrives as an argument (`OriginBounds`); the
layer component measures it. That is what makes clamp/snap/what-survives-a-hide testable
without a browser.

- `PALETTE_IDS` is a **closed union**, and as of F4.5b it is five: `entities`, `session`,
  `flags`, `history`, `log`. A persisted record for an id not in it is dropped rather than
  restored, so a retired palette cannot come back as dead geometry — which is exactly what
  happened to F4.5a's `controls` dock when the control stack dissolved into the tool rail,
  the top strip and the session card.
- **The default arrangement is THREE COLUMNS, and it is arithmetic rather than taste.** At
  the design floor (`DESIGN_FLOOR_CELL`, 1235 px of cell) three palette widths fit side by
  side: `entities` at x=24 (360 wide), `session` at x=420 (280) and `history` at x=720
  (240, ending at 960). Exactly ONE column stacks — entities over flags, on the left — and
  that stack is what `entities.maxHeight` (320 px) pays for. `PALETTES` carries a `width`
  and an optional `maxHeight` per palette so the arrangement is PROVABLE rather than
  eyeballed, and `tests/palette-store.test.ts` checks all ten pairs. A default that
  deliberately shares a corner declares it (`sharesCornerWith`), beside the default it
  excuses, so a palette added later inherits nothing.
- **Both figures are DEFAULTS, not limits** (the F4.5 gate ruling). `PaletteState` carries
  an optional `width`/`height` the user sets by dragging a palette's resize handle;
  `paletteBox(id, geom)` is the ONE place the declared and the dragged are reconciled, and
  the layer's inline style and `cellBounds`' projection both read it, which is what keeps
  the rendered width and the projected width the same number. Absent means never resized,
  so Reset Workspace clears a size by simply not writing one and an old blob migrates by
  carrying no field. A user-set height REPLACES the extent rather than being capped by it —
  that is what "the extent is the default size, not a ceiling" means — while the cell's own
  `calc(100% - y)` cap survives it. The pairwise proof keeps reading the DECLARED figures
  only: a user's arrangement is theirs to overlap (D-3).
- **Nothing docks by default and no default claims the RIGHT edge** — `controls` was the
  one that did. Past history's 960 the cell is clear, which leaves the top-right corner to
  the axis triad and the strip a right-handed user orbits in unclaimed. `log` and `history`
  start **closed** because they are summoned (the status bar's ⚠ and `undo N` chips, the
  View and Edit menus); `session` starts closed for a different reason — its open state is
  DRIVEN by whether there is a session or a selected entity to be about (D-13), which is
  what `drivenOpen` records: not persisted, not restored, and still reachable by the
  burger's checkbox so the card's × is not a latch with no exit. `Toasts` takes the
  bottom-right (its own D-1 absolute layer), so the **bottom-left** is the one strip
  nothing defaults into, and that is where the collapsed-chip rail lives: it used to sit
  top-right, under the old dock, so collapsing any palette dropped its chip on top of
  another one (`PaletteLayer`'s own account of the move).
- `SNAP_PX = 24` — roughly a coarse pointer's slop.
- The ⌘\ hide-all is a **latch**: `hidden` does not touch the per-palette records, so
  restoring returns the exact prior arrangement.

**`hooks/useWorkspace.tsx`** adds the two things the store refuses to know: React state
and the disk (a `PERSIST_DEBOUNCE_MS = 200` write, so a drag writes once at the end of
the gesture rather than 60×/s). It is split into **state and actions contexts**, and the
load-bearing beneficiary is `ShellChrome` — the component that actually builds the
`content={{ entities: <EntitiesPalette/>, session: <SessionCard/>, … }}` elements — which
reads ACTIONS ONLY. That is what keeps those elements referentially stable across a drag
and therefore keeps the palette bodies off the pointer-rate path. (`ShellFrame`, one level
up, reads only `useEditor`.)

**Front-to-back order is session-local** (`hooks/usePaletteStack.tsx`) and deliberately
NOT persisted: geometry, collapse and open are decisions the user made; which palette
they touched last is an accident of the final minute. It sits above the whole chrome
rather than inside the layer, because the two surfaces that *open* a palette — the status
bar's ⚠ chip and the burger's View group — are the layer's siblings, not its children.
**Every summon raises unconditionally**, not merely on the open transition: the log is
very often already open and merely buried.

**Persistence is v2** (`lib/persist.ts`). The serialized dock `layout` key died with the
dock library, so `VERSION` bumped and a **v1 blob is orphaned, never migrated** — nothing
in the v1 shape has a v2 meaning. The live keys are `workspace`, `view`, `flagFilters`
and `lastWorld`, each with exactly one writer, and `set` rebuilds the blob from `load()`
so the keys stay independent. A corrupt blob reads as empty; a quota failure is
swallowed. Persistence is best-effort and must never break the editor.

### 16.3 What the editor SAYS — the notify store

`lib/notify-store.ts` (D-19) is a **capped toast stack over a durable message log**,
framework-free: `subscribe`/`getSnapshot` and nothing more, so every rule lives in one
place a bare test can drive without a DOM, a clock or a React tree. The clock and the
timer are **injected** — a store that called `Date.now`/`setTimeout` itself could only be
tested by waiting.

- `TOAST_CAP = 3`, `LOG_CAP = 200`, `TOAST_TTL_MS = 4000`.
- `NotifySeverity` is `info | success | warn | error`. **Errors never auto-fade** — they
  hold their slot until dismissed. Everything else, `warn` included, is a report on
  something that already finished, and reports should leave.
- **The cap does NOT evict.** A message arriving against a full stack becomes log-only
  (`toasted: false`) rather than pushing the oldest toast off, because the thing a flood
  of infos would push off is exactly the undismissed error D-19 exists to protect.
- `overflow` (how many logged messages never got a slot) is **derived from the surviving
  entries**, not accumulated — a running counter would eventually read "200 messages · 997
  not shown", two numbers about the same list that cannot both be true.
- `unreadErrors` drives the status bar's ⚠ chip, and counts **`error` only** — a warning
  that lit it would demand attention exactly the way that severity exists not to. The log
  palette calls `markSeen` **only while it is topmost** (its `VisibilityProbe`), so a log
  buried under another palette keeps the chip lit rather than silently swallowing the
  errors behind it. `markSeen` is a no-op when nothing is new, or a palette that marks on
  render would loop.

The toast stack (`shell/Toasts.tsx`) and the log palette (`shell/LogPalette.tsx`) render
the SAME records by id. Live regions are **persistent** — mounted whether or not there is
anything to announce, because a region that appears with its text is a region screen
readers may not announce. This replaced the field panel's status line entirely: **the
panel has no status line, and nothing else does either.**

### 16.4 The world — `world.*`, `useWorld`, and the drawer

F4.5a gave the daemon its **`world.*` namespace** beside the existing `field.load` and
`generation.bake` — the five verbs and their refusals are tabled once, at §4. `world.list`'s
`tracked` tri-state is the one worth restating here because the chrome renders it: `true` /
`false` come from `git check-ignore`, and **`null` means git could not tell** (no repo, or an
ambiguous answer). A `null` earns no badge rather than a wrong one.

**`hooks/useWorld.tsx` holds the world state, and it is SHELL state, not panel state** —
the world chip reads it, ⌘S drives it, the drawer lists against it. That placement is the
point: a control stack that owns the save verb cannot be dissolved into palettes, and
closing the palette holding it would take ⌘S with it. It sits *under*
`FieldHostStateProvider` because the dirty bit derives from the stats that provider
already owns. (The original reason was that `subscribeStats` was a single slot and a second
subscription here would have silently stolen the status bar's. Foundations T3a made every
seam multicast, so that hazard is gone, and foundations T3b1 then retired the rule it had
fallen back on — §16.7's ONE-subscription-point rule — by making a second mirror the normal
arrangement. `useWorld` now holds its OWN latch on `subscribeStats`, beside the status bar's;
the placement stands on the remaining reason, which is that the dirty bit is derived from
that seam and the hook must sit under the provider that supplies the shell. See §21.3.)

- `name` is `null` for an untitled scratch and **never prefilled** — the W3/W4
  gate-clobber lesson: a stale default silently overwrites the game's world at the first
  Save. An untitled ⌘S opens the drawer in `save-as` mode to be named first (D-21).
- `dirty` derives from the host's op COUNT changing. Honest in the direction that matters
  (an edit always sets it) and deliberately imprecise in the other (undoing back to the
  saved state leaves it set). A `savedOps` ref carries the save-point count so the
  **discard confirm can say how much** — a number the user can weigh is the difference
  between a prompt they read and one they click through.
- A world swap re-establishes the baseline through a `seenOps: null` sentinel, so adopting
  the new world's op count does not read as an edit.
- `job` (`"save" | "bake" | "open" | null`) gates the verbs AND names them. One field
  rather than a flag beside a label: the registry only ever asks "is one running"
  (`ActionCtx` projects `busy: job !== null`), while the status bar labels it through
  `StatusBar.tsx`'s `JOB_LABELS`. The tags name the VERB, not the readout — a tag spelled
  "saving" would be a UI string living in state.
- **The long-job readout (D-19)** is the bar's one non-interactive chip, driven by two
  facts and no store of its own: `world.job` for a write or read, and
  `FieldStats.voidCastPending` for the X-ray's whole-world worker job. The cast rides the
  existing per-frame stats push rather than a thirteenth seam — every reader of
  that fact already reads stats, and `analyzerPending` beside it had already established
  job-in-flight-ness as a member of that type. What it buys is legibility for a refusal
  that already shipped: "a void cast is still building" names a state nothing on screen
  used to show. In-flight is said at the controls (they disable) and on the bar — never in
  a toast, because a toast slot spent on "saving…" is a slot the OUTCOME then cannot have.
  There is **no cancel** on the chip and D-F4.5-19's own second clause is why ("the job
  polls; no cancel theater"): `bakeFieldWorld` is synchronous core with no yield in its
  per-chunk loop, the uploads carry no `AbortSignal` against a daemon that clears the world
  directory before rewriting it, and the cast's per-chunk loop is inside a worker handler
  that runs to completion per message, so a cancel `postMessage` would queue behind the
  work it means to stop. The reasons and their re-check triggers live at `useWorld.tsx`'s
  `write` / `open` and `field-voidcast.ts`'s `requestVoidCast`; nothing else restates them.
- **The tracked guard is a round trip, not a precheck**: a save issues with
  `confirmedTracked: false`, and a `needs-tracked-confirm` outcome comes back and raises
  the confirm naming the path. The upload is an await, so a separate check-then-write
  would race.

**`shell/WorldDrawer.tsx`** (D-20/D-21) is every world in one modal list, summoned from
the world chip and gone the moment it is dismissed — transient by construction, so it can
afford to say more per row than a permanent sidebar could. A **modal** `Dialog` rather
than a popover because every dangerous verb in the editor lives there (make-default,
delete, save-over-tracked) and a stray outside-click must not leave a half-typed rename
hanging over the canvas. It **owns no world state**: verbs come from `useWorldActions`,
confirms are the App-owned prompt, and rows come from `world.list` **refetched on every
`worlds-changed` tick — never patched from a mutation's response**, so a change made
behind the editor's back (a git checkout, another editor) shows up the same way the
editor's own do. A `null` `tracked` earns no badge rather than a wrong one.

### 16.5 Seeing — studio shading, the View popover, the pose seam

**`FieldHostShading = "studio" | "normals"`**, and **`studio` is the default** (D-F4.5-17,
"the state of seeing"): per-class lit materials under a **camera-following key light plus
a hemisphere fill**. `normals` (unlit normal-colour, material classes deliberately
indistinct) is now a *debug flag*, not a peer. The advisor's flag markers stay
`shader.unlitInstanced` for exactly this reason — a marker that dims when the key light
looks away stops doing its job in the mode meant for mood.

**`hooks/useView.tsx`** owns what the field LOOKS like — shading, layer visibility, the
slice plane — and nothing about what is in it. It is shell state for the world-state
reason: the View popover drives it and the burger's View group drives the same values.
Since foundations T4c **every member is a push to a host seam**, which is what makes it a
view state rather than a settings bag; the one member that was not, `sampleCount`, left
with MSAA, and with it the `FieldCanvas` wrapper that existed only to read it.

It is the **chrome→host direction**, which is why it is not part of `useFieldHostState`
(host→chrome). The host has no shading/layers/slice subscription to mirror, so this
provider is the source of truth and **pushes: one effect per seam, each keyed on its own
value**, so a shading change never re-sends the layer flags (`setLayers` is edge-sensitive
for `voidCast`) and a slider drag never re-sends the shading mode. Defaults:
`DEFAULT_LAYERS` all-true but `voidCast` (opt-in — ticking it runs a whole-world cast),
`SLICE_DEFAULT_Y = 8`. The layer set is restated here rather
than imported because the chrome cannot value-import the host (the project-first
invariant), and it is pushed at engine-ready so the two agree from the first frame.

**The camera-pose seam.** `FieldHost.subscribeCameraPose` pushes `{ yaw, pitch }` in
radians; `shell/AxisTriadMount.tsx` reads it through `useFieldHostState` and renders the
corner triad. Foundations T4b added a **poll beside it**, `FieldHost.cameraPose()`, on
`isLooking`'s split: the pose moves between renders (pointer rate through a look drag, per
frame through a fly), so a surface that DRAWS it takes the subscription and a caller that
answers a question asked at an arbitrary moment takes the poll. Its one caller is
`session.state` (§4), and it exists because both mirror-shaped routes cost renders nobody
asked for — a member on `ActionCtx` would re-render that context's six consumers at pointer
rate, a second `useCameraPose` latch would re-render the provider that builds it — and
because both would break the seam's ONE-subscriber rule, which `tests/chrome/shell.test.tsx`
pins and the poll keeps. Since **F4.5b Task 6 the triad is also a CONTROL**: its six axis ends are
real `<button>`s over the SVG (an `<svg>` cannot contain one, and `role="button"` on a
shape would mean hand-rolling focus and Enter/Space), each calling
`FieldHost.snapView(axis, sign)` where `sign: 1` puts the eye on the POSITIVE side of
that axis. The mount box stays `pointer-events-none` so the overlay never eats an orbit
drag; the six tips re-enable it for their own caps, and each **suppresses the default on
a left pointerdown** — a tip is a momentary command, and letting a click move focus off
the canvas would kill every viewport key and cancel a live `G` grab (`onBlur` →
`cancelMoveInFlight`). They also suppress their own `contextmenu`, which the canvas's
handler cannot reach because they are canvas SIBLINGS, not descendants. Buttons are
emitted in fixed axis order (that is the tab order) and resolve overlap with `zIndex`;
the SVG behind them paints far-to-near. The triad mounts **above the palette layer in DOM order** — F4.5a's default
arrangement docked `controls` to the right edge at top 0, covering exactly the corner the
triad sits in, so mounted before the layer it shipped invisible out of the box. That dock
retired with `FieldPanel` (§17) and no default claims the right edge now, but the DOM order
stays: the corner is unclaimed by DEFAULT, not unclaimable, and a user may drag any palette
onto it. `Toasts` sits there for the same reason with a softer case. Both are their own absolute
box inside the SAME cell: they take nothing from the canvas (D-1).

### 16.6 The menu, the shortcut overlay, and the ONE history

The menu is a **single burger dropdown** (`shell/BurgerMenu.tsx`) whose groups render in
the order **World / Edit / View / Help** — not a menubar.

**Since the F4.5 holistic gate (ruling 3) the three registry groups are SUBMENUS**, one each,
over a top level of ten rows: the three submenu triggers, the two doors ("View options…",
"Keyboard shortcuts") and the five palette checkboxes. It was one flat run of 33 items, of
which the gate counted seven or eight below the fold by eye — the arithmetic, which lives once
in `packages/editor/tests/chrome/shell.test.tsx`'s "the TREE" section, puts it nearer ten,
because the menu opens under a 40 px top bar and so has ~906 px rather than the window's ~950.
What stays at top level is what the menu is
SHOWING STATE for (the palette ticks — the tick is the information, and a submenu would hide
it) plus the doors; what moved behind a chevron is the registry's own verbs, whose other route
is ⌘K by name. `help` is the fourth group and is deliberately NOT a submenu: it carries one
action, and a one-row submenu is a chevron guarding one row.

**Since F4.5b Task 7 the bindings are DECLARED ONCE**, and since foundations T3b2 Task 4 in
two halves: the DATA half is a row in `src/action-registry/descriptors.ts` (id, group, the
binding as data, a `hint`, a `gate`, the two flags), and `frontend/lib/actions.ts` joins the
four things a row cannot hold onto it by id — `label`, `enabled`, `checked` and `run`. The
displayed chord is DERIVED from the binding (`capOf` → `keycap()`) rather than stated, and
`match` is gone: one pure `matchBinding` over four facts replaced 22 closures. §22.5 and §22.6
carry the whole of it. It was three
readers when this section was written — the window key dispatcher
(`hooks/useGlobalKeybindings.ts`), the burger's World/Edit/View groups and
`shell/ShortcutsDialog.tsx` — and more have arrived since; **§17.4 carries the current count
and lists the readers by file**, and is the only place in this document that does. Either
way a binding cannot be
live and undocumented, or documented and dead. `hooks/useActionContext.tsx` assembles the
`ActionCtx` those predicates read (host, armed tool/gesture, session, selections, world,
view, workspace) and owns the listener. The overlay's one remaining hand-maintained group
is the canvas-owned keys.

**Who owns a key.** There are two keydown listeners. The canvas
(`field-host/field-host.ts`) keeps the keys that steer the viewport under the pointer —
the fly set, `[`/`]`, the arrow nudges, momentary ⇧/⌃ — plus first refusal on ⌘Z, ⏎, Esc,
R and F. Everything else is the registry's, on `window`, which is the only listener that
carries the gates and the only one that still works after a palette click takes the
canvas's focus. Where both bind one key the canvas branch that ACTS calls
`stopPropagation`, and that call is the whole licence for the second owner.

**`?` opens the shortcut overlay** (ruling 3), through the same `typed` gate as every other
bare key — so it is refused while the user is typing and nowhere else. It is the registry action
`help.shortcuts`, whose `run` calls `ctx.run.openShortcuts()`; the Shell owns the dialog's open
flag beside the ⌘K palette's, which is what makes the key possible at all (it lived in
`BurgerMenu`'s own state, unreachable from a window listener). Its matcher is the one in the
table that states a CHARACTER rather than a modifier + key — `?` is ⇧/ on a US layout and ⇧ß on
a German one — with AltGr layouts the known residue, filed under
`docs/backlog/editor-and-tooling/` as `chrome-focus-and-dismissal-follow-ons.md` § *`?` cannot reach the shortcut overlay on a layout that needs AltGr for it*`.

**The gate** has two classes plus two per-action flags. `chord` (⌘-chords) is live even
inside a text input, because the browser default it replaces is worse; `typed` (every bare
letter, plus ⌫, Esc and ⏎) is refused when the focus is in one. "Text input" means TYPED
TEXT ENTRY, not "focusable form control" — `lib/keybindings.ts` matches textarea, select
and the textual `<input>` types, and deliberately NOT `range`/`checkbox`/etc. Both
directions of that line cost something real: a matched slider makes `V`/`B`/`F` dead on the
control users drag while looking at the field, and an unmatched `<select>` lets the Esc
that dismisses its popup run the cancel ladder and discard a live session.

The two flags: `flyLetter` stands an action down while `FieldHost.isLooking()` — declared
per action rather than per class, because the collision is with `readFlyMove`'s
w/a/s/d/q/e and `S` is the only member (a blanket rule killed `R` and `F` mid-orbit for no
collision at all). `armsTool` refuses while a session is live, *with a toast*, because a
key that looks dead teaches the user it is dead. A modal confirm suppresses everything.

**Undo/redo go straight to the host: the field's op log IS the editor's history.** There
is no second document to step, so ⌘Z/⇧⌘Z call `FieldHost.undo()`/`redo()` and nothing
else. The canvas binds the same chord itself and stops propagation, so a ⌘Z with the
viewport focused steps once, not twice.

**Esc cancels ONE THING per press** (`FieldHost.escape()`), not everything at once: a
half-drawn box/segment anchor, the pending stamp arm, the live session (a move included),
the selected entity, the cell selection. **Most recent intent first** — which was a fixed
five-rung order at the seal and is the acquisition order of a capture stack since
foundations T3a (§17.4, §20). The canvas's Esc and the registry's run the same
implementation, so they cannot disagree about it.

**⏎ is `FieldHost.confirmSession()`**, which drops a live grab (the zero-step rule, the
pending-preview latch) and otherwise ends the session by mode. Both keys route through it.
It is public rather than canvas-only because `beginMove` does NOT focus the canvas: a grab
started from the Edit menu, or by `G` with a palette control focused, has no canvas
listener to answer the "⏎ drop" the status bar advertises. It is the ONLY verb that ends
a session from outside: T3c deleted the narrower `commitSession()` ("end by mode",
deliberately not routing through `dropMove`) after finding zero production callers — the
panel's Commit/Apply button already called `confirmSession`, because it wears the ⏎ keycap
and must mean what the key means. Facade 66 → 65.

**WASD/QE fly ONLY while the right button is held** (D-10, the Unity mechanism). That gate
is what buys the bare-letter budget the registry spends: `S` is fly-backward *and* the
stamp family, and the button is what decides which.

### 16.7 What moved out of FieldPanel — and what remains

**Read this as the F4.5a snapshot it is — §17 is the current state.** At F4.5a
`FieldPanel.tsx` was down to **261 lines** and rode in the `controls` palette (§15's
orchestrator-slope entry tracked it at 817); F4.5b finished the job, deleting the file and
retiring the palette id with it. The table below is still the accurate account of where
each organ WENT, which is why it stays. What left, and where it went:

| Left the panel | Now lives in |
| --- | --- |
| every host subscription — stats, tool-error, camera-pose, entities, drift, (F4.5b Task 2) tool, selection, stamp, flags, and (Task 4) entity-selection | `hooks/useFieldHostState.tsx` (the provider) |
| world verbs (Save / Open / Bake) | `hooks/useWorld.tsx` + the world chip + the drawer |
| shading, layer gates, slice plane, AA | `hooks/useView.tsx` + `shell/ViewPopover.tsx` — except AA, which left the editor entirely at T4c rather than moving |
| the catalog fetch | `hooks/useCatalogs.tsx` (mounted once by the shell) |
| the committed-entity list + drift report | `shell/EntitiesPalette.tsx` — the first organ out, the layers panel since Task 4 |
| the status line | `lib/notify-store.ts` (toasts + the log) |
| the armed GESTURE (which of pointer / box / wand / room / segment holds LMB), F4.5b Task 7 | `hooks/useFieldHostState.tsx`'s `useFieldTool` — the registry's `V`/`B`/`M` family keys arm the same slot the palette's buttons do, and a panel-local copy would disagree with them on the first keypress. (A React context until foundations T3b1, a provider-held cell since — §21.3.) |

What **remains** is the dig loop's control stack: the tool palette, the material
swatches, the brush inspector, the stamp inspector and the advisor's flags — rendered
entirely through `useFieldHostState.tsx`'s hooks rather than by subscribing to the host
directly. (At F4.5a that meant "from the provider's contexts, with no host subscription of
its own"; since foundations T3b1 the hook a surface calls IS its subscription — see below.)

**`hooks/useFieldHostState.tsx` WAS the ONE subscription point for the seams the chrome
reads, and since foundations T3b1 (2026-08-06) it is the one MODULE rather than the one
subscription.** The reason the rule was written was a real failure mode: every
`FieldHost.subscribe*` seam was a **single slot**, so a second subscriber silently stole the
first's — the earlier consumer just stopped updating, with nothing thrown and nothing
logged. **Foundations T3a retired that hazard** (§20): the seams are multicast, and a second
subscriber costs nothing but a second delivery. For one slice the rule outlived its
enforcement and was kept on its own merits; **T3b1 Task 7 then retired the rule itself**,
because a per-consumer latch buys the same properties more cheaply than a fan-out does
(§21.3). What the module still owns is the part that was load-bearing: one hook per seam, so
there is still exactly one place a comparator decides whether a push re-renders anything,
and one place to look when a surface stops updating.

At the F4.5a seal, **eleven** seams lived there (stats, tool-error, camera-pose, entities,
drift, entity-selection, tool, selection, stamp, pending-stamp, flags), published through
**eight** contexts split by CADENCE — a frame-paced seam must not re-render a surface that
only cares about an answer. That split is gone: a per-consumer latch isolates cadence by
construction, and a surface that does not call the hook does not subscribe at all. Today
**thirteen** seams are read here, ten as per-consumer latches and three from the provider
shell, over **one** context (`FieldShellContext`, which changes twice a session). Of the
eight contexts' throw-vs-default calls, only the camera's survives as a default — "no camera
here" is still the one default that is true outside the provider — and it is now
`IDENTITY_POSE`, the latch's `empty` value, rather than `CameraPoseContext`. The stats push
is still guarded by a value-equality comparator with a `satisfies Record<string, never>`
backstop — a new `FieldStats` field fails the never-check and forces the comparator to learn
it, because a missed field would silently *weaken* the guard.

**What replaced "no surface below the provider may re-subscribe" is a claim about the
SPLIT**, and `tests/chrome/host-seams-and-catalogs.test.tsx` pins that instead: which three
seams are the shell's, that the other ten are claimed by a reader, and that every one is
RELEASED when its reader unmounts. A duplicate mirror is the normal arrangement now; a
mirror that outlives its surface is the bug, and it has no symptom except those counts.

### 16.8 The daemon feed

`hooks/useDaemonFeed.ts` reduces the SSE feed to the two things the chrome does with it:

- a **`worldsVersion` counter** bumped on `worlds-changed` / `generation-baked` — a
  version rather than a payload, because those events are notification-only dirty bits.
  Anything rendering the world list refetches on it.
- the **hard reload** a stale engine bundle needs (`bundle-outdated`), **refused while a
  world write is in flight** — the subscription re-binds only when the engine becomes
  ready, so it reads `bakeBusyRef` (a ref, not state) to see the current value without
  re-subscribing. A reload mid-upload would kill the write.

Those two reductions covered the feed **exhaustively** from foundations T2 until T4b: the
daemon's whole `DaemonEvent` union was the three events these two branches consume (§5), so
there was no feed member the chrome quietly ignored. It was a subset when this hook was
written — the five `SessionEvent` members rode the same feed and the chrome dropped every
one of them. **T4b added a third reduction, and the exhaustiveness holds**: the two addressed
frames (`session-token`, `claim-lost`) route into a `SessionFeed` of named handlers, so this
hook is still the ONE place in the chrome that reads an event `type` while the claim's policy
lives in `useSessionClaim` (§5.1). Its `session` parameter carries the same STABILITY rule as
`bakeBusyRef`, and the cost of breaking it is worse — a re-subscribe mints a new connection
token and re-claims.

It is a hook rather than App-local state for Shell's reason: a feed wired inside App is a
feed no test can drive, because App owns the WebGPU probe and the `/engine.js` import.
There is still **nothing to catch up on** at `onOpen` — the editor mirrors no daemon-owned
document; the field world lives in the host until the user saves it. What a (re)connect DOES
mean since T4b is that the previous connection's token is dead, and forgetting it is the one
honest job that seam has (§5.1).

## 17. F4.5b — the hands (2026-08-01)

**This section is the authority on the editor's VERBS**, as §16 is on its surfaces. F4.5a
gave the cockpit a canvas with things floating over it; F4.5b gave the user hands to work
in it — a pointer that picks *in the viewport*, a move / delete / duplicate vocabulary for
committed stamps, one action registry behind every key and every menu item, and the
dissolution of the last control stack into palettes and bars of its own. **`FieldPanel.tsx`
no longer exists** (§17.9). The editor is still field-only; §16's opening stands.

One BEHAVIOUR CHANGE runs under all of it and is the bargain the rest is bought with:
**WASD/QE no longer fly unless the right button is held** (§17.4).

### 17.1 The pointer, and the CPU ray pick

`ViewportGesture` gained a `"pointer"` member and **it is what a fresh host is armed with**
(D-F4.5-7; the chrome's mirror opens on the same value, `DEFAULT_GESTURE`, so the two
cannot disagree at boot). Under it LMB selects and drags rather
than strokes, and the wheel travels the camera instead of sizing the brush.

**`field-host/field-pick.ts` is the arbitration, and it is pure and GPU-free** — the
`field-ghost.ts` / `field-placements.ts` sibling. CPU rather than a GPU id pass, and that is
a decision with reasons rather than a fallback. It had **two** reasons and now has one, which
is worth stating rather than quietly restating the survivor: the field host used to acquire
its context at `sampleCount: 4`, and core's `frame.renderToTexture` throws on any context
whose `_internal.sampleCount !== 1`, so an id pass could not even be RENDERED here —
**foundations T4c removed MSAA from the editor and that blocker is gone.** What still stands
is the reason that was never about the context: the two things most worth picking — entity
footprints and gizmo handles — have no meshes at all (a `drawLines` batch and pure math
respectively), so an id pass would have to invent geometry for both before it could beat a
ray test that already resolves them. The consequence is written into the design rather than
tolerated: **a CPU pick is affordable per CLICK, not per pointermove, so there is no hover
pre-highlight anywhere in the editor.** Selection is click-driven. That deferral's filed
trigger ("a GPU pick path exists") is one step closer and still short of fired.

- **Three candidate kinds**, and `PICK_TIER` is a total `Record<PickCandidate["kind"],
  PickTier>` rather than a predicate, so adding a kind without classifying it does not
  compile. `prop` and `flag` resolve in the **object** tier; `entity` in the **volume**
  tier, and objects are resolved FIRST. That deviation from plain nearest-wins is
  structural: an entity's candidate is its stamped FOOTPRINT, the editor camera normally
  sits inside one (that is what carving a room and flying into it produces), such a
  footprint enters at `t = 0`, and it would otherwise win every click in the room and make
  every prop and marker inside it unpickable.
- **Within a tier, nearest wins and ties go to the SMALLER volume** (`nearestOf` /
  `candidateVolume`). That is what resolves nested footprints — a scatter's box inside a
  hall's, both enclosing the eye at `t = 0` — with a fact the user can see, where the log
  order it replaces was invisible. Scoped to ties on purpose: two disjoint boxes are still
  decided by distance.
- **Gizmo handles are not candidates at all.** A handle is a line segment with a
  screen-proportional tolerance, so it is hit-tested BEFORE the arbitration
  (`field-host.gizmoAxisAt` → `gizmo.pickAxis`) and beats both tiers — including the
  footprint box every handle is drawn on top of.
- **Terrain occlusion is a `maxT`, inclusive.** `pointerPick` casts one `field.raycastField`
  at `PICK_RANGE_M` (`= DIG_RANGE_M`, 30 m) and passes the hit distance — or the probe's own
  range when it missed, because nothing past that range was tested. The bound is inclusive
  because occlusion means strictly BEHIND, and a carve entity's footprint face lying on the
  rock face it carved is the normal case. The cast is slice-coherent (`sliceOpts()`) like
  every other cursor-driven raycast, and is skipped when the eye is in rock.
- **A prop click selects the entity that PLACED it.** A placement record is not an
  independently editable object here; `field-placements.placementOwners` pairs each record
  with the span that claims it. The OBB test uses the record's own frame
  (`field.collisionCenter` + `proxyScale`), not the 24-float `proxyCorners` the wireframe
  allocates.
- **A flag's pick volume is its anchor CELL**, `field-flags.flagCellBox` — the same box the
  camera frames and the selected outline draws, on the same half-cell lift
  (`flagMarkerCenter`) the instanced matrices use. Deliberately not the drawn
  `FLAG_MARKER_SIZE_M`: a 0.18 m pin is a hard click target.
- `pickCandidates()` honours the layer gates for props and flags — **what you cannot see you
  cannot select** — but NOT for entity footprints, because the `selection` layer hides the
  emphasis box and a hidden box is not a hidden entity.

`pointerPress` resolves three outcomes and **the order IS the arbitration**: a gizmo handle
starts a constrained drag on the press with no threshold (nothing competes for a handle
press); a press on the ALREADY-selected entity arms a pending drag and does nothing else;
anything else is the plain pick. That middle rung is what makes a first click on an entity
safe — an unselected entity is selected and nothing is armed, so the first click can never
shove it. `DRAG_THRESHOLD_PX = 4`, measured from the press rather than accumulated.

### 17.2 One selection, two surfaces — the `subscribeEntitySelection` seam

`FieldHost.selectEntity(entityId | null)` and `subscribeEntitySelection` replace the
`highlightEntity` display verb, which was **deleted rather than deprecated**. There is one
selection concept: the state a `pointer` click writes is the state a palette row writes, so
the two surfaces cannot disagree about what is selected.

- `setSelectedEntity` is the **single mutator**, whoever is asking — a pointer click, the
  public verb, an entity leaving the log, a world reset. There is deliberately no second
  "clear" entry point. It validates against the log (an id no entity op carries selects
  NOTHING rather than reporting — the ids come from a list that can lag it) and re-selecting
  what is already selected notifies nobody, which is what lets the seam's "pushed on every
  change" contract be read literally.
- The selected entity wears its stamped **footprint box in the theme's `--primary`** — the
  union of its span's op bounds, falling back to the recorded region only for a pure
  placer's span. That emphasis rides the `selection` layer gate; the selection itself is not
  display state and survives the layer being off.
- The seam is **independent of `subscribeSelection`**, which carries the CELL selection that
  masks ops. Neither verb disturbs the other, so both can stand at once.

**`shell/EntitiesPalette.tsx` is the layers panel now (D-14)** and its rows are the other
half of the sync. A row click calls `host.selectEntity` (the write half) and toggles its own
read-only params `<dl>`; the id coming back down the seam styles the row with
`aria-current`, and a `scrollIntoView({ block: "nearest" })` keyed on the SELECTION ALONE
brings a viewport-made selection to a row that may be scrolled out of view.
**The rows are ordered NEWEST FIRST** (foundations T5), by descending `entityId` — core mints
those from the op log's monotonic counter, so the highest is the most recent commit. The order
is decided in `field/EntitiesList.tsx` (`newestFirst`) rather than in `useFieldEntities`, whose
other three readers do `.find` lookups and must not silently acquire a promise about order, and
it is **stated in the section header's tooltip** (`ORDER_HINT`) so it is a contract rather than
an accident of how the host walks its log. The statement is worded to refuse one reading: the id
counter is SHARED with the ops, so "newest first" is true while "entity #3 is the third stamp"
is false. Both halves came from the T4c gate walk, where an agent generated a cave into the
shared session and the human could not tell which row it was.

`field/EntitiesList.tsx` carries the row verb set — Open, freeze / unfreeze, bake ("sever"),
delete, each through one `RowVerb` component that owns the wrapper a disabled button needs
(a disabled button swallows the pointer events a `title` wants, so the reason rides the
`aria-label` too). The pictographs are **lucide SVG** since the F4.5 holistic gate
(`Snowflake` / `LockOpen`, `ArrowDownToLine`, `Trash2`, with `Lock` on the frozen badge);
they replaced bare emoji, which could carry no tone — the measured mechanism is argued once,
at `DESTRUCTIVE_VERB_CLASS` in that file, and is not repeated here. Being `currentColor`
SVG they take D-23's destructive lane: `text-destructive-text` at rest AND on hover (a
`ghost` button's own `hover:text-accent-foreground` is in the same twMerge group), 50 % dim
when refused. `--destructive-text` is pinned on `--accent`, the hover surface, in
`tests/design-tokens.test.ts` (4.86:1, the tightest of its three ledger pairs); the tone
rule is pinned from both sides and **each verb's glyph is pinned by identity** — the
`lucide-*` class on the rendered svg — in `tests/chrome/entities-palette.test.tsx`.
`RowVerb`'s glyph props are an exclusive union (`Icon` xor `label`), so neither "shows
nothing" nor "shows both and discards one" typechecks. **Duplicate is deliberately NOT a row verb** —
D-14's glyph map puts the down arrow on bake and the mock puts duplicate in the burger, and
`ArrowDownToLine` (an arrow landing on a baseline) was chosen over anything resembling
lucide's `Copy` to keep that reading intact. The `Δ` drift badge appears on any row the
standing report touches; membership is the HOST's answer, pushed as
`FieldDriftReport.entityIds` and turned into a `ReadonlySet` by the provider, so a badge
cannot outlive the geometry it points at.

Esc clears the entity selection when it is the most recently acquired capture (§17.4), and
`F` (`view.frame` → `FieldHost.frameSelection`) frames the selected entity's footprint, else
the cell selection's AABB, else refuses with "nothing selected to frame — select a stamp, or
draw a cell selection" — a FIXED priority rather than a recency rule, because an object
selection names one thing and a cell selection names a volume. Since T5 the rig ANSWERS that
refusal (an `ActionResult`) rather than reporting it, and each of its two callers says the
sentence on its own channel: the canvas `F` branch through `subscribeToolError`, `view.frame`
as the verdict it hands back. The two keys deliberately disagree about ordering, and that is the reason: `F` asks
"which of these is the subject?", Esc asks "what did you just do?".

### 17.3 Move, delete, duplicate — and a move IS a reconfigure session

**`FieldHost.beginMove(entityId)` opens exactly the session `openEntity` opens** — the same
refusals (unknown id, frozen, baked, retired generator, all runtime-quiet through
`subscribeToolError`), the same ghost, the same terminal verb. What it adds is a MODE: the
session is flagged `StampSession.moving`, and the CURSOR drives the region. That is the
load-bearing decision of the whole verb — nothing is written to the log until the drop, so a
cancelled move costs nothing and leaves no history entry, and the drop is one ordinary
reconfigure splice.

`field-host/field-move.ts` owns the arithmetic and is pure, for `field-pick.ts`'s reason:

- The mapping is **anchored, never incremental**. Every reading asks where the cursor is
  relative to the last anchor and applies the DIFFERENCE against what has already gone to
  the region, so rounding cannot compound over a drag and a cursor returned to the press
  point returns the region to where it started.
- The **first anchor is taken at the PRESS**, not at the event that crosses the threshold, so
  the travel that opened the move is not silently lost.
- `resolveMapping` promotes a free ground drag to the **vertical axis under ⇧** (the arrow
  pad's own rule — a ground-plane drag has no way to express height); a gizmo drag is
  `fixedAxis` and ignores it. `movePoint` returns `null` — meaning HOLD STILL — when the view
  cannot answer: edge-on to the plane, behind it, or within ~8° of the axis.
- `unanchored` retires the anchor AND the press pixel on a camera change mid-move. Both go,
  because a world point read under the old view and the pixel that produced it both lie after
  the camera turns; `reanchored` carries `applied` forward, so the re-anchor moves the region
  by exactly zero.
- Steps are whole `LATTICE` (0.5 m) units, handed to the same `nudgeStampRegion` the arrow
  keys drive. There is deliberately **no travel clamp** — the field has no world bounds, and
  the d-pad has none either.
- `sameRegion` is the zero-step rule: `dropMove` compares the live session's region against
  the entity's RECORDED one and ends the session without a history entry when they match, so
  a twitchy click never spends an undo entry on a re-splice that changed nothing. It replaced
  `moveIsIdle`, which asked the DRAG (`d.applied === [0,0,0]`) and so only knew about the
  cursor — an arrow-nudged grab read as idle and ⏎ discarded the user's steps, while an
  out-and-back drag read as moved and spent an entry on a no-op. T3c; both are pinned in
  `tests/field-host-move.test.ts`.

**`field-host/gizmo.ts`** is the translate handles' pure math — `gizmoSpan` derives the
geometry from the selected footprint and `axisLines` emits the `drawLines` pair, so the drawn
arms and the picked arms are the same span. `pickAxis` culls an axis within `VIEW_PARALLEL_COS`
(~8°) of the view ray, where a hit-distance test is meaningless. The arms narrow to the
constrained one the moment a drag owns them (`activeGizmoAxis`); a free ground drag keeps all
three, because it has no single axis to name.

**Delete** is `FieldHost.deleteEntity` over core's **`deleteGeneratorEntity`** (new core
surface this slice — `docs/reference/core-modules.md` carries its contract): the span AND its
entity op are spliced out, the chunks the span wrote rewind, and the downstream ops reaching
them replay on top, so the log reads as though the stamp had never been committed with every
later edit preserved. ONE undo entry. Core is setup-loud on all three refusals (unknown id,
frozen, baked) and this is the editor, so each throw is caught and reported verbatim on the
tool-error seam. Its `dirty` set can be EMPTY without nothing having happened: a
placements-only entity writes no cells, so deleting a scatter dirties nothing while every prop
it placed leaves the log with it.

**Duplicate** is `FieldHost.duplicateEntity` — a fresh `commitGenerator` from the record's own
provenance, not a second reference to it. It offsets +X by the original's footprint extent
snapped up to the lattice (`latticeClearance`), takes a fresh uint16 seed when core's
**`GeneratorDef.usesSeed`** says the generator READS one (so a duplicated cave or scatter is
genuinely different, while a hall's copy is not left wearing a different number for an
identical shape), opens at merge policy `"replace"` because `GeneratorEntity` records none,
and the copy becomes the selected entity. Frozen and baked entities can both be duplicated —
the copy is a new commit from recorded provenance, so duplicating is how a baked stamp's
recipe becomes live again.

Reach: ⌫ / Delete is `edit.delete`, **⌘J** is `edit.duplicate` — not the mock's ⌘D, which
Safari owns as add-bookmark and does not let a page intercept — and **G** is `edit.grab`. All
three refuse with no selected entity, and delete and grab refuse during a session as well
(deleting the entity under a reconfigure, or replacing the session a `G` would open, both
discard work the user is still doing). The delete confirm names the op count, because a row
reads "1 ops" for a scatter that takes every prop it placed with it; the row's delete and the menu
item raise the same App-owned prompt, though the sentence is spelled in both
`shell/EntitiesPalette.tsx` and `lib/actions.ts`.

### 17.4 The action registry, the window dispatcher, and the RMB-gated fly

**The editor has one action registry** (D-10/D-11/D-12), and since foundations T3b2 Task 4 it
is written in two files. `src/action-registry/descriptors.ts` holds the DATA per action — an
id, a group, the binding as a `KeyBinding` row, a one-sentence `hint`, a `gate`, and the
`armsTool` / `flyLetter` flags — so a process with no DOM can hold the table (§22.5).
`frontend/lib/actions.ts` holds the four closures a row cannot (`label`, `enabled`, `checked`,
`run`) and JOINS them onto those rows by id, exhaustively and at compile time. Two fields a
reader may look for are not in either list: the display chord is DERIVED from the binding
(`capOf` → `keycap()`) rather than stated beside it, and `match` no longer exists — one pure
`matchBinding(binding, facts)` replaced all 22 closures, which is what let the table leave the
browser. The chrome module is pure and DOM-free (`KeyboardEvent` appears as a type only), and
it type-imports the host like every other chrome module. There was one field more, `menuTitle` — the burger's half of the
same "the reason will not fit in the label" concept — until F4.5c Task 8 rendered it on a
non-menu surface and merged it into `hint`: one concept, one name, one place a rewording
happens.

**Eight surfaces render from it** (measured at foundations T3b2), which is what stops a
binding from being live and undocumented or documented and dead: the window key dispatcher
(`hooks/useGlobalKeybindings.ts`), the burger's World/Edit/View groups
(`shell/BurgerMenu.tsx`), the shortcuts overlay (`shell/ShortcutsDialog.tsx`), the ⌘K command
palette (`shell/CommandPalette.tsx`, which renders the whole table at once), the tool rail
through `TOOL_FAMILIES` (§17.8), the top bar (Bake and the palette toggle,
`shell/TopBar.tsx`), the status bar's selection-chip popover (`shell/StatusBar.tsx`), and
`ActionTip` (`components/ui/tips.tsx`), which looks a keycap up by id so a tooltip cannot
print a stale chord. Two further modules value-import `entityName` alone and are NOT readers
of the table (`shell/SessionCard.tsx`, `shell/ToolStrip.tsx`) — the distinction is what the
count means, and it is why re-deriving the eight takes three numbers, not one: **fourteen**
files import `lib/actions.ts`, **twelve** of those value-import it
(`hooks/useActionContext.tsx` and `components/field/EntitiesList.tsx` take `ActionCtx` and
`ActionId` as types and read nothing), and **eight** of those read the table. The first two
moved in T3b2 Task 4 — `runNamed` / `sayResult` gave `WorldDrawer.tsx` and `useWorld.tsx` value
imports, `ActionId` gave `EntitiesList.tsx` a type-only one — and the commit that moved them
restated this procedure without re-running it, which is the failure this paragraph is about.
The number has been wrong at every re-count so far, so it is written in exactly two places —
here and at the head of `lib/actions.ts` — and adding a reader means editing both. §16.6 points
here rather than carrying a third copy. The
`tool` and `session` groups are deliberately absent from the menu — arming a brush and ending
a session are the rail's and the viewport's, and the overlay is where they are discovered.

**`hooks/useActionContext.tsx`** assembles the `ActionCtx` those predicates read (host, armed
tool/gesture, session, both selections, stats, world, view, workspace, the generator registry,
the ⇧S stamp cursor, the pending stamp arm, the two history labels) and owns the ONE window
keydown listener. It is a PROVIDER rather than a hook the shell calls, and that is load-bearing
for render cost: assembling the ctx reads values that move on every op and every drag frame, so
doing it inside `ShellChrome` would rebuild the palette body elements per pointermove. Here
`children` arrive already built. The listener binds ONCE and reads the ctx through a ref written
in an effect — a render React discards must not leave its ctx behind as the one the next
keypress acts on.

**Who owns a key.** Two keydown listeners. The canvas (`field-host/field-host.ts`) keeps the
keys that steer the viewport under the pointer — the fly set, `[`/`]`, the arrow nudges, the
momentary ⇧/⌃ — plus first refusal on ⌘Z, ⏎, Esc, R and F. Everything else is the registry's, on
`window`, which is the only listener that carries the gates and the only one that still works
after a palette click takes the canvas's focus. Where both bind one key the canvas branch that
ACTS calls `stopPropagation`, and that call is the whole licence for the second owner.
`preventDefault` fires as soon as the gate ALLOWS an action, *before* `enabled` is consulted:
at that point the key is claimed, and a disabled ⌘S must still suppress the browser's save-page
sheet. A REFUSED action prevents nothing, so the character the user is typing still reaches
their field.

**The gate** (`gateAction`, with `clickGate` its `caller: "named"` reading for a pointer press
on the same verb, so a button and its key refuse for the same reason in the same words) has two
classes plus two per-action flags. Since T3b2 Task 4 the two CLASSES and `flyLetter` bind the
KEY caller only, while `armsTool` and the modal suppression bind both — see §22.6's caller
table for why, and for the hard-code that split closed:

| Class / flag | When the key may fire |
| --- | --- |
| `chord` | ⌘/Ctrl chords. Live everywhere **including inside a text input**, because the browser default they replace is worse. |
| `typed` | Every bare letter plus ⌫, Esc and ⏎. Refused when the focus is in a text input, and nowhere else. |
| `flyLetter` | Refused while `FieldHost.isLooking()`. Declared per action rather than per class — `S` / ⇧S are the whole membership, because `readFlyMove` reads only w/a/s/d/q/e and a blanket rule would kill `R` and `F` mid-orbit for no collision at all. |
| `armsTool` | Refused while a session is live, **with a toast**, because a key that looks dead teaches the user it is dead. |

A modal confirm suppresses every class. "Text input" means TYPED TEXT ENTRY, not "focusable
form control": `lib/keybindings.ts` matches textarea, select, contentEditable and the textual
`<input>` types, and deliberately NOT `range`/`checkbox`/etc. Both directions of that line cost
something real — a matched slider makes `V`/`B`/`F` dead on the control users drag while looking
at the field, and an unmatched `<select>` lets the Esc that dismisses its popup run the cancel
ladder and discard a live session.

**WASD/QE fly ONLY while the right button is held** (D-10, the Unity mechanism). `applyFlyMove`
returns immediately unless a look drag is running, and the gate lives there rather than at the
key handler because `keys` still collects w/a/s/d/q/e whatever the button is doing. That gate is
what buys the bare-letter budget the registry spends: `S` is fly-backward *and* the stamp
family, and the button is what decides which. `isLooking()` is a POLL rather than a subscription
— the button goes down and up between renders, so a mirrored boolean would answer for a frame
that has already gone.

**Esc cancels ONE thing per press, and the thing it picks is the most recent.** Both entry
points — the canvas keydown branch and the public `FieldHost.escape()` verb — still share one
implementation so they cannot disagree, but that implementation is a **capture stack**
(`field-host/input-router.ts`) rather than the five fixed rungs it was at the seal. Six
states can be captured: a half-drawn box anchor, the segment anchor, the pending stamp arm
(§17.8), the live session (a move included), the selected entity, and the cell selection —
which is PARKED in the Reselect slot, so an Esc that went one press too far has the same way
back a Clear does. It returns whether it acted, which is how the canvas branch knows whether
it has claimed the event. **The ORDER is acquisition order, not a declared priority**, which
changes behaviour in three reachable cases — see §20.

**Undo/redo go straight to the host: the field's op log IS the editor's history** (§17.6). ⏎ is
`FieldHost.confirmSession()`, public precisely because `beginMove` does not focus the canvas — a
grab started from the Edit menu, or by `G` with a palette control focused, has no canvas
listener to answer the "⏎ drop" the status bar advertises.

### 17.5 The session card — three states over one control set

**`shell/SessionCard.tsx` (D-13) is the editor's properties surface**, and the successor to both
the F2b stamp inspector and the whole dock-era Inspector concept. Its state is decided by two
host facts alone — is there a session, is an entity selected — and by nothing it remembers:

| State | Subject | ⏎ / Esc |
| --- | --- | --- |
| **CREATE** | a `stamp` session; there is no entity yet, so it is about a REGION | commit / discard |
| **REST** | an entity is selected, nothing is armed; values come off the committed RECORD and no ghost previews | *no verbs at all* |
| **RECONFIGURE** | a `reconfigure` session (a MOVE is one, flagged); values come off the SESSION and the ghost previews live | apply / revert — **drop** / revert for a move |

**Two sources, one selector.** Rest reads the record, reconfigure reads the session, the card
PICKS on `stamp !== null` and never merges them — which is the whole answer to how they stay in
agreement: they do not have to, because only one is on screen at a time. A card that blended
them would show a number no surface is about to build.

**The promotion** is the subtlest thing here. In REST, the first control the user COMMITS
through opens a reconfigure carrying that edit, and four rules hold it together: a TOUCH is a
commit and never a preview (every text field previews per keystroke, so promoting on preview
would open, cancel and re-open a session per character, on "1" while the user typed "12"); the
touch that promoted is parked as a `PendingTouch` and pushed through `updateStamp` against the
SESSION's own seed and policy (the merge policy in particular is not recoverable from the
record); it paints ONCE, which took two mechanisms — `openEntity` publishes the session
synchronously so the touch and its arrival land in one React batch, and the parked touch is
applied from a **layout** effect because a passive one runs after paint and the value that would
flicker is the number the user just typed; and a REFUSED promotion drops its touch, because
`openEntity` is runtime-quiet on an unknown id, a frozen/baked entity and a retired generator,
and a surviving edit would land on whatever session opened next.

The card **owns no lifecycle verb** (D-14, user ruling): freeze, bake and delete are the entity
ROW's, because they change what an entity IS rather than what it holds. `SeedRow` is gated on
core's `def.usesSeed` — a hall never reads its seed, so a field and a ⚄ for it are two controls
that do nothing. A frozen or baked record renders `ReadOnlyParams` instead of a form, because
`openEntity` refuses them and live controls would be a form whose every edit reported a refusal.
The four leaves in `shell/session-card/` (`SeedRow`, `AdvancedSection`, `ReadOnlyParams`,
`SessionFooter`) are presentational and hold no host knowledge; the file itself keeps the
selector, the promotion, and the two funnels (`push` / `promoteThen`) every control writes
through.

**`SessionCardPresence`** is the card's open state, driven. It is a sibling component rendering
`null` rather than an effect inside the card, because the layer unmounts a closed palette's body
and the thing that opens a palette cannot live inside it. It is keyed on the **subject**
(`subjectKey`), not on the open flag, which is the whole "is this annoying?" answer: closing the
card with its × is a statement about the thing you were looking at, so the same subject pushed
again leaves it closed while a DIFFERENT subject re-opens it. `PALETTES.session.drivenOpen`
records the consequence — geometry and collapse are still the user's and still persisted, but
`open` is neither.

**D-25's forms vocabulary** landed in the same slice and the session card is its one consumer
(`SchemaForm` has no other caller left). The decision lives in `inspector/kind.ts`'s
`resolveKind`, not inside the renderers, because the registry's contract is ONE lookup — kind in,
renderer out:

- an `enum` of at most `SEGMENTED_MAX_MEMBERS` (4) is a **segmented** radiogroup, one tab stop
  with arrow-key navigation; above that it stays a Select. The MEMBER commits, never its label.
- a bounded numeric that is INTEGRAL and spans at most `STEPPER_MAX_STEPS` (12) intervals is a
  **stepper** (− exact +) — `cave.chambers` runs 2..6, and on a 120 px track the difference
  between 3 and 4 chambers is a pointer twitch. Anything else bounded is a **slider** with a
  scrubbable label and an exact input beside it.
- `inspector/lib/numeric-schema.ts` **never guesses the step**: `multipleOf` when the schema
  declares one, `type: "integer"` when it declares that, otherwise a 1-2-5 ladder near
  `span / TARGET_STEPS` (100). Core's generators validate params setup-loud from inside the
  preview worker, so an off-grid value comes back as a thrown string one round trip later.
- the scrub takes `setPointerCapture` on the label, because this palette floats over a canvas
  that orbits on pointermove and the two are DOM siblings; `pointercancel` gets its own handler
  and deliberately does **not** commit.
- `UnitSuffix` prints `schema.furnace.unit` and nothing when the schema declares none.
- a `FieldRefusal` reported up from `SchemaForm` disables the commit verb and names the offending
  field — and it **outranks** the preview-settled gate, because a refused param never previewed.

The same commit pruned the inspector's orphans of the deleted scene surface —
`EntityRefField`, `ResourceRefField`, `options.ts` and the `ref-options` / `resource-kind` /
`resource-refs` / `common-components` lib modules all deleted.

### 17.6 ONE named history — the seam and the palette

**`field-host/field-history.ts` derives what each undo/redo step DID, in words**
(D-F4.5-11). Core's `LogEntry` carries no label field and deliberately so — a label is a
presentation fact that would have to be authored at every push site and serialized into worlds it
has no business being in. It is derivable instead, and this module is the one place the
derivation lives, so the burger's "Undo dig" and the palette's rows cannot disagree.

- It reads core's `FIELD_GENERATORS` constant for display names and **deliberately not
  `generatorById`**, which is setup-loud on an unknown id: a world file can name a retired
  generator, and a label that threw would take down every surface rendering history. The id is
  the fallback.
- `entryLabel` is total over `LogEntry` and, through `opsEntryLabel`, over `FieldOp` — enforced
  by an `unhandled(value: never)` function rather than a trailing default, written as a function
  because an unused `const _: never` is what Biome's `noUnusedVariables` removes and a guard a
  formatter can delete is not a guard.
- A `splice` with empty `inserted` is a **delete** (`deleteGeneratorEntity` is reconfigure's
  splice with no replacement); a splice whose region moved while seed and params settled is a
  **move**; anything else is a **reconfigure**. An `entity-update` checks **baked before
  frozen**, because `bakeGeneratorEntity` clears `frozen` as part of severing the recipe and
  asking about `frozen` first would call the one irreversible verb an "unfreeze".
- `HISTORY_TAIL = 50` (Photoshop's own default) bounds the PAYLOAD, never the history: `⌘Z` still
  reaches everything. `FieldHistory` carries the true stack depths beside the arrays so a
  consumer can say how much it is not showing, and both arrays are **newest-last** — `undo.at(-1)`
  is exactly what ⌘Z would step.

**`subscribeHistory` is the twelfth host seam and `useFieldHistory` the ninth context** — §16.7's
figures of eleven and eight both moved here. The host publishes only when the log's two entry
stacks really moved (several paths tick the entity list without touching them), which is why the
provider's mirror needs no comparator, and the context DEFAULTS rather than throws because an
empty history means "nothing has been done yet", which is exactly true outside a provider.
`useActionContext` reads the top of each stack for `Undo ${label}` / `Redo ${label}`, off the
LABELS rather than off `stats.undoDepth`: the depth says whether there is a step, the label says
what it is.

**The feed also mints the change token, and it rides the PAYLOAD rather than a seam of its
own** (foundations T4b). `FieldHistory` carries a `revision`: an opaque compare-only string
over `worldEpoch / ops.length / undoLen / redoLen / nextId` — the same five terms
`field-entities.ts`' footprint memo signs on, spelled the same way on purpose — composed by
`field-history-feed.ts`'s `revisionOf` from the very signature the publish was decided by.
It is in the payload because the alternative was measured and rejected: a `FieldHost`
poll (which this briefly shipped) runs one-directionally AHEAD of the chrome's latched
mirrors, so an ask landing between a log mutation and React's next commit answers with a
post-edit cursor over a pre-edit picture — which a reader caches, and which every later ask
then confirms as unchanged for ever. Riding the payload makes *"this token and these labels
describe one moment"* structural. **The cursor therefore certifies `history` and nothing
else**: `stats`, `selection`, `selectedEntity`, `tool`, `session` and `world` ride their own
latches (`stats` is published per rAF, so it can trail the cursor by a frame after an edit)
and `camera` is polled live.

The token is STATELESS in the sense that separates it from the log-signature cache in
`field-stats.ts`: it can alias but it cannot latch, because there is no tracker to fall
behind. `HistorySignature` stays module-private — the token is a string, so nothing outside
can still ask what a signature IS. **The change guard grew three terms to match**: it
compared the two stacks alone, which meant a world swap that left the history empty
published nothing — measured, a fresh host's `newWorld()` plus a whole `loadWorld` left the
subscriber on its single arrival push — so a payload-carried token would have missed a world
load entirely. It now compares the epoch, `ops.length` and `nextId` beside the two lengths
and the two top-entry identities, at the cost of one extra publish per world swap over an
empty history. Three terms are load-bearing in ways a pin holds: the world term, and
`nextId` + `ops.length` as a PAIR standing in for the top-entry identities, which cannot
serialize — `nextId` catches undo-then-a-new-OP, `ops.length` catches undo-then-a-freeze/bake,
which mints no op while the undo has already peeled the log. The one alias it carries is
documented and pinned: two `entity-update` entries (freeze/bake) create no op, so
freeze → ⌘Z → bake composes the same five numbers over a world where a different thing is
true. It is a change HINT — the caller re-reads state and never diffs cursors — and it
answers about the FIELD only: selection, camera, tool and gesture all move without touching it.

**`shell/HistoryPalette.tsx` is a STEPPER, not a seeker**, and that is a contract rather than a
simplification. Core's undo/redo are strictly LIFO — each entry's chunk images assume the state
below it and `splice`/`entity-update` entries address `log.ops` positionally — so there is no
honest way to build a seek on these primitives. A row click therefore calls `undo()` (or
`redo()`) N times, which is exactly what the user could have done with N presses. If the log
moves between the render and the click, the click still takes N legal steps, just not to the
state the row named; that cannot corrupt anything, because "N steps" is meaningful against any
log where "seek to entry 7" would not be. Rows run newest-first with the current position implicit
at a divider — redo above, undo below — so time runs downward into the past, the inverse of
Photoshop's list and the right way round for a panel whose top line answers "what did I just
do?". Both sides report what they are not showing (`depth − length`), because ⌘Z and ⇧⌘Z really do
reach past them.

The palette is **summoned rather than always-on**: it starts closed, and the ways in are the
status bar's `undo N` chip (a button, present even at 0 — a history you have not started is still
the surface a first-time user should be able to find), the Edit menu's `History…` item, and the
burger's palette checkbox. `edit.history` deliberately has NO chord: ⌘Y is redo on Windows and
would teach the wrong thing, and every bare letter in the editor is a tool family.

### 17.7 The Flags palette, viewport flag selection, and cell-level selection display

**`shell/FlagsPalette.tsx`** is §15's `FlagsSection` promoted out of the dissolving control stack
— same clustering, same verify column, same filters-gate-both rule — with three things a section
could not have (D-F4.5-15):

1. **The header is a hint, not an indictment.** It leads with `Flags · N candidates` and demotes
   the raw total to a secondary line. Same data; the difference is whether opening the palette
   feels like being told off. The count is read off `byKindSeverity`, which describes everything
   FOUND, so unticking a chip can never make it read "nothing wrong here".
2. **The viewport is the primary selection surface.** Clicking a marker selects it and the list
   follows; clicking a row selects it and the CAMERA follows. Neither direction is wired to the
   other — both read `summary.selected` off the one seam.
3. **The filters persist** (D-F4.5-3), through the host-state provider's `UiStore` at
   `flagFilters` with a 200 ms debounce. They live in the provider rather than in the palette
   because the host outlives every palette and a surface that re-pushed its defaults on each
   remount would silently untick the user's bands.

Rows are clustered by `bandKey` (kind / severity / demotion) and then greedily agglomerated at
`CLUSTER_RADIUS_M = 2` single-linkage, so a run of pinches along a corridor chains into one row;
candidates float to the top with a stable sort. `FlagFilters` has four chips, of which only
`candidates` and `info` are severity bands: `unreachable` and `pits` are one-sided VETOES —
un-ticking the first hides the findings the reachability pass DEMOTED, un-ticking the second
subtracts traps from the candidate band. `pits` therefore **defaults ON** while `info` and
`unreachable` default off, because a pit carries `severity: "candidate"` and the candidates chip
beside it already claims to be showing it.

**Selection (D-15).** `FieldHost.selectFlag(key | null)` publishes on the flags seam itself rather
than on a seam of its own — a highlight and the rows it highlights have to arrive together, or a
palette paints a selection against a list from a different analyzer response. The seam count did
NOT go up for it. The store **retains** the key verbatim and `summary()` **resolves** it against
`visible` at publish time, which is what gives the two ways a key stops resolving their opposite
treatments for free: a filter that HID the row publishes null and ticking the band back brings the
selection back, while a re-analysis that RETIRED the finding publishes null and nothing resurrects
it. The published invariant is checkable — `selected !== null` implies exactly one `visible` row
carries it.

Emphasis is **size and outline, never colour**: `flagMarkerStyle` returns the row's own
`flagTint` in both branches and scales the marker by `FLAG_SELECTED_SCALE = 1.6`, and the
`--primary` half of D-15 rides the anchor CELL's outline. Re-tinting would delete the
trapped/clear/candidate signal from the one row the user is looking at. `selectFlag` frames that
same `flagCellBox` — one `store.cellSize` on a side, 0.25 m at the default lattice, where the
route it replaces framed the finding's whole chunk (sixteen cells, 4 m at that default) and left
the user hunting inside the box. The viewport's own marker click deliberately does **not** frame:
the user is already looking at what they pressed. Refusals are one-way and synchronous — a key
naming no VISIBLE finding reports on the tool-error seam and changes nothing.

**Cell-level selection display.** `field-host/field-selection-cells.ts` draws a flood
selection's actual cells instead of one AABB outline, because a 200 000-cell flood in an open
world encloses the camera and the only thing telling the user what they had selected was a box
they were standing inside. Drawing 200 000 blended cubes is not the fix either:
`SELECTION_DISPLAY_CAP = 65_536` is the budget and **surface-first** is what makes spending it
well possible. A cell with all six face neighbours selected is buried and contributes nothing but
blend cost, so it is the first thing the cap discards; the shell is emitted first, and a truncated
draw is therefore a partial shell rather than an arbitrary subset. The membership reader keeps a
one-entry chunk cache and decodes the bit layout itself, because core's `selectionHas` builds a
`chunkKey` string per call and the six-neighbour test would make 1.2 M string allocations on a
full-budget flood. Chunk boundaries need no special case — the probe looks up the neighbour's own
bitset and a missing chunk reads unselected, which is correct. **Region selections keep their
honest AABB box**: a region IS its box. When the cap bites, `SelectionInfo.displayed` says so
rather than the display silently under-reporting, and the status bar's selection chip carries the
sentence along with Clear / Reselect.

**That chip is also the chrome's only WORLD-SPACE readout** (foundations T5): it puts the
selection box's centre on the bar to one decimal (`sel 240 cells · at 5.5 12.8 13.5`, and in the
chip's accessible name) and the per-axis extents in its popover, in the phrasing an agent's own
answer uses. Same axes and metres `session_query` reports — `about: "selection"` hands back this
very box — so a number read off the bar and a number in an agent's answer are comparable without
conversion. It is the selection's box and **not the camera's pivot**, which is a stated limit:
`CameraPose` is `{yaw, pitch}`, `CameraRig.orbit()` is deliberately not a `FieldHost` member (its
docblock refuses widening the pose, a shape published as `SessionState.camera`), and the chrome's
pose latch guards on orientation precisely so a target-only move does not re-render at frame rate.
The argument, and what the bar therefore cannot say, lives once at `centreOf` in `StatusBar.tsx`.
It came from the same T4c gate walk: the agent named a cave in metres and the human had no numbers
of their own to answer with.

### 17.8 The tool rail, the top strip, the session strip

**`shell/ToolRail.tsx` (D-8) is a fixed 44 px column** down the left of the canvas cell. It is a
COLUMN, not a palette: it cannot be closed, moved, collapsed or resized, so it is part of the
cell's constant inset the way the two bars are, and it lives in the shell's body ROW as a sibling
of the cell rather than in the palette layer above it. Everything a palette can do to the canvas,
this must not do (D-1).

Every button renders from `TOOL_FAMILIES` and dispatches that family's registry action, so the
rail and the family keys (`V`/`B`/`M`/`S`) are two views of one table:

- **A click arms the family's CURRENT member and never cycles.** The rail is a mode selector;
  pressing the mode you are already in is idempotent, and cycling has its own affordance (⇧ + the
  letter, and the flyout).
- **A multi-member family carries a member flyout**, and it is the most load-bearing affordance
  in the file: deleting `ToolPalette` (which had one button per member) would otherwise have
  orphaned Fill / Paint / Smooth / Segment, Wand / Room, and every generator past the first. It is
  a 24 px target directly below the family button rather than the mock's 14 px corner tick,
  because a 44 px column has no room for both a compliant target (WCAG 2.5.8) and the family
  button's own hit area.
- **The pressed family carries the inverted fill**, and keeps full strength when it is also
  REFUSED — a refused family that is armed is the live session's own family, and dimming it would
  make "the strongest element in the rail" a 40 %-opacity claim.
- Refusals come from the registry's `armsTool` clause through `clickGate`, so the button and the
  key refuse in the same words, and they carry `aria-disabled` rather than `disabled` — a
  `disabled` button leaves the tab order, and the refusal sentence rides the accessible NAME
  precisely so a keyboard user gets it.
- The whole column is ONE tab stop with a roving tabindex (D-26), written onto the DOM in a layout
  effect rather than passed as a prop so the rows stay memoizable.

The rail is the one always-mounted action-context consumer, and its model is memoized on exactly
the ctx FACTS its four rows read — never on `ctx` itself, and for the session never on the session
OBJECT, which the stamp seam re-clones at pointer rate during a grab.

**`shell/ToolStrip.tsx` (D-6/D-7) is the top bar's middle**: what is armed, and the knobs that
steer it, in three shapes. The brush family gets params; the cell-select family gets its mode name
and the one static fact that bounds it (`snaps to 0.5 m` for a box, `budget 200k` for the two
floods — a budget note on Box would name a limit that cannot fire); the pointer gets a READOUT of
what is selected, because direct manipulation's parameter is the selection itself, named through
the registry's own `entityName` so the strip, the rows and the menu labels cannot call one object
three things.

**The capacity rule (D-6)** is what keeps the strip from moving the canvas: it is ONE flex row that
never wraps and never changes height, held by `overflow-hidden` plus a per-effect container query
(`STRIP_PARAMS_MIN`) that hides the whole param group at once and degrades the strip to `name + ⋯`.
That degradation is only safe because `shell/StripOverflow.tsx` holds the effect's WHOLE option
list, of which the strip renders a prefix — ONE list, two renderings, so "the ⋯ holds everything
the strip shows plus the rest" is structural rather than a promise. Both the option list and the
breakpoint are `shared/action-table.ts` rows since T3b2 Task 5 (§22.7); `shell/tool-params.tsx`
derives them at module scope and still owns how each param DRAWS. The two
non-brush branches have no threshold, deliberately: their content is one short span that cannot
overflow, and content that never hides is never unreachable.

**`shell/SessionStrip.tsx` replaces the tool strip while a session stands** (mock frame 2) and
answers the three questions the tool strip cannot: WHAT is being edited, WHICH of the three states
it is in, and HOW it ends. `lib/field-session.ts` owns `sessionName` and `sessionStateTag` so the
strip and the card cannot disagree about either. The verbs here are READOUTS, not buttons — the
clickable pair lives on the session card, which auto-opens on the very session this strip is
describing. `R` is shown only where it can act: a MOVE is decidable from here (it is a region
translation) while a generator's rotation is not, so the key hides where it is CERTAINLY dead and
stays where it is merely possibly dead.

**D-7's staged grammar** landed across the same three surfaces. A session SUSPENDS the brush:
`suspendedByStamp()` swallows an LMB stroke and the segment click alike (the segment brush reaches
the store through its own branch and needs its own guard), saying so once per session, and the
`armsTool` gate refuses the family keys — `X` among them, since the brush it swaps cannot stroke.
And a stamp picked with **nothing selected** now enters region-draw instead of refusing:
`FieldHost.startStamp` arms a `PendingStamp`, published on `subscribePendingStamp` because the host
owns both halves of the question — whether picking a stamp opened a session or asked for a region,
and every path that ends the arm. Four surfaces read it (the rail's pressed family, the status
keymap, the canvas cursor and the host's own click routing), and inferring it in the chrome is how
they would disagree. The arm SHADOWS the armed gesture: while one stands LMB is drawing a region
whatever the gesture slot still says.

**`field-host/viewport-cursor.ts`** is D-F4.5-8's third arming channel, and its two decisions
live together because they have to agree: the CSS keyword under the pointer (`grabbing` / `grab`
for a live move, `cell` for the two-click gestures, `crosshair` for the one-click commits,
`default` for the pointer and for anything a session has suspended) and the world-space mark drawn
before the first click (`ring` for the segment brush, whose sweep really is `digRadius` thick;
`cross` for a box corner and a pending stamp's region corner, neither of which has a radius).

The status bar's keymap line is the fourth channel, and it is **derived from the tool table** —
`shared/action-table.ts`'s `deriveArmedKeymap` walks `STATUS_PRECEDENCE` over row data, and
`shell/status-keymap.ts` is the adapter that flattens the host's session/pending/segment objects
into the plain input the floor can take. It is pure and React-free, so its strings are tested
directly rather than through the DOM.

*(It was hand-enumerated until T3b2 Task 5, on a reason this paragraph used to carry and §22.2
now owns, quotes and retires.)*

Its modifier clause is derived (`deriveModifierParts`) rather than static, because
`deriveMomentary` swaps dig↔fill symmetrically and passes ⌃ through under paint and smooth — a
static clause named three keys the host does not bind.

### 17.9 What is left of FieldPanel — nothing

`FieldPanel.tsx` is **deleted**, and the `controls` palette id retired with it. The panel's organs
went to five places over the slice: the tool palette and brush inspector to the rail and the top
strip (§17.8), the stamp inspector to the session card (§17.5), the flags section to its own
palette (§17.7), the selection count and its verbs to the status bar's chip, and the entity list to
the entities palette back in F4.5a (§16.7).

`PALETTE_IDS` is now `entities`, `session`, `flags`, `history`, `log` — and `controls` is the first
id to actually exercise the closed union: a blob written by any earlier build still carries a
`controls` record, and `deserializeWorkspace` drops it on the floor exactly as it drops an id that
never existed. **Nothing migrates the stored shape**, which is the whole reason the union is closed
in `lib/palette-store.ts` rather than inferred from whatever the blob happens to contain. No default
claims an EDGE any more — `controls` was the only one that docked.

The shipped arrangement is **three columns**, re-picked at F4.5c Task 11 against a 1280×800 design
floor (`DESIGN_FLOOR_CELL`, 1235×730 of cell): `entities` at x = 24 (360 wide) with `flags` below it
at y = 380, the session card at x = 420 (280), and `history` at x = 720 (240). Four palettes must not
collide and only three columns fit, so exactly ONE column stacks — and the upper member of that stack
declares a `maxHeight` extent (`entities`, and `log` which shares its corner) that the layer enforces
as a `max-height`. That budget is what makes the arrangement PROVABLE: `tests/palette-store.test.ts`
checks all ten pairs and passes each only on a declared corner-share, disjoint columns, or an extent
that clears the palette below. It is the check that pays the two F4.5b gate riders — R21 (a long
entity list growing through the flags palette) and R27 (the summoned History palette landing on the
live session card). Past history's right edge at 960 the cell is clear, which leaves the top-right to
the axis triad and the bottom-left to the collapsed-chip rail.

**A palette is RESIZABLE** (the F4.5 gate ruling, closing the Flags palette truncating its coordinate
on most rows and the extent-cap question in one mechanism). Each palette carries a corner handle — a
real `button`, so the arrow keys size it too (Right/Down = bigger, `⇧` = the long step) — and the size
it sets joins the D-3 workspace blob beside the position: persisted, restored, cleared by Reset
Workspace. It is stored as an OPTIONAL `width`/`height` on `PaletteState`, absent until the user drags,
so "has this been sized?" needs no flag, an old blob migrates by having no field, and a later change
to a declared default still reaches everyone who never dragged. `paletteBox(id, geom)` reconciles the
declared default with the user's size and is read by both the inline style and `cellBounds`, so the
rendered width IS the width the projection subtracts. A gesture writes only the axes it actually
moved — `RESIZE_KEYS` gives every arrow a zero on one axis, and `Palette`'s drag latches a
`movedX`/`movedY` per gesture — so a width-only press cannot pin a height and stop a content-sized
palette (the session card, whose body is a form with an expanding section) from growing. The clamps
are the scope guard's and no more: a floor that keeps the header (and therefore the move grip)
reachable, and a ceiling at the cell so the handle itself cannot leave it. A user-set height REPLACES
the declared extent — that is the ruling, "the extent is the default size, not a ceiling" — while the
cell's `calc(100% - y)` cap survives it, because that cap is what stops a projected palette
teleporting after a window shrink. That cap is also why the size projection below is width-only: on
y there is already something holding the box inside the cell, and on x there deliberately is not.
**The extent has ONE home**, `PALETTES[id].maxHeight`: a palette body that capped its own list with a
`max-h-*` would be a second ceiling `paletteBox` cannot see and a resize cannot drop, which is what
made dragging `log`, `history` or `flags` taller add empty space under a ten-row list.
`tests/palette-store.test.ts` scans the palette-body directories for one. The pairwise proof above
still reads the DECLARED figures only: a user's own arrangement is theirs to overlap.

Two other F4.5c Task 11 facts about the same geometry. **A palette moves by keyboard** (D-26): its
title is the grip — a real `button` INSIDE its `h2`, because a `role="button"` header would make the
collapse and close verbs presentational while dropping the heading would cost heading navigation —
and the arrows step it 8 px, ⇧-arrows 32 px, through `nudgePalette`, which is `movePalette` with the
origin resolved first, so the keyboard inherits the drag's clamp and edge snap rather than restating
them. The ONE deliberate divergence is leaving a dock: a step smaller than `SNAP_PX` would re-snap
forever, so a departure is enlarged to `SNAP_PX + 1` (arrival is unchanged). Modified arrows are
neither acted on nor prevented; ⇧ is the exception because it is the long step. Esc is deliberately NOT claimed: the move is modeless, so there
is nothing to leave, and Esc stays `session.escape`'s. **A WINDOW resize projects, it does not move**
(`clampToCell` for the origin, `clampBoxToCell` for the size): the layer measures the cell and clamps
stored geometry AT RENDER, leaving the record alone — and `useCellSize` takes the ⌘\ latch as a
dependency, because a `display:none` layer measures zero and no resize event fires when the latch
lifts — so a window that shrinks brings a stranded palette back into reach and one that grows again
returns it to where the user put it. Clamping the state would instead have lost the position
permanently, marked the arrangement `touched`, persisted it, and vetoed a restore that had not yet
arrived. The SIZE needs the same projection for a reason the origin does not have: the resize handle
rides the box's far corner, so a palette sized in a wider window puts its only shrink control outside
a `fixed inset-0` shell that nothing scrolls. `edgeAt` carries the matching guard — a cell with
`maxX <= 0` has no edge to dock to, because every x resolves to 0 and there is no direction the
gesture could have expressed. Without it a too-narrow cell inverted the tie-break and silently,
permanently docked a free palette RIGHT on its next drag.

`hooks/useFieldHostState.tsx` was the ONE subscription point — **thirteen seams through
ten contexts** at the seal (§18.6 adds the thirteenth): no surface below the provider might
re-subscribe to anything it owned. At the seal the rule was self-enforcing — every
`FieldHost.subscribe*` seam was a single slot, so a second subscriber silently stole the
first's — and foundations T3a made the seams multicast, which retired the hazard and left
the rule standing on cost and single-source-of-truth instead (§16.7, §20). **Foundations
T3b1 (2026-08-06) then retired the rule** (§21.3): the ten contexts became per-consumer
`useSyncExternalStore` latches, so a second mirror of a seam is now the normal arrangement
and the module is the one PLACE the seams are read rather than the one subscription. The
claim is still about the SET rather than about any one surface — which three seams stay the
shell's, and that the other ten are released with the reader that claimed them — which is
why its test outlived the panel it used to live in
(`tests/chrome/host-seams-and-catalogs.test.tsx`), and why that test is still the only
detector.

## 18. F4.5c — the finish (2026-08-03)

**This section is the authority on the editor's VOCABULARY** — the rules every surface in
§16 and §17 is spoken in, the two surfaces the stage added last, and the six rulings the
holistic gate handed down. F4.5a built the surfaces, F4.5b the verbs; F4.5c made them agree
with each other and then put the whole stage in front of a user.

**The gate is the seal bar, and it PASSED** (user, Safari, 2026-08-02): a new world sculpted,
stamped, propped, flagged, saved-as, made default, baked, and then **walked in the game**.
A fresh `/impeccable` re-critique of `src-frontend` found **0×P0** and nine P1s — four fixed
inside that task, five surfaced for a ruling. The user then ruled **six P1-class decisions**
at the gate, which one fix round implemented; they are rulings 2, 3, 4, 5 and 6 below plus the
resizable palette (§18.8). What the gate did NOT find is recorded too — the studio lighting
probe (P5) passed, so the cavity/AO/matcap fallback was never filed and its trigger still
stands.

### 18.1 The design-system rules (D-23)

The tokens are `frontend/styles.css`'s `@theme` block and every one of them is argued at
its own declaration; `tests/design-tokens.test.ts` is the ledger that pins the pairs. The
rules the chrome is written in:

- **Disabled DROPS HUE and keeps the shape.** A refused control dims rather than recolouring,
  so "cannot run now" never competes with the destructive lane for the same glance.
- **Hover LIGHTENS.** `--primary-hover` is `--primary` +0.05 L, `--destructive-hover` is
  +0.03 — a smaller step, because the destructive fill sits in a four-walled box: its
  near-white foreground loses contrast as the fill lightens while `border-destructive` is
  held to 3:1 against `--popover` from below. Both walls are asserted.
- **Destructive is a FILL colour and never a text colour.** `--destructive` at 0.53 L reads
  3.26:1 as text on `--card`, under the 4.5:1 floor, which is what `--destructive-text`
  exists for; it is pinned on `--accent` (the hover surface) at 4.86:1, the tightest of its
  three ledger pairs.
- **ONE neutral focus ring, and focus ≠ selection BY RULE** (gate ruling 6). `--ring` was
  `var(--primary)` until this gate, which meant a `bg-primary` control's focus ring painted
  the colour the control already is — four controls had that defect at once, and the tool
  rail had been patched around it with a `ring-offset` the ruling then rejected as
  compensation for the alias. `--ring` is now its own literal at **0.96 L**: the ledger has
  to measure the focus colour directly, and the arithmetic — not taste — picked the value.
  Against `--primary` at 0.62 L the 3:1 non-text floor is crossed at L 0.93904, so the
  ring needs ≥ 0.9391; 0.96 clears it at 3.19:1. **One pair is arithmetically impossible and
  is recorded rather than fixed**: a ring on `--primary-hover` would need luminance 1.019
  and pure white is 1.0, and the dark direction closes first (a ring dark enough to contrast
  with `--card` would need negative luminance). The impossibility itself is asserted.
- **Label casing documents the as-built**: lowercase for chrome (headings, group labels,
  param captions), Sentence case for anything naming a THING (menu items, options, action
  labels). `humanizeLabel` is untouched — reversing it would be a change across every
  inspector field with a committed rationale behind it.
- **The type scale gained a micro tier**, `--text-2xs` (0.625 rem), replacing 23 arbitrary
  `text-[10px]` / `text-[11px]` / `text-[13px]` sites that were a de-facto tier already. It
  deliberately declares **no paired line-height**: `text-[10px]` never set leading, so
  pairing one would change the HEIGHT of every migrated row, and nothing in this chrome may
  move the viewport. Leading stays each caller's own.
- **One label column**, `--spacing-label-col` (5 rem), gate ruling 2. Before it, a caption
  put its value column wherever its own text ended — `Width` started its slider 33 px in and
  `Door South Offset` 103 px in, in one form, on adjacent rows. `--spacing-*` rather than
  `--width-*` because it yields `basis-` / `min-w-` / `pl-` as well as the `w-label-col` the
  captions use, so an adopting surface needing a grid track does not add a second
  declaration.
- **The motion budget is state feedback only** — 150–250 ms, ease-out, no choreography,
  every duration zeroed by the `prefers-reduced-motion` block (which wins with
  `!important`). The one deliberate exception is the 180 ms promotion pop on the session
  card, which exists because a REST card silently becoming a RECONFIGURE session is a state
  change with no other signal.

### 18.2 One control library, enforced at authoring time (D-24)

The chrome has ONE control library and it lives in `src/frontend/components/ui/`. A raw
`<input type="checkbox">`, a raw `<input type="radio">` and a raw `<select>` are **errors**
everywhere else under `src/frontend/` — a Biome GritQL plugin,
`packages/editor/scripts/one-control-library.grit`, registered from the repo's single
`biome.json`. Three things about it are load-bearing and were measured rather than assumed:

- the `plugins` config value must be the **plain string** form. The v2.5 object form is not
  a config error at Biome 2.4.15 — it is silently IGNORED, the plugin never loads, and the
  resulting zero diagnostics read exactly like successful scoping.
- **scoping is the plugin's own job**, via `$filename` (the ABSOLUTE path; Grit regexes are
  anchored full-match, hence the leading `.*`). `overrides[].plugins` is additive and cannot
  switch a plugin off.
- what it **cannot see** is stated at the source: the type has to be an authored string
  literal, so `<input type={"checkbox"} />` does not match. Verified against a fixture, so
  the residue is known rather than assumed — and no source-text scan is blind to less.

**Four native `<select>`s survive, allowlisted by file AND accessible name**, and the
exemption is EVIDENCE rather than a deferral: Radix's `DismissableLayer` claims Escape on a
capture-phase document listener and `preventDefault()`s without `stopPropagation()`, while
`useGlobalKeybindings` never consults `defaultPrevented`. What holds the line for a native
control is `isTextInputTarget` recognising an `HTMLSelectElement`, which it cannot do for the
`<button>` a Radix trigger is — so migrating one would let the Esc that dismisses its popup
run the cancel ladder and discard a live session. Measured at the Task 12 review by
Radix-ifying `smooth mode`: `escape` called once, against zero for the native control.
`tests/chrome/native-select-key-gate.test.tsx` walks all four sites and asserts it per site,
so migrating any one of them reddens the suite as well as tripping the rule. A second hazard
found in the same read is recorded at `field/form-bits.tsx` for whoever tries again:
`SelectTrigger`'s `onKeyDown` runs typeahead on ANY single-character keydown without stopping
propagation, so on the always-on tool strip every bare tool key would BOTH run its verb and
change the mask. `range` and `color` are deliberately absent from the ban — a slider is
D-25's territory and neither has a house primitive to migrate to.

### 18.3 The keyboard-reachable grid (D-26)

`hooks/useRovingList.tsx` owns ONE tab stop for a set of controls, walked with the arrows
(the APG roving tabindex). It was extracted from the tool rail's working version and now has
**four** consumers — the rail plus the entities / flags / history row grids — and it also
owns the MARKUP those grids produce (`Grid` / `GridRow` / `GridCell`). It owns **no keys**:
every consumer claims a different set, and a hook that guessed would swallow one its caller
needed. Five details are load-bearing, and the extraction found two of them as holes:

1. **the stop is written in a layout effect**, never passed as a `tabIndex` prop — a prop
   changes on every focus move and defeats the memo on whatever renders the row. The effect
   carries NO dependency array, because the control list's LENGTH is data.
2. **clamped on shrink** — ⌘Z undoes a commit, a delete removes a row. Without the clamp the
   stop stays past the end, no control carries `tabindex="0"`, and the whole list falls out
   of the tab order with nothing thrown.
3. **the caller prevents default only for keys it claimed** — the arrows are also the
   stamp-region nudge and Esc is the app's one cancel ladder.
4. the ref is a **callback**, because the container can be mounted by an ancestor (a
   `CollapsibleSection` opening) without the hook's component re-rendering.
5. a traversal RAISES A FLAG that the tooltip vocabulary reads (§18.4).

Two lists are deliberately NOT consumers, and both are rulings: `LogPalette` has no controls
on its rows at all, so roving would turn a list a screen reader reads straight through into a
widget the user must arrow through; `WorldDrawer` is the OTHER APG model
(`aria-activedescendant`, DOM focus never leaving the filter field). The two are not
interchangeable and must not be mixed on one surface.

### 18.4 Tooltips, keycaps, and the refusal rule

**`components/ui/tips.tsx` is the chrome's tooltip vocabulary**, and it moved out of
`components/field/` at this stage because `field/` is the address of a panel that no longer
exists — it is now the chrome's most widely imported UI primitive (the rail, both bars, four
palettes, the session card's two sections and both list rows). **It finished the journey into
`components/ui/` at foundations T3b1**: `ui/segmented.tsx` needs `ActionTip` for its `hint`
prop, and that one import was the only edge reaching out of the control library into app
chrome — which D-24's scope claim (`components/ui/` is the one place a raw control may be
written) depends on not existing.

**What that bought, stated precisely, because it is less than "`ui/` is now a leaf".** The move relocated the trio's edges into the library rather than removing them: `ui/tips.tsx` has FOUR outward edges (`../../hooks/useRovingList.tsx`, `../../lib/actions.ts`, `../../lib/notify-store.ts`, `../../lib/cn.ts`) where every other file under `ui/` has exactly one (`cn.ts`), so `ui/`'s transitive closure is unchanged. What it removed is the edge pointing at `components/` — the one a reader follows when asking whether the control library may be depended on. No cycle exists: `notify-store.ts` imports nothing, `useRovingList.tsx` imports only `react`, and `actions.ts`'s edges back into `components/` and `hooks/` are all `import type`. The `byId` edge is the one to watch — the only value import into `ui/` that is not `cn` — and a future VALUE import in `actions.ts` reaching anything under `ui/` is what would close the loop. One cost of the old back-edge also survives the move untouched: `Segmented`'s optional `hint` still throws outside a `TooltipProvider`, tracked in `docs/backlog/editor-and-tooling/editor-chrome-authoring-gaps.md` §"`Segmented`'s optional `hint` throws when there is no `TooltipProvider` above it".

The wrappers are a PAIR and
which one a control gets is decided by ONE fact — can the user reach it?

- an AVAILABLE control gets **`ActionTip`**: a real Radix tooltip that opens on focus as well
  as hover and carries the registry's own keycap, so the cap on a tip and the key that runs
  the verb are the same string.
- a REFUSED one gets **`ReasonTip`**, because a `disabled` button takes neither pointer
  events nor focus and no tooltip has a channel to it. Its reason rides a wrapper span for
  the mouse and the accessible NAME for everyone else.

Nothing carries both, and nothing that carries either may also carry a `title` —
`tests/frontend-no-doc-titles.test.ts` enforces it with a named allowlist.

**A refused control STATES ITS REASON when pressed** (gate finding W-1) — one mechanism,
`notify.sayRefusal`, with three call sites (the `ReasonTip` span, the roving rail button, the
key dispatcher). Before it, pressing disabled Bake did nothing whatsoever, which is the
"every refusal visible + explained" bar failing on the one gesture that matters: a hover
tooltip is opt-in, and it costs both a wait and knowing there is something to wait for. The
rules live in the store rather than at the sites, because three copies is how they come to
disagree about a sentence `controlVerdict` went to the trouble of making one:

- **`reason: null` / `undefined` / `""` posts NOTHING.** The enabled case is silent
  STRUCTURALLY rather than by luck — an available control passes no reason, its click
  bubbles through the span, and `sayRefusal(undefined)` is a no-op. The invariant every
  caller honours is that a reason is present only while the wrapped control is refused.
- **the same sentence does not stack while it is still on screen.** Keyed on what is
  VISIBLE, not on what has ever been said: once the toast has gone, asking again says it
  again, because a user who comes back and presses the same button must not get silence.

**A tooltip is kept shut while a roving traversal moves focus past its trigger**, per axis:
travelling the ROWS of a list is navigation (every row's tip says the same sentence, so the
box is noise) while stepping the VERBS of one row is inspection (each sentence is the answer
being looked for). The mechanism is Radix's own veto — `composeEventHandlers` skips Radix's
handler when the consumer's came back `defaultPrevented`, so one `onFocus` on the trigger is
the whole fix, with no controlled `open`. Sabotaging that fix found the second reason it has
to exist: an open tooltip mounts a `DismissableLayer` whose capture-phase document listener
`preventDefault()`s Escape, so a tip left open by arrow travel makes the next Esc dismiss the
tip AND run `session.escape` — exactly what the cancel ladder's one-thing-at-a-time contract
exists to prevent. That class is closed on the row axis only; on the cell axis, where tips
deliberately open, it is **accepted, not absent**, and reads as nesting.

### 18.5 The command palette, the submenus, and `?`

**`shell/CommandPalette.tsx` (⌘K) is the registry's seventh reader and the only one that
renders the WHOLE table at once.** It is a VIEW, not a surface with verbs of its own: every
label is `def.label(ctx)`, every keycap is `def.keys`, every refusal is `controlVerdict`, so
a row cannot say something the burger, the rail or the keyboard would not. Its own chord is
read off the table it renders through `byId`, which THROWS at module init — a renamed action
must fail the import rather than render an empty `<kbd>` nobody notices. It is a **dialog**,
not a floating palette: no `PaletteId`, nothing persists it, `⌘\` does not hide it, and it is
gone the moment it has done its one job. It is never refused, because the one state in which
it would be useless is one where nothing at all can run — and in that state a palette showing
every verb greyed with its reason is the most useful screen in the editor. What the mock has
and this does not (a per-row glyph, a per-row group tag, world/entity rows) is listed with
reasons at the source.

The palette is also what makes **menu depth affordable**, which is the gate's ruling 3: the
burger's three registry groups became SUBMENUS over a top level of ten rows, where it had
been one flat run of 33 items with the fold ten rows down. What stays at top level is what
the menu is SHOWING STATE for (the palette ticks — the tick is the information) plus the two
doors; what moved behind a chevron is the registry's own verbs, whose other route is ⌘K by
name. **`?` opens the shortcut overlay** through the same `typed` gate as every other bare
key; its matcher is the one in the table that states a CHARACTER rather than a modifier +
key, with AltGr layouts the known residue.

**`view.frameWorld` is the eighth camera verb and has NO keycap, deliberately** (ruling 5).
`F` is the selection frame and ⇧F would collide with the tool rail's own modifier. It fits
the camera to the allocated chunks' AABB with its top lowered to `occupiedTopY` whenever that
answers — a chunk is 16 samples tall, so a world whose only rock sits at the bottom of a
column still allocates the whole column, and framing the chunk box would fit the camera to
padding. **The chrome's Open runs it automatically** unless `host.cameraAimedByHand()`, which
is a LATCH rather than a pose comparison: the ruling says "when the camera pose is the boot
default", and comparing floats against the boot literal would answer "yes" for a user who
orbited and happened to land back on it. Seven interactive or aim-at-something paths set the
latch; `frameWorld` deliberately does not, or one Open would suppress the next one's frame.
`host.loadWorld` frames nothing at all — it is a data primitive and every headless suite's
fixture loader, and a camera that re-aimed itself on load moved what nine suites' rays hit.

### 18.6 What the bars say — chip popovers and the segment HUD

**Three status-bar chips open a detail layer** (`ChipPopover`) where two run a verb
(`ChipButton`); one is inert text. The split is on BEHAVIOUR, not looks, and
`INTERACTIVE_CHIP_CLASS` is the one place that decides what a chip looks like — a shared
component would have had to answer "these are all chips" and "one of these does nothing" at
once. A popover mounts its content only while open, so a closed chip costs nothing.

- the **selection** chip carries what is limiting the selection plus Clear / Reselect,
  straight off the registry by id (the Edit menu renders the same two).
- the **ops** chip is the op-cost meter — the readout that answers "why has this world got
  slow".
- the **analyzer** chip is ABSENT while the advisor is idle, because a chip that is always
  there for a state with nothing to say is one people stop seeing. It can reach 0 WHILE the
  user is reading the popover it opened, so it outlives its own reason to exist for exactly
  as long as that popover is open.

**The segment HUD** is the thirteenth host seam, `subscribeSegmentHud`, publishing
`{ lenM, capM }` — how long the pending capsule is against `MAX_SEGMENT_M`. It rides the
status bar's keymap line, which is its own component precisely so only IT re-renders: the HUD
and the session context are the two pointer-rate contexts in that bar, and the chips beside
them have nothing to do with either. The line grows and shrinks with the number and **cannot
move the canvas for a structural reason** rather than a character budget — the canvas cell is
a sibling of this footer inside a `fixed inset-0 flex flex-col` root, `h-7` fixes the line's
height, and `whitespace-nowrap` refuses the wrap that is the only way text could ask for a
second row.

**Radius is a two-way MIRROR since the gate** (finding W-2). The wheel and `[` / `]` reach
the real radius without going through the chrome, so the strip readout kept the last number
the chrome itself had set and drifted from the brush the viewport was drawing. It is pushed
from `applyRadius` — the ONE funnel all three call sites already land in — rather than from
the sites, on the same argument the clamp there already makes. It rides `subscribeTool`
alongside the tool rather than taking a fourteenth seam, and rather than riding
the frame-paced stats push, because a radius is USER-paced. (The seam-count argument is
unchanged by T3a's multicast rewrite — a seam is still public surface on `FieldHost`, and
what made a fourteenth not worth it was the surface, not the slot.) It is two fields rather than a
member of `FieldTool` for a precise reason: `deriveMomentary` spreads the saved tool on
press but assigns it WHOLESALE on release, so a radius inside `FieldTool` would be silently
reverted when the user let go of ⇧.

### 18.7 Two advisor defects the gate found, and one it refuted

- **F-3 — the analyzer stuck at "1 pass owed" on a fresh world.** `analyzerPendingCount`
  now returns 0 with no profile in hand, and otherwise asks `analyzerHasWork()` — the same
  question the pump asks. The pump had already decided not to fire; only the count disagreed,
  which is a meter reading "permanently working" over an advisor that is doing nothing.
- **F-2/F-1 — the advisor-idle notice was a race, not a fact.** The "this project installs
  no agent profile" sentence is gated on **answered-and-absent** rather than merely absent:
  unanswered means the catalog fetch is still in flight, and said then it would be a fact
  about which arrival won a race — a project that DOES ship `catalog/agent.json` would read
  it whenever its fetch lost. It is a `warn` rather than an `error`, because as an error one
  sentence opened the editor with a red unread badge over a world where nothing was wrong;
  fixing the false fourth boot message also dissolved F-1 (four messages, three toast slots),
  so `TOAST_CAP = 3` stands.
- **F-4 — the steel-blue stamp wash was REFUTED**, and the refutation is a lesson worth more
  than the fix would have been: the measurement behind it was a whole-region mean over a
  region the new geometry had just entered, and **no statistic over such a region can
  separate "it got tinted" from "something arrived"**. The right question — do the pixels the
  new geometry does NOT cover move? — dissolved it in minutes. No defect, no fix, no entry.

### 18.8 Palettes the user can size

The resize mechanism, the keyboard move, and the "an extent is a default, not a ceiling"
rule all landed here and are documented where the geometry they belong to lives — §17.9.
Two consequences are worth naming from this side:

- **the extent has ONE home**, `PALETTES[id].maxHeight`. A palette body that capped its own
  list with an inner `max-h-*` would be a second ceiling `paletteBox` cannot see and a resize
  cannot drop, which is what made dragging `log`, `history` or `flags` taller add empty space
  under a ten-row list. `tests/palette-store.test.ts` scans the palette-body directories for
  one.
- **user size is unset-until-set.** `width`/`height` are optional on `PaletteState`, absent
  until the user drags, so "has this been sized?" needs no flag, an old blob migrates by
  having no field, and a later change to a declared default still reaches everyone who never
  dragged.

### 18.9 What the gate accepted, and what it left standing

Recorded because a seal that only lists fixes reads as though nothing was judged and
allowed to stand:

- **ACCEPTED as-is at the gate**: the diagonal fly's 1.41× speed, the axis-triad tip size,
  and a set of eyeball minors the user called "fairly minor, revisit if they bother me" (pick
  feel, flag emphasis, delete-copy read, Esc-in-anger, the extent-cap reading). No entries
  filed for any of them.
- **P5 (studio lighting on dig-heavy terrain) PASSED.** Its stop condition did not fire, so
  the cavity/AO/matcap backlog entry the charter reserved was NOT filed and its trigger
  stands. One tuning note went to the backlog instead: near-camera geometry blows out a
  little, exactly as the old headlamp did — the rig is byte-identical.
- **The arrow keys are canvas-only BY DESIGN.** The ownership rule at the top of `actions.ts`
  keeps viewport-steering keys on the canvas; `arrowNudgeSteps` is read only from the canvas
  keydown, and no registry action claims an arrow. The F2b-era "nudge focus trap" finding
  reproduces verbatim from the session card's d-pad for that reason — its ⌘Z half was closed
  by the window dispatcher, and the arrow half is a design position rather than an
  outstanding defect. What changed around it is that arrows are no longer the primary way to
  move a region: the drag and the `G` grab are (§17.3).

## 19. Deferred

- **AI bindings are NOT deferred any more, and the register that tracked them is GONE.**
  `docs/backlog/editor-and-tooling/editor-ai-integration-milestone.md` (gone) — the entry this
  bullet pointed at from M4 (2026-06-11) to T4c — was **deleted at foundations T4c Task 7**,
  its four shapes dispositioned one by one. Two shipped: **inbound MCP** (`/mcp` is a live
  route, `src/daemon/mcp.ts` advertises **nine** tools, five reads and four writes — §26.2
  for the door, §27.4 for its final shape) and **`viewport.capture`** (T4c Task 2, an
  ENGINE-SIDE capture that borrows the live viewport's own composition —
  `src/field-host/field-capture.ts` carries the argument; the canvas-readback route this
  bullet once called un-spiked was researched and RULED OUT,
  `docs/research/2026-08-09-viewport-capture-technique.md`, Safari's open
  capture-correctness bug WebKit#316538). One was **DROPPED**: the *embedded agent* — the
  daemon spawning an in-process AI and handing it the registry as tools, the Cursor model —
  superseded by the collaboration model T4a→T4c actually built, in which an OUTSIDE agent
  drives the editor through a claimed session it can never hold (§27.5). One was **re-filed
  with its own trigger**: outbound editor→LLM, at
  `docs/backlog/editor-and-tooling/outbound-llm-editor-features.md`. The substrate all four
  were to mount over is unchanged and is now load-bearing rather than prospective — one
  zod-validated `dispatch()` choke point (§4, which the agent door funnels *through* rather
  than beside) and a closed error-code union (§6, with its second transport edge). The verb
  set an agent is handed is the command registry, **19** commands at T4c (§4 carries the
  count and how it is re-derived), and the milestone's old "disk edits beat mutation tools"
  premise is settled the other way for worlds: an agent writes through `edit_apply` and
  `generate`, because the field artifact is not a text file an editor can patch (§27.1).
- **A scene-authoring surface is NOT deferred — it is gone.** The chrome half went at F4.5a,
  the daemon half and `@furnace/core/scene` at foundations T2, and the backlog entry that
  parked the capability was resolved by that deletion rather than by building it. There is no
  scene document to author. `packages/hello-world` is the named casualty and accepts the
  loss: it remains the reference CONSUMER of the engine and simply has no editing surface —
  `bun run edit` there now opens a field editor on a project with no field. Anything that
  wants document-shaped authoring back is new work against the field artifact (or a new
  format), not a revival.
- **Everything else** lives in `docs/backlog/editor-and-tooling/`, each entry with the
  trigger that would make it actionable. The F4.5 seal filed the charter's whole
  capability-sweep backlog column there. **The file shape changed at foundations T5**: the
  dominant form is now a MERGED TRACKER — one theme, one file, one `##` section per absorbed
  entry keeping its own Context / Trigger / Reference — so "one file per entry" (which this
  bullet said until T5) no longer describes the directory. **Superseded 2026-08-12:** the
  merged-tracker shape is retired by `docs/reference/docs-system.md` §8 — one record per
  file, merged views generated only — and the existing trackers are scheduled to be
  un-merged. `docs/backlog/README.md` is now a generated index, and
  `ls docs/backlog/editor-and-tooling/` is the other one.

## 20. Foundations T3a — the host's framework primitives (2026-08-05)

Three mechanisms the field host had hand-rolled became named modules beside it, and two
core additions landed as their enablers. The slice is a **substrate** slice: it changes how
the host says things, not what it can do, and two of the three modules have no consumer in
this slice at all — T3b and T3c are the readers. It is documented here rather than left to
the seal because two of the changes are observable, and one of them changes a behaviour a
user can feel.

`view-channel.ts`, `input-router.ts` and `substrate.ts` are all **package-internal**:
deliberately not re-exported from `field-host/index.ts`. They are seams between the host
and the clusters being lifted out of it, not surface the chrome may reach for. The map of
what is being lifted, and what is left, is `docs/reference/field-host-clusters.md`.

### 20.1 The view channel — thirteen seams, N subscribers each

`field-host/view-channel.ts` is the multicast push seam behind every
`FieldHost.subscribe*` member. It is the push-direction sibling of
`frontend/lib/notify-store.ts` and framework-free for the same reason: subscribe returns an
unsubscribe and nothing more, so who hears a publish, what a late mount sees, and what a
throwing subscriber costs its siblings are all decided in one place a bare test drives
without a DOM or a React tree. **All thirteen seams moved in one commit and every signature
is unchanged** — `subscribeSegmentHud` delegates to `field-segment.ts`'s own channel, the
other twelve are channels the host holds.

Ten of the thirteen **pushed the current value on subscribe** at T3a — the (re)mount rule: a
surface that mounts mid-state must not render empty beside an overlay already showing that
state. The snapshot is a closure re-read **per subscribe**, not captured once, so a late
mount is pushed the state as it is then. Three deliberately had none, because their payload
is an EVENT rather than a state: `subscribeToolError` (re-pushing the last refusal to a
remounting toast stack would resurrect one the user dismissed), `subscribeStats` (pushed
every rAF, so the longest a subscriber waits is a frame, and a snapshot would be the only
place that payload was assembled off the tick) and `subscribeTool` — "a change the chrome
did not make; a subscriber wanting the current tool has `setTool`'s own funnel". **That
last one stopped being true at foundations T3b2 (§22.8)**: eleven of the thirteen carry a
snapshot today, and the two that do not are the toast and the stats.

`subscribeStats`' channel, its payload and its log-signature cache live in
`field-host/field-stats.ts` since foundations T3b1 (2026-08-06), not in the host; the
facade member is unchanged. The frame now ASKS the meter (`stats.publishIfWatched()`) rather
than assembling the readout inside `tick`, and one behaviour moved with it: the payload's
op-cost scan is now INSIDE the "is anyone subscribed" guard, where the host ran it just
outside. An unwatched host therefore no longer runs an O(ops) log scan per rAF — every
headless test that drives the loop *without subscribing* is such a host (four editor suites
do subscribe).

**What that costs is narrower than it first sounds, and the narrowing is the argument.** The
cache signs on the log's three lengths, and nothing re-signs on a MATCH — the trackers advance
only inside the recompute branch, which is both why skipping calls is safe and why an alias,
once entered, is carried by every later payload until a length genuinely differs. That
duration is identical to the shape it replaces: a recompute on a matched signature was a no-op
on every tick too. **What moved is the PROBABILITY of entering the stale state — the netting
sequence had to land within one frame, and now has the whole unwatched span — not how long it
lasts.** And the blast radius is two fields: `totalOps`, `undoDepth` and `redoDepth` ARE the
three signature lengths (core's `field/maintenance.ts`), so a matched signature makes them
correct by construction, leaving only `liveGenerators` and `compactableOps` exposed; the other
six payload fields never touch the cache. In production the span is still effectively empty of
editing, but **the reason changed later in the same slice and the first statement of it is
dead**: Task 3 argued from a provider-level effect keyed `[engineReady, host]`, and Task 7's
collapse (§21.3) deleted that effect. Stats are now latched per consumer, and three surfaces
read them — `shell/StatusBar.tsx`, `hooks/useActionContext.tsx` and `hooks/useWorld.tsx`. The
last two are session-lifetime providers mounted at the shell root (`shell/Shell.tsx`), so an
unwatched production host still exists only before `engineReady` and after chrome teardown.
That is now an EMERGENT property of two unrelated providers happening to read `stats`, not a
designed one: if either stops reading them, the unwatched span becomes a real editing window.
Published payloads are unchanged outside it.

**Three things are observable, and only three.** Everything else about the seams is
byte-identical from the chrome's side.

1. **Slot-steal is dead.** A second subscriber no longer disconnects the first. This is the
   hazard §16.7's ONE-subscription-point rule was written against; the rule survives it on
   other merits, but it no longer holds itself up.
2. **A throwing subscriber no longer severs its siblings.** Delivery is isolated
   per-subscriber: an exception is `console.error`ed and the pass continues, and `publish`
   itself never throws. This is safe precisely because notifications go LAST — host state is
   already committed when they fire (the field-host ordering rule), so isolation cannot leave
   the host half-written. It converts a sibling-severing throw into a log line. Subscriber
   exceptions are programmer errors, not user-facing refusals: `subscribeToolError` is the
   seam for those, and a surface's bug must not silence the surface behind it.
3. **A callback that throws on its INITIAL push now gets a working unsubscribe** — the
   corollary of (2), and the easiest of the three to miss. Under a single slot that throw
   propagated out of `subscribe`, which therefore never returned; the caller had a live
   registration it could not remove. It is logged now and the unsubscribe comes back.

Two implementation rules are load-bearing enough to state. **`publish` iterates a COPY of
the membership**: a subscriber is free to (un)subscribe from inside its own delivery — a
React commit provoked by one push can tear down the surface holding another — and a live Set
mutated mid-iteration would let one subscriber's bookkeeping decide whether its siblings
hear this pass. Someone removed mid-pass is still delivered to; someone added mid-pass waits
for the next one. And **`snapshot()` runs OUTSIDE the per-subscriber try/catch**: reading the
host's own state is not the subscriber's code, so a snapshot provider that throws is a host
bug that must surface at the mount that provoked it rather than be papered over with a
subscriber that silently never got its first push.

**A pushed value is cloned once per publish and SHARED by every subscriber.** It is
immutable by contract — the seams pushed clones before, and with N readers a mutation by one
would now be visible to the others.

`size()` is the leak-detection seam, and it exists because the failure mode inverted: the
single-slot era failed LOUDLY when a subscription leaked (the second subscriber displaced
the first and something visibly stopped updating), whereas a Set just grows. A count that
only climbs across mount/unmount cycles is a missing cleanup.

**`subscribeHistory` WAS the one seam that is not a bare delegate**, and the reason is worth
keeping even though the seam no longer shows it. Its body used to CLEAR the shared echo
signature (`historySig`) to force an unconditional push to its one subscriber; it then
RECORDED it (`historySig = historySignature()`) and let the channel's snapshot do the
arriving subscriber's initial push. Clearing was correct for one subscriber and wrong for N —
it would re-broadcast the current history to everybody on the next notify that moved nothing.
Recording says something true of every live subscriber instead: the arrival was just handed
this history, and the ones already here were pushed it when it landed. It is written BEFORE
the subscribe so a callback that reads the host back synchronously cannot provoke a duplicate
of its own first push. The `notify` verb still asks "is anybody listening" first, as
`historyChannel.size() === 0`, and still leaves the signature alone when the answer is no.

**Since foundations T3b1 (2026-08-06) all thirteen seams are bare delegates**, because that
whole body moved into `field-host/field-history-feed.ts` — the channel, the signature and
both verbs — and `FieldHost.subscribeHistory` now reads `return historyFeed.subscribe(cb)`
with its signature and observable behaviour unchanged. The ordering above is therefore a
property of one function in one file rather than an agreement between the facade and the
state it reaches past; `tests/field-host/field-history-feed.test.ts` pins it, which
nothing did before. The module is deliberately NOT `field-history.ts` — that file is the pure
label-derivation module and its header rules state out.

### 20.2 The input router — Esc becomes a capture stack

`field-host/input-router.ts` replaces the five-rung `escapeLadder()` with a stack of
captures. **A gesture or a selection ACQUIRES a capture when its state goes live and
RELEASES it in the same canonical setter that clears the state**, so membership IS liveness:
the stack cannot hold an entry for a state that is gone, and Esc cannot miss one that is
standing. Esc cancels the TOP and returns whether it acted — the claimed-event contract the
canvas branch reads to decide whether to `stopPropagation`, and the reason a press with
nothing captured still travels on to the app-level registry.

That is the whole law, and it is why **every mutation of a captured state must go through
its setter**: a bare assignment that skips the reconcile leaves a capture behind, and the
next Esc spends itself cancelling something that already ended. A shared `escRung` helper
owns the discipline rather than five copies of it *(as of foundations T3c it is exported as
**`createRung`** from `input-router.ts` rather than being a closure inside `createFieldHost`,
and **seven** rungs across three modules stand on it — §23.2)* — acquire on the first live read, release
on the first dead one, and do NOTHING while it stays live, which is what makes a REPLACE (a
selection displacing another, an entity pick displacing another) keep the position its first
acquisition took. `cancel` runs AFTER the entry is removed, so a cancel that re-acquires (an
arm whose drawn corner is cancelled goes back to asking for a region) pushes a fresh entry at
the top rather than resurrecting the one the press just spent.

**Three paths write a captured slot without going through its setter, and each reconciles in
the same breath** rather than being rewritten to use one — the write is deliberate in all
three:

- `resetWorld`'s `selection = null` (a `setSelection(null)` would PARK the outgoing selection
  in the Reselect slot, and a Reselect across a world swap restores cells describing a field
  that is gone),
- `reselect()`'s manual swap, for the same reason from the other side,
- the `stamp` / `moveDrag` pair, which share **one** capture whose liveness is
  `stamp !== null || moveDrag !== null`. It reconciles at the seven writes that CROSS
  null↔non-null (two opens, three closes, `endMove`'s clear and `beginMoveSession`'s arm) and
  deliberately not at the transform writes that keep a live session live — a reconcile there
  would be a no-op with a cost, and worse, it would imply that a slider drag re-acquires and
  moves the session's stack position every time a param changed.

  > **SUPERSEDED for `stamp` at foundations T3c (§23.2).** Only the `moveDrag` half is still
  > a deliberate bare write. `stamp` acquired a canonical setter — **`setStamp`** in
  > `field-machine.ts`, through which all 13 of its write sites now go — and the
  > crossing/transform distinction the paragraph above describes as a hand-maintained list is
  > now computed (`crossed = (stamp === null) !== (next === null)`). The distinction itself is
  > unchanged and correct; what changed is that the structure asserts it instead of a comment.
  > T3c also gave the sub-threshold move press a rung of its own (`setPendingMove`) — a state
  > that had been invisible to this stack, so Esc fell past it.

**The behaviour change: recency replaces a declared priority.** The old ladder's order was
fixed, but every rung's own comment argued from recency ("an arm is by definition more recent
than any session still standing beside it"), and the fixed order held only because the common
flows happen to acquire in that order. Making it structural costs the cases where the two
disagree, and there are exactly **three reachable ones** — two independent states that can be
acquired in either order:

| Both live | Old ladder cancelled | The stack cancels |
| --- | --- | --- |
| an entity picked, THEN a cell selection drawn | the entity | the selection |
| a session live, THEN a cell selection drawn | the session | the selection |
| a session live, THEN an entity picked | the session | the entity |

The common flow is unchanged: draw a region, then pick something in it, and Esc still takes
the pick first — in that order recency and the ladder agree. In all three rows above the
stack is the one obeying the ladder's own stated principle. All three rows are pinned by
`tests/field-host-escape.gpu.test.ts` (the "recency, not a fixed order" pin plus the two
"divergence row" cases beside it — accepted at the T3a merge review, 2026-08-06), which is
the equivalence record for the swap as a whole: the router's unit tests pin the stack, that
suite pins that the HOST still wires every state to it, with the scenarios the old rung
comments argued from.

**The segment brush is the pilot** and owns its own anchor capture — the router is passed
into `SegmentDeps` whole rather than the host reconciling on the extracted module's behalf,
which is the shape every later extraction will take. **What the router does NOT take yet**:
the nine DOM listeners and pointer capture stay in the host. T3c's gesture machine takes
them, and finishes the same bug class for pointer capture that this finishes for Esc.

> **That last sentence was half wrong, and T3c is what disconfirmed it (§23.3).** The nine
> DOM listeners are ALL still in the host, and so is DOM pointer capture — it became one thunk
> pair (`capturePointer` / `releasePointer`) called from four sites. What the machine took is
> the pointer chains' ARBITRATION, not the element handling; a module with no canvas cannot
> own `setPointerCapture`, and the keyboard three are the momentary pins' only test route.
> The Esc bug class this section closes was, however, finished for the one state that had
> escaped it — `input-router.ts`'s header was corrected in the same tranche to say that its
> "capture" means THIS stack's, not the DOM's, because the two words had been sitting one
> file apart meaning different things.

### 20.3 The substrate record

`field-host/substrate.ts` declares `HostSubstrate`, the record an extracted cluster is
handed, plus `createHostSubstrate` — an identity function whose entire value is being a
single named place where the host states the split and the compiler checks it. Declared at
T3a with no consumer on purpose, and **constructed in `createFieldHost` since T3b1
(2026-08-06)**, when the void-cast extraction became the first thing to hand it to
(`field-host/field-voidcast.ts`). **FIVE consumers stand today**, all from T3b1, and the
record's whole claim is that the four after the first paid nothing to join:
`field-host/field-props.ts` is the second and needed no new member (`log`, `propMeshes`,
`ctx()` and `archetypeById()` were already declared); `field-host/field-stats.ts` is the
third, reading `store` and `log` off the value side, and the first consumer to leave NOTHING
behind in the record, because no other cluster ever read its state directly;
`field-host/field-history-feed.ts` is the fourth and takes the record's smallest surface —
`log` alone, and no private thunk beside it; `field-host/field-view.ts` is the fifth and
reads `store` and `dirty`. **Not one of the four added a member.**

**A single-consumer dependency does NOT earn a member.** Two of the five carry one: the void
cast takes `voidCastMaterial()` and the prop layer takes `kitMat()`, each a host `let`
reached through a function on the module's own deps record rather than through the substrate.
`field-stats.ts` carries two more of the same kind (`lastRemeshMs()`, `remeshVersion()`), and
`field-history-feed.ts` carries none at all — and neither does `field-view.ts`, whose two
deps are VERBS on another extracted module (`voidcast`'s `discard`/`request`) rather than
host state of any kind. The bar is TWO extracted readers, because
widening the record for one consumer charges every future cluster's assembly for that
consumer's convenience — and the thing that keeps a `let` honest is the CALL, not whose
record it sits on.

**And a third answer exists, which `field-view.ts` is the first instance of: the state
MOVES IN.** Its two `let`s (`layers`, `sliceY`) had five reader clusters between them — on a
reader-count reading of the bar, the two most obvious substrate members in the closure — and
neither was added. They left the closure entirely, and the 25 sites that used to read the
shared bindings now call the owning module's getters. So the record is not "where reassignable
state goes"; it is where state the HOST still owns and shares goes. State that acquires an
OWNER rides on that owner's seam instead, which is why those sites spell `viewState.layers()`
and not `substrate.layers()`. Same CALL either way — the law is unchanged — but the question
"who owns this" now has three answers, not two, and the substrate is only the middle one.

**That bar governs ADDING a member, never declining one already declared**, and the
distinction is load-bearing rather than pedantic. `archetypeById()` also has exactly one
extracted reader today (`field-props.ts`) and stays in the record, because T3a declared it
ahead of any consumer and reading a declared member costs nothing new. Only `ctx()` has two.
Read the bar as "one reader ⇒ private dep" and the next extraction pulls `archetypeById` back
out of the substrate for no gain and one more bespoke dep.

The split is not a style preference and it is not about mutability. **Eleven members are held
BY VALUE** because they are `const` in the host — the binding never moves, so every write
lands through the identity already handed out (`chunkMeshes.set`, `propMeshes.length = 0`,
`flagStore.applyFlags`) and a holder sees all of them. **Five are THUNKS** — `table()`,
`archetypeById()`, `ctx()`, `disposed()`, `canvasEl()` — because the host REPLACES those
values rather than writing into them, and a snapshot is a permanent fork that throws nothing:
`setMaterialTable` assigns a whole new `table`, and a module holding the old one goes on
meshing, validating and baking against a perfectly well-formed table describing a project the
user has already changed. `disposed` is the same bug with the volume up — snapshot it and
every `if (disposed) return` guard in an extracted module waves the teardown through. This
generalises `field-segment.ts`'s `SegmentDeps` lesson from one cluster to sixteen members,
at which point it stops being a per-cluster judgement call and becomes a type.

`ChunkRender` and `PropRender` **moved here** from `field-host.ts`, which now type-imports
them, so the dependency arrow points host → substrate and the host and the first extracted
cluster read one declaration rather than two structurally identical ones the compiler could
never tell apart. The record itself is not frozen or copied by the factory, deliberately: the
shared identity IS the contract on the value side.

Two claims in `field-host-clusters.md` §7.1/§7.3 were wrong and this record corrects them —
`table` and `archetypeById` were called `const` and are not.

### 20.4 The two core enablers

Neither has a consumer in this slice. Both are named here because the editor is the reader
that motivated them, and a core addition with no caller is exactly the kind of thing that
gets deleted as dead by someone who does not know what it is for.

- **`logApplyGroup(store, log, ops, table)`** (`@furnace/core/field`) — the plural
  `logApply`. A whole `BrushOp[]` lands as ONE `ops` undo entry, so a gesture that commits
  several ops undoes with a single ⌘Z. Four clauses: every op validates BEFORE the first is
  applied, so a mid-list rejection mutates nothing; ids stamp in list order onto COPIES,
  leaving the caller's records alone, from a LOCAL counter committed only after the apply pass
  (the `commitGenerator` posture, so a throw leaves the log's id space gapless); the inverse
  keeps each chunk's FIRST pre-image, so undo restores pre-group bytes even where ops overlap;
  and an empty list is free — no entry, and the redo stack survives rather than being cleared
  by a phantom step. **It is NOT a transaction**, and says so in its own TSDoc: all-or-nothing
  covers validation only, and an op that validates and then throws out of the applier leaves
  earlier writes in the store with no entry describing them
  (`docs/backlog/engine-architecture/oplog-group-apply-is-not-a-transaction.md`). T3c's
  gesture machine is the caller.
- **`Registry.entries()`** (`@furnace/core/registry`) — `[name, entry]` pairs in registration
  order (Map insertion order), a fresh array per call so mutating it never touches the
  registry. Re-added after T2 removed it as unused; T3b's ToolManager is the ordered
  enumeration pass that was the removal note's stated trigger.

## 21. Foundations T3b1 — five clusters out, one layer down, and the chrome stops fanning out (2026-08-06)

Where T3a built the primitives (§20), T3b1 is the slice that **uses** them. Five clusters
left `createFieldHost`, eight modules found their layer, the chrome's ten contexts became
per-consumer latches, and the directory finally took the name of the thing it hosts. Like
T3a it changes how the editor says things rather than what it can do: **every `FieldHost`
signature is unchanged, and the facade is still 66 members.**

The honest headline first. `field-host.ts` went **7,347 → 7,175 lines (−172, −2.3%)** across
the slice's eight commits, and its CODE column — comments and blanks stripped — went
**3,554 → 3,394 (−160, −4.5%)**. (This documentation pass then added 13 lines to it, all
comment, correcting the seam preamble in §21.3; the file stands at **7,188 / 3,394 code**.)
Five clusters, and the file is still ~8.5× the ~400-line guideline. The five new modules are
**1,262 lines** between them (1,258 as committed; the same docs pass added 7 comment lines to
`field-stats.ts`, and foundations T3b2 then netted 3 off by trimming four seam members
nothing outside their modules ever called — the eight declaration and return lines out, five
lines of comment back in saying why they went — see §21.1's table, which is the T3b1
measurement and NOT head — §21.5 is the live inventory, and the five rows there now read
322 / 254 / 292 / 220 / 225, i.e. 1,313 lines rather than the 1,262 below), which is the real measure of what moved: a cluster's prose travels with it, and the
wiring left behind earns prose of its own.
`docs/reference/field-host-clusters.md` §1 carries the per-cluster breakdown and the one row
that breaks the metric (`view` — the most invasive diff in the tranche, and zero lines off
the code column).

### 21.1 The five modules, and the law their deps records settle

**These figures are T3b1's measurement (2026-08-06) and are deliberately not refreshed** —
this table is the record of what the five settled, not a current inventory. **§21.5 is the
live roster** and is generated from source. All five files have since grown in COMMENT
(322 / 254 / 292 / 220 / 225 at T3d head, 1,313 lines between them against 1,262 here) and
none of them in code; the deps columns below are unchanged and still correct.

| Module | Lines | Beside `substrate`, its deps record takes |
| --- | --- | --- |
| `field-voidcast.ts` | 318 | `reportToolError`, `snapshotAllChunks()`, `chunkOrigin()`, `voidCastMaterial()` |
| `field-props.ts` | 242 | `kitMat()`, `kitInstancedMat()`, `markPlacementsStale()` |
| `field-stats.ts` | 285 | `lastRemeshMs()`, `remeshVersion()`, `voidCastJobGen()`, `analyzerPendingCount()` |
| `field-history-feed.ts` | 203 | — nothing |
| `field-view.ts` | 214 | `discardVoidCast()`, `requestVoidCast()` |

All five take `HostSubstrate` (§20.3) and **not one of them added a member to it** — the
record T3a declared with no consumer took five without widening. `field-voidcast.ts` was the
first call site `createHostSubstrate` ever had.

**The law, as the five of them finally state it, has three clauses and they are usually
collapsed into one by mistake.**

1. **Everything reassignable rides behind a CALL.** Not because it is mutable — eleven
   substrate members are `const` and travel by value precisely because the binding never
   moves. Behind a call because the host REPLACES the value, and a snapshot is a permanent
   fork that throws nothing: a module holding the old `table` goes on meshing against a
   project the user already changed. This is the rule §20.3 generalised from `SegmentDeps`,
   and nothing in T3b1 bent it.
2. **Substrate thunk or private dep turns on whether the member is ALREADY DECLARED**, not
   on how many readers it has. `field-props.ts` reads `archetypeById()` off the substrate
   though it is that member's only extracted reader, because T3a declared it ahead of any
   consumer and reading a declared member costs nothing new. In the same record it takes
   `kitMat()` privately, because that one was not declared and adding it would charge every
   future cluster's assembly for one consumer's convenience.
3. **The two-extracted-readers bar governs ADDING a member, never declining one that
   exists.** Read it the other way — "one reader ⇒ private dep" — and the next extraction
   pulls `archetypeById` back out of the substrate for no gain and one more bespoke dep.

`field-history-feed.ts` is the smallest surface any consumer has taken: `substrate` alone,
no private thunk at all, reading only `log`. `field-view.ts` is the other extreme of the
same idea — its two deps are VERBS on another extracted module (`voidcast`'s
`discard` / `request`) rather than host state of any kind, and its own two `let`s
(`layers`, `sliceY`) left the closure entirely rather than joining the substrate. That is
§20.3's third answer: **state that acquires an OWNER rides on that owner's seam**, which is
why 25 call sites spell `viewState.layers()` and not `substrate.layers()`.

Three of the five are behaviour-visible, and each is recorded where it belongs rather than
here: the stats meter's op-cost scan moving inside the "is anyone subscribed" guard (§20.1,
including the aliasing window it widens and why the blast radius is two payload fields); the
history feed making all thirteen seams bare delegates (§20.1); and `stepHistory` staying
behind in the host when the feed left — a finding, not an omission, recorded in the cluster
map's `history` row.

### 21.2 The layer chain

`frontend/ → field-host/ → shared/`, machine-enforced in both directions. §7 is the
authority on it — what moved, which five modules could not sit in `shared/` because they
value-import core, and why the split was decided by the leakage guard rather than by taste.
Two facts belong here: `src/field-host/` imports **nothing** out of `src/frontend/` at HEAD,
and `src/shared/` imports nothing ABOVE it (it grew its first intra-layer edges in T3b2 —
§22 — which the guard was written to allow). Both are pinned by
`tests/no-chrome-leakage.test.ts`, which closed the React-free half of the `shared/` rule
that had been prose since Task 6. T3b2 added a fourth node beside `field-host/` rather than
a fourth rung under it (§22.5) — §7 carries the current shape.

### 21.3 The chrome collapse — ten contexts become latches

`hooks/useFieldHostState.tsx` (878 → 1,075 lines) stopped being a fan-out. Each `useField*`
hook now subscribes to the seam it reads, **in the component that reads it**, through
`useSeam` — a `useSyncExternalStore` latch. This retires §16.7's ONE-subscription-point
rule, which T3a had already stripped of its enforcement (§20.1's slot-steal hazard).

Two consequences invert what the old arrangement claimed:

- **Cadence isolation is FINER, not coarser.** The eight contexts were split by cadence so a
  fly-around would not re-render the entities palette. A per-consumer latch does that by
  construction and one step further: a surface that does not call the hook does not
  subscribe at all, so an unmounted palette costs nothing.
- **A duplicate subscription is no longer a bug.** Two mirrors of one seam is the normal
  arrangement — the status bar and the action registry both read the tool, and `useWorld`
  holds its own latch on `subscribeStats` beside the status bar's. What still IS a bug is a
  mirror that never releases, and it has **no symptom at all**:
  `tests/chrome/host-seams-and-catalogs.test.tsx` pins the counts, and its claim changed
  shape with the collapse — from "the provider holds all thirteen and no surface holds any"
  to the SPLIT: which three are the shell's, and that the other ten are released with the
  reader that claimed them.

**THE ONE CONTEXT.** `FieldShellContext` carries `{ host, engineReady, chrome }` and changes
twice a session. That stability is load-bearing: every hook reads it, so a value that moved
with the brush radius would re-render the entities palette on every slider frame — precisely
the cost the cadence split existed to avoid.

**The honest deviation: ten of thirteen, not thirteen.** Three seams stay subscribed in the
provider shell, and **six chrome-owned values live in provider-held CELLS** (`createCell`)
rather than in per-consumer state — still latched by the same `useSeam`, so the arrangement
is "shared truth, per-consumer subscription" rather than a context by another name. Five of
the six are FORCED and one is a judgement call, and the distinction matters more than the
round number. **T3b2 Task 6 (§22.8) then retired two of the six and one of the three** —
the tool seam converted, so `tool` and `radius` are a latch and the shell holds two seams,
not three. The two entries below are what that removed, kept because they are the argument
the conversion had to answer:

- **`tool` + `radius`** ride `subscribeTool`, an EVENT channel with **no snapshot**, while
  `TopBar` swaps `ToolStrip` out for a `SessionStrip` for the whole of every stamp session.
  A latch would therefore remount reading `DEFAULT_TOOL` / `DEFAULT_RADIUS` beside a brush
  the viewport is actively drawing, and nothing would ever correct it — an event seam has no
  catch-up push. `tool` is forced twice over: the plain `FieldHost.setTool` publishes
  **nothing at all**, so its three simultaneous readers would diverge permanently the first
  time anyone picked a brush. (Both values do come back on that seam from the host's own
  paths — the eyedrop, the momentary ⇧/⌃, the wheel, `[` / `]`. Being pushed back was never
  the question; being pushed back TO A LATE MOUNT is.) **Both causes are gone as of §22.8.**
- **`gesture`** has no seam in either direction, so there is nothing to reconcile copies
  against.
- **`filters` + `verifying`** must outlive the surface that shows them: `PaletteLayer`
  unmounts a closed palette's body, and per-consumer state would lose the user's bands to a
  debounce its own unmount cancelled, and drop a verify the host is still running.
- **`flags`** is the CHOSEN one. `flagsChannel` carries a snapshot, so a latch would work; it
  is a cell because its push and the `verifying` release are one coupling and one effect.

**The echo guard, stated exactly, because it is easy to describe as symmetric and it was
not.** At T3b1 the host half was a SPECIFICATION plus one value-compare: `subscribeTool`'s
TSDoc told the chrome it "must value-compare against its own state before re-pushing", and
`notifyTool()` itself published **unconditionally** — there was no host-side tool compare,
only the RADIUS's, in `applyRadius`'s `if (clamped === digRadius) return`. §22.8 gave the
tool its twin (`sameTool`), so the asymmetry is gone. The load-bearing half is still the
chrome's: `toolsEqual` (`frontend/lib/field-host-mirrors.ts`), which the tool latch runs
before adopting. It cannot be identity — the host publishes a fresh clone per push, so
identity alone would re-render every reader of the tool on every momentary tap.

**The one cost the collapse ADDED**, named because nothing else in the slice regressed:
`latchEntities` is the only latch whose subscribe callback does WORK rather than adopting a
pushed payload — it calls `host.listEntities()`, which walks the whole op log to attribute
placements. That now runs **once per reader**. Four surfaces call `useFieldEntities` (the
entities palette, the session card, the tool strip, the action registry) and at least two
are mounted at any moment, so a tick can walk the log up to four times where the provider
walked it once. Accepted rather than fixed: the tick is COMMIT-paced — a stamp, a bake, a
⌘Z — not frame- or pointer-paced, and the fix (hoisting the read, or having the host push
the list) is a design change that commit should not have smuggled in. **Revisit if the
entity list gets long or the tick gets chattier.**

### 21.4 The rename

`src/viewport-host/` → `src/field-host/`, `tests/viewport-host/` → `tests/field-host/`. The
directory had carried the deleted scene-editing viewport host's name since long after that
host was gone. §7 records the move; one finding is worth stating on its own, because a
mechanical rename would have silently disabled a guard:

**`field-host` is not a name only this directory wears.** `frontend/lib/field-host-mirrors.ts`
is a chrome-internal, engine-free helper that shares the prefix and nothing else. The
leakage guard's specifier rule therefore needed a **directory-boundary anchor** —
`["'][^"']*field-host(/|["'])`, where the match must end on a `/` or on the end of the
specifier — so that `field-host/…` and `"@furnace/editor/field-host"` are caught and
`field-host-mirrors.ts` is not. Renamed to the old spelling's pattern, the guard would have
matched a legitimate chrome import and been loosened to make the suite pass, which is the
shape the bug would have taken.

### 21.5 The live module inventory

**Owed since T3d Task 1 and written at Task 6.** §21.1's five-row table is the T3b1
measurement and is kept as the record of the law those five settled; this is the CURRENT
roster. Re-derived from the artifact at T3d Task 6 and **again at foundations T4c Task 7**,
which added three rows and moved four (line counts by `wc -l`, deps and seam widths by
counting top-level members of each file's exported `*Deps` and public record types). Rows
unchanged since T3d carry T3d's figures; the four that moved and the three that are new say so
in their Notes.

| Module | Lines | Deps | Seam | Notes |
| --- | ---: | ---: | ---: | --- |
| `field-history-feed.ts` | 396 | 2 | 2 | 220 lines / 1 dep at T3d, where `{ substrate }` alone was the directory's narrowest record — T4b's revision token added `worldEpoch` (§26) and it now ties `field-drift.ts` at 2 |
| `field-drift.ts` | 164 | 2 | 4 | substrate + one module ref |
| `field-materials.ts` | 587 | 2 | 14 | seam ≫ deps: the surplus is inbound READS (§2.8's third mechanism) |
| `field-view.ts` | 233 | 3 | 5 | both non-substrate deps are another module's VERBS |
| `field-capture.ts` | 601 | 3 | 1 | **T4c Task 2.** The narrowest deps record of any module that draws — it borrows `field-render.ts`'s `compose` rather than composing, so the whole scene it photographs arrives as one call |
| `field-props.ts` | 254 | 4 | 3 |  |
| `field-query.ts` | 670 | 4 | 1 | **T4c Task 4.** `field-picking.ts`'s shape with a third of the fan-in: reads the live store and log, answers one parameterized question, writes nothing |
| `field-stats.ts` | 292 | 5 | 3 | two deps changed OWNER at Task 6 without changing shape |
| `field-voidcast.ts` | 322 | 5 | 4 | the first cluster out (T3b1) and the substrate's first consumer |
| `field-targeting.ts` | 366 | 6 | 7 |  |
| `field-analyzer.ts` | 987 | 8 | 18 | seam ≫ functions: 14 inbound MUTATION edges arrive as 5 named verbs |
| `field-mutation.ts` | 422 | 8 | 2 | **T4c Task 3.** The write half of the agent seam; its two verbs are the only mutation path into the field that no pointer drives |
| `field-tool.ts` | 755 | 8 | 15 | **7** of its 8 deps are forward arrows |
| `field-camera-rig.ts` | 654 | 9 | 22 | **no substrate**, a first for an extracted cluster: it asks for a box and a ceiling, not a store |
| `field-segment.ts` | 375 | 9 | 8 | **no substrate** — predates it (2026-08-03) |
| `field-selection.ts` | 754 | 10 | 20 → **21** | 12 private at T3d; T4c Task 4 added `info()`, a synchronous pull beside the channel's push |
| `field-picking.ts` | 361 | 12 | 1 | the inverse shape: 12 deps in, ONE verb out |
| `field-entities.ts` | 791 | 14 | 19 | 9 → 14 deps at Task 6, when the five facade entity verbs arrived |
| `field-world.ts` | 902 | 23 | 18 | the last cluster out; **no forward arrow in the record** |
| `field-render.ts` | 783 | 29 | 1 → **2** | widest record but the narrowest seam — every entry a READ, which is what makes 29 safe (§5.6). T4c Task 2 split `scene` into `compose` + `scene` when `field-capture.ts` became a SECOND caller of the same draw lists; the 29-member record and its zero mutations are unchanged by that |
| `field-machine.ts` | 1970 | 39 | 28 | three clusters in one module (`stamp` + `move` + `gesture`), the only merge in the programme — **the widest record and the widest seam in the directory** |

**Nineteen of the twenty-one take `HostSubstrate`**; the two that do not are `field-segment.ts`
(extracted before the record existed) and `field-camera-rig.ts` (which deliberately asks for
answers rather than state). **All three T4c modules take it**, which is the T3a record
answering a fourth question it was not designed for: the substrate was declared for clusters
being *lifted out* of the closure, and three modules written from scratch for a caller with no
pointer took it unchanged and **widened it by nothing** — the same result the five T3b1
extractions produced, now from the opposite direction.

**The directory holds 46 files and this table names 21 of them.** The other 25, accounted for
so the roster cannot read as the whole directory: `field-host.ts` itself; three seam
primitives that are not clusters (`substrate.ts`, `input-router.ts`, `view-channel.ts`);
`index.ts`; two worker-protocol pairs (`field-protocol.ts`, `field-client.ts`,
`analyzer-protocol.ts`, `analyzer-client.ts`); and **sixteen** PURE modules with no state and
no deps record (`box-edges`, `camera-control`, `field-camera`, `field-flags`, `field-ghost`,
`field-history`, `field-move`, `field-pick`, `field-placements`, `field-selection-cells`,
`field-size`, `field-stamp`, `gizmo`, `input-map`, `reference-grid`, `viewport-cursor`).
*(This read "seventeen" over a list of sixteen, hedged with "plus `field-history.ts`'s sibling
relationship" — but that sibling is `field-history-feed.ts`, which has a row in the table
above and is not a seventeenth pure module. Corrected at T4c Task 7; the hedge is what made a
plain miscount look deliberate.)* The accounting now closes exactly: **1 + 3 + 1 + 4 + 16 = 25**,
and 21 rows + 25 = **46**, the file count. §1 of the cluster map lists the pure set as it stood
at each tranche.

**THE ROSTER HAS A CHECK BEHIND IT SINCE FOUNDATIONS T5, and it does not read this table.**
`packages/editor/tests/field-host-boundaries.test.ts` DERIVES the seam roster at runtime —
a module is a seam if it declares its own `export type|interface *Deps` — because a
hardcoded list is precisely what the twenty-second module escapes. The predicate reproduces
this table exactly: 21 modules here, 21 there, and the floor case reds if the classifier
ever matches nothing (probed — both other cases pass vacuously over an empty set, so the
floor is the only thing that catches a broken predicate). Four cases pin (1) the roster is
non-vacuous, (2) the facade assembles every seam module and nothing else assembles any,
(3) no seam module VALUE-imports a peer, (4) nothing value-imports the facade but the
barrel. The one standing exception is asserted as an exact set rather than hidden —
`field-capture.ts → field-camera-rig.ts { EDITOR_PROJECTION }`, which
`field-host-clusters.md` §5.8 records with its provenance and deliberately does not rule.
That §5.8 is the other half of this: the cluster map's much-quoted "zero remain
cluster-to-cluster" is the MUTATION register, and the IMPORT graph had never been measured
until T5 measured it (six seam→seam edges, five type-only and one value).

**Two rules the column widths make visible, both already stated elsewhere and worth reading
off the table.** (1) **Deps width is fan-IN and seam width is fan-OUT, and neither predicts
the other** — `field-render.ts` is 29/1, `field-picking.ts` is 12/1, `field-camera-rig.ts` is
9/22. (2) **A wide deps record is safe exactly when every entry is a READ** (§5.6): `render`'s
29 are all reads, and `world`'s 23 are the counterexample that proves the rule — seventeen of
them are VERBS this module calls on someone else, and that record is wide *because* the
cluster mutates across twelve edges.

## 22. Foundations T3b2 — one table to state a tool fact (2026-08-06)

Where T3b1 moved code between layers (§21), T3b2 removes **restatement**. Two facts the
editor spelled many times each now have one home apiece, and both moves are subtractive: the
slice's headline artifact is six deleted literal tables, not six new modules.

The two homes answer two different questions, and they sit on different layers.
**`src/shared/action-table.ts`** answers *what a tool IS* — the effect, gesture and family
rows the chrome's six tables used to each restate, on the neutral floor below everything.
**`src/action-registry/`** answers *what a verb IS* — 39 descriptors as plain data, beside
`field-host/` rather than under it, and the layer's fourth node. The registry is the one the
program needs: T4's MCP server runs on the daemon, on Node, and an action table made of
closures over a live React context cannot leave the browser. Splitting each row into its
seven DATA fields and its four closures is what lets the daemon hold one.

Three things follow that are worth reading in order. §22.1–§22.4 are the tool fact: what the
six tables cost, the decision to derive them FULLY (overruling two written objections), the
gate that proved the derivations before anything switched, and the host constants that moved
with them. §22.5–§22.6 are the verb: the registry module, its layer rules and its Node door,
then `ActionResult` and the one dispatch funnel. §22.7–§22.8 are as-built — the six literals
actually deleted, and the tool seam converted so the chrome's last two forced cells could
retire.

Two properties hold across the whole slice. **The `FieldHost` facade is untouched** — 66
members at master and 66 at head, `setTool(tool: FieldTool): void` included, so §22.8's
conversion is a behaviour change behind an unchanged signature and nothing else moved.
(Three of T3b1's cluster seams DID shrink, by four dead members Task 1 trimmed; those are
module-internal and never were facade — §21.1.) And every derivation was **proven equal to
the literal it replaced before the literal was deleted** — the gate in §22.3 is why Task 5
could delete all six literals while touching **no chrome test file at all**, which is the
strongest statement available that the chrome's rendered output did not move.

### 22.1 The six tables, and what they cost

The editor stated each tool **six times**, keyed on **two** discriminators with no join
between them:

| # | table | home | keyed on | states |
|---|-------|------|----------|--------|
| 1 | `POINTER_FAMILY` / `BRUSH_FAMILY` / `SELECT_FAMILY` + `TOOL_FAMILIES` | `frontend/lib/actions.ts` | both | member label, per-member hint, cycle order, arm/cycle actions |
| 2 | `TOOL_OPTIONS` | `frontend/components/shell/tool-params.tsx` | effect | param list + strip capacity |
| 3 | `armedKeymap` | `frontend/components/shell/status-keymap.ts` | both | the status line + its `overCap` tone |
| 4 | `modifierParts` | same file | effect | which momentary/sticky keys are live |
| 5 | `SELECT_MODES` | `frontend/components/shell/ToolStrip.tsx` | gesture | strip name + the bounding note |
| 6 | `STRIP_PARAMS_MIN` | same file | effect | the container-query breakpoint |

Three name **registers** for one thing (`"Box"` the member, `"BOX"` the strip name,
`"Cell select"` the family) and, beside the six tables, free-prose restatements of the tool
MEMBER NAMES — hand-written roll-calls in hints, flyout rationales and overlay glosses,
naming the brush members (`Dig, Fill, Paint or Smooth`) as often as the select triple
(`Box / Wand / Room`), across five source files. Adding an effect meant **five** edits
(`SELECT_MODES` is gesture-keyed and the only one of the six an effect never reaches);
forgetting one meant a control that renders, arms, and then says the wrong thing.

*(The digest enumerated eight such prose sites and missed a ninth, `tool.brushCycle`'s hint
— §22.7 resolves them one by one. The count is recorded here as history and is not the
claim; the claim is greppable at head: `Wand` occurs **once** in `packages/editor/src`, in
`action-table.ts`'s row data, where at master it occurred in three files.)*

**All six are gone as of Task 5** (§22.7). Each home now computes its table from the rows at
module scope, or reads a row register directly, and the literals were deleted in the same
commit.

### 22.2 The FULL-derivation decision, and the two written objections it overrules

Two of the six declared their non-derivation **in writing**. `status-keymap.ts`: *"Enumerated
here rather than derived from the action table, and deliberately so: the registry knows what
a key RUNS, not which four of two dozen bindings matter in a given mode — and the
canvas-owned keys (`[`/`]`, ⇧, ⌃, the arrows) are half of what belongs on this line and are
not in the table at all"* — restated at `ToolRail.tsx`.

Both are overruled (2026-08-06), and the answer to both is one move: **the canvas-owned key
vocabulary goes INTO the table.** The objection was correct about the *action registry* — a
binding table really does not know which four bindings matter in a mode — and wrong only
about whether a *tool* table has to be one. A row states its own status line, so the line
stops being a projection of the bindings and becomes a fact carried beside the label.

`src/shared/action-table.ts` is that source: `EFFECT_ROWS` (4), `GESTURE_ROWS` (5),
`FAMILY_ROWS` (4), and the two transient states that belong to no row. A status line is a
`" · "`-joined list of **two** fragment kinds — constant text, or one runtime value with a
constant lead-in — and there is deliberately no third shape. Five slots name every value no
table can hold (the two session verbs, which stay `SESSION_VERBS`' to own; the armed
generator's name; the live measurement; the one branch on `moving`). The
`session ▸ pendingStamp ▸ gesture ▸ effect` precedence is a table-level constant that
`deriveArmedKeymap` **walks**, so the written order is the order that runs.

### 22.3 The derive-and-diff gate

`tests/shared/action-table.test.ts` derived all six tables from the rows and asserted each
deep-equal to the literal **still standing in its own home** — taken before any consumer
switched, which is what makes it a proof rather than a check on a transcription. It stood across
**three** commits (`c7caa42c` landed it, `3caab726` and `55f6b93c` carried it) and Task 5 deleted
it with the literals. Six derivations, **zero** mismatches on the first run: `deriveArmedKeymap` reproduced
`armedKeymap` string-for-string and tone-for-tone across 36 armed states, including the
strictly-`>` cap boundary and the session-over-a-pending-point case that put the tone in the
same branch as the text. So the FULL-derivation decision's premise held: the canvas-key
vocabulary CAN live as row data.

Two joins the module does NOT make are held by the gate instead, and both are worth naming
because the module reads as if it made them: `deriveSelectModes` is keyed on `CellSelectId`
rather than on the select family's member refs (drop `{gesture:"box"}` and the strip would
still render a mode `M` can no longer reach), and the momentary/sticky split in a
`ModifierClause` is carried by the KEY rather than by a discriminant field — `deriveMomentary`
is a closure inside `createFieldHost` and cannot be asserted against, so only the sticky half
(`tool.swapEffect.enabled`) is groundable, and a `hold` field would have restated what the
key already says.

The type-identity pins outlive the literals, and Task 5 removed one of them by removing what
it guarded. `shared/` sits below both other layers, so the table cannot import a union whose
home is above it — `ViewportGesture` is `field-host/`'s — and it declares its own, with a
**bidirectional assignability pin** in the test making a member added to one side alone a
`bun run typecheck` failure (not a `bun test` one: bun transpiles). `ParamId` was in the same
position and is not any more: Task 5 moved its HOME down to `action-table.ts` and
`tool-params.tsx` re-exports it, so one declaration replaced two and the pin went with the
duplication it stood in for. That fix was available for the params and not for the gestures
because the params are the TABLE's fact — the chrome renders them, it does not decide which
exist. `BrushEffect` needs none of this: it already lives on the floor, which is what the
gesture union should eventually look like, and its pin holds two hops of aliasing rather than
an equality that could fail today.

### 22.4 The three restated host constants

`MAX_SEGMENT_M` (with `DIG_RANGE_M`, which it is twice by construction) and
`SELECTION_UI_BUDGET` moved out of `field-host.ts` into **`src/shared/field-limits.ts`**;
`LATTICE` was already on the floor (`field-brush.ts`) and stays there, because the module
that computes with it owns it. `field-host/` imports all three back — arrow-legal. Six
chrome sites stopped hardcoding them: the rail's Segment hint (`max 60 m`), the grab hint
(`0.5 m steps`), `FLOOD_BUDGET_LABEL` (`budget 200k`), the box gesture's note
(`snaps to 0.5 m`) and the session card's two nudge tooltips. Each had carried a comment
saying it agreed with the host *by review* — the honest name for a fact with no single home,
not a fix.

The bar for `field-limits.ts`: a number belongs there only if it is **both** enforced by the
host **and** stated to a user. A host-private clamp with no affordance stays beside its
enforcement.

**Three more met that bar in Task 5**, found in a file that task had to open anyway:
`RADIUS_MIN`, `RADIUS_MAX` and `HOLLOW_MIN_M` were `tool-params.tsx` literals under a comment
saying they mirrored the host by review. Each is enforced (`clampRadius`; the `hollow` floor
in `clampTool`) and each is stated as a native control's own bound — the range input's
`min`/`max`, the thickness field's `min` — which is the strongest form of stating one, since
a drifted copy would not merely misdescribe the clamp but make the control refuse a value the
host accepts. `HOLLOW_STEP_M` went the other way and was **deleted** rather than moved: it was
`LATTICE` spelled again, and the hollow field now reads the lattice directly. **Nothing pins
the three** — sabotaging each reddens no test in the package (measured) — which is filed at
`docs/backlog/editor-and-tooling/editor-test-harness-fragility.md` §"`RADIUS_MIN` / `RADIUS_MAX` / `HOLLOW_MIN_M` are pinned by nothing".

**Measured, not assumed:** Tailwind v4's automatic source detection **does** scan
`src/shared/`. With `STRIP_PARAMS_MIN`'s four container-query classes present only in
`action-table.ts`, a frontend build still emitted all four `@container strip (width<Nrem)`
rules. This is why the breakpoints are carried as literal class strings rather than as rem
numbers: a templated `@max-[${n}rem]/strip:hidden` is not class-shaped text and would emit
no rule at all.

### 22.5 `src/action-registry/` — the editor's verbs as rows, and the layer's fourth node

`frontend/lib/actions.ts` used to declare 39 actions with 12 fields each. **Five** of those
fields were closures — `label`, `enabled`, `checked`, `run` over a live React context, and
`match` over a `KeyboardEvent` — and they were the whole reason the one action table could
not leave the browser. The other **seven** are data. `src/action-registry/` is those seven,
for all 39; T3b2 Task 3 landed the rows and Task 4 deleted the literals they were derived
from, so `actions.ts` now JOINS its four remaining closures onto these rows by id (`match`
became a `KeyBinding` row and one pure matcher).

The blocker was never the DOM. `actions.ts` was already DOM-free (`KeyboardEvent` appears as
a type only, erased at build) and its only value imports were neutral-floor modules. What was
missing: **one export-map entry** (`packages/editor/package.json` carried exactly one,
`./field-host`, and the daemon bundles from the CONSUMER's root, so it names editor modules
by bare specifier), the five closures, and **nothing machine-enforcing Node-importability**
at all. All three are addressed.

**The layer.** `action-registry/` may value-import `@furnace/core` and `shared/`; it may
import React, the DOM, `field-host/` or `frontend/` not at all. It sat BESIDE `field-host/`
under the chrome through T4b — **and since T4c it sits BENEATH it**, because `field-host/`
now holds the refusal vocabulary (`result.ts`, and nothing else from this directory). The
arrow is one-way and asserted in both directions; §7 carries the full statement. Five rules,
deliberately split across the two guard files **by mechanism rather than by subject**, so
each stays provable the way its file proves things:

| rule | where | how |
|---|---|---|
| no React | `no-chrome-leakage.test.ts` | specifier scan |
| nothing out of `frontend/` | same | specifier scan |
| nothing out of `field-host/` | same | specifier scan (the file's first host rule — nothing else would stop the registry taking a `FieldHost` with it, and since T4c this is the UPWARD half of a one-way arrow rather than a wall between siblings) |
| the chrome may not VALUE-import `schemas.ts` (nor bare `zod`) | `frontend-no-engine-leakage.test.ts` | that file's `valueImportRules`, which already knows `import type` is erased |
| `field-host/` may import `result.ts` from here **and nothing else** (T4c) | `no-chrome-leakage.test.ts` | capturing scan — the answer needed is *which* specifier, not *whether*, so a boolean `bans` rule could not express it. The FILE, not the barrel, so `schemas.ts`'s zod stays unreachable from the host's graph even if the barrel widens |

The fourth is that file's rule because it is that file's *reason*: `schemas.ts` is licensed
to value-import core (an action that takes input carries a zod schema built from core's `z`
re-export — the single-instance contract), so a chrome VALUE-import of **it** would pull zod
and behind it core into the main bundle, the same second instance the other three rules exist
to prevent, arriving by a fourth door. It read "the chrome may reach the DIRECTORY type-only"
until Task 4 narrowed it to the one module that carries zod — see *the schemas get their own
module*, below, for why both halves of the constraint are only satisfiable that way. The
barrel is covered by construction rather than by a second pattern: `index.ts` re-exports the
schema module's TYPES only, so there is no value edge for a chrome import of it to follow.

**The DOM half is not a regex, and could not usefully be one** — `KeyboardEvent` in a type
position is erased, and `window`/`document` are ordinary English words in files this dense
with prose. `tests/action-registry/node-door.test.ts` imports the module in a bare runtime
instead, three times: by relative path, by the `@furnace/editor/action-registry` bare
specifier (the daemon's actual route in, and the failure mode `bundle.test.ts`'s note
describes), and — since Task 4 — by relative path into `schemas.ts`, which the barrel
deliberately does not value-re-export and which is the only module here whose graph reaches
outside the package. All three doors were sabotage-verified — a module-scope `document.title`
fails them, and removing the export-map entry fails the second alone.

**Bindings become data.** Five matcher helpers (`mod`, `chord`, `bare`, `shifted`,
`question`) plus three hand-rolled inline ones (⌫/⌦, ⏎, Esc) collapse into five `KeyBinding`
kinds and one pure `matchBinding(binding, facts)`. *(Counted at head. The planning digest
said "six matcher shapes … plus 4 hand-rolled inline" — it listed five under the six, and
counted `question` again among the four; `match: question` is a bare reference to the helper,
not a fourth inline matcher.)* The facts are
`{ key, mod, shift, alt }` — four, not five: `e.key` IS the produced character for a
printable press and the key's NAME otherwise, which is exactly the distinction the `char` and
`named` kinds draw, so carrying it twice would be two fields to keep equal. The dispatcher
becomes the only place a `KeyboardEvent` is read. **The keycap is derived** (`keycap()`)
rather than stated beside the binding, which closes a gap `keybindings.test.ts` had already
named in writing — *"a cap edited to `⇧/` would leave every case here green while the menu
advertised a key nothing answers"* — and which it had closed for exactly one row.

The union's one real axis is **what each kind does about ⇧**. `chord`/`bare`/`shifted` state
it (that is what makes ⌘Z and ⇧⌘Z two actions); `char` cannot, because the character is what
the layout produced and which modifier produced it is the layout's business; `named` does not
read it — the resolved decision below. `char` and `named` reach the same ⇧-indifferent
predicate and are still separate kinds, because `{ kind: "named", keys: ["?"] }` would read
as a claim that `?` is a key name, which is the thing `char` exists to deny.

**One binding did not map cleanly at T3b2, the SCHEMA bent rather than the behaviour — and
the question it forced is now RESOLVED (user decision, 2026-08-07).** The source carried two
⇧ policies across the three named-key bindings with no comment on either side: ⇧⏎ committed
and ⇧Esc cancelled while ⇧⌫ did nothing (`edit.delete`'s inline matcher pinned
`!e.shiftKey`). T3b2 preserved both behind a **required** `ShiftPolicy` field and filed the
question rather than letting a type shape pick a winner on a destructive keycap. At the
T3b2 merge review the user picked: **accept ⇧ everywhere a key is matched by NAME — ⇧⌫
deletes**, uniform with ⏎/Esc. The field died with the disagreement it preserved (the
declarative-table discipline held: the table forced the question, the user answered it, and
only then did the schema simplify), the backlog entry retired, and the decision is pinned in
keycaps at `tests/action-registry/descriptors.test.ts` ("⇧⌫ deletes") plus the unit half in
`keys.test.ts`. `char` still has no policy field for its own LAYOUT reason: pinning ⇧ up
would kill `?` on a layout that puts it unshifted, and pinning it down would kill it on the
one this editor is developed against — nothing to choose.

**The rows stood beside the literals for exactly one commit**, which is Task 3 landing them and
Task 4 deleting them. (`shared/action-table.ts`'s literals had a longer overlap — see §22.3.) The gate asserted all seven fields (order included)
against the live table, and the 22 binding rows against the 22 live `match` closures over a
**640-press cross-product** (40 keys × all 16 modifier combinations, with meta and ctrl
enumerated separately so "the two sides collapse them the same way" was checked rather than
assumed) — **zero** divergences, **no exception list**, and at most one claimant per press
throughout. Task 4 deleted the literals, so the derive half went with them; what survives in
`tests/action-registry/descriptors.test.ts` is the shape half (keyed ⟺ gated, unique ids,
unique caps, the MCP-projection membership), the two-⇧-policies pin, and the cross-product
reduced to the property that still means something without a second matcher to compare
against — **at most one action claims any press**, plus the canvas keys claiming none. That
file now imports nothing from `frontend/`. `ActionGroup` and `ActionGate` **moved** down
rather than being duplicated and pinned: they are types, so the chrome may type-import them.
Only `ActionGroup` is re-exported from `actions.ts` (its importers keep one import site);
**`ActionGate` deliberately is not** — it has no consumer outside the registry, and a
re-export is one line on the day one appears, which is the surface-membership rule applied
rather than a barrel filled by habit (`actions.ts` says so at its own re-export).
`ACTION_GROUPS` stays in the chrome — a group's title and render order are rendering facts,
and it is a value the chrome value-imports.

**`mcpProjection` is recorded, not built.** Six rows carry it, and they are the whole
membership: the axis views project onto one `view.snap {axis, sign}` MCP tool while the
chrome keeps six literal greppable ids (the WCAG 2.5.8 equivalent affordance of §18.5 —
delete them and the finding re-opens). Both facts, stated once each.

**The schemas get their own module, because the chrome-value-import rule closes every other
route.** Chrome surfaces render `hint`, `keys` and `group` at RUNTIME, which needs a
VALUE import; the rule as Task 3 wrote it barred the chrome from value-importing anything
under `action-registry/`. The plan's escape hatch was to flow that data through
`shared/action-table.ts` — but the same rule is applied to the `shared/` walk, correctly,
since the floor sits BELOW the registry and an upward import is not available at all. Nothing
bit while `descriptors.ts` carried no zod at value level; the moment a row carried
`z.object(...)` it would, and the only remaining options were a chrome value-import of a
schema-bearing module or restating the labels in `shared/` (the duplication this slice exists
to remove). **As built (Task 4): `descriptors.ts` — with `keys.ts`, `result.ts` and the
barrel — is plain, zod-free, chrome-value-importable data, and the six input schemas live in
`action-registry/schemas.ts` as an id-keyed map, with the chrome value-import rule narrowed to
THAT module plus bare `zod`.** `ActionDescriptor` has no `input` field at all: the schema is
looked up by the same id (`ACTION_INPUT_SCHEMAS["tool.stamp"]`), so there is one home for it
rather than a field that could only ever be populated elsewhere.

**Narrowing the chrome's ban moved the containment; it did not delete it, and that took a
second rule plus a third check.** The directory-wide ban made "no zod, no core, in the chrome
bundle" structurally impossible to break — the chrome could not value-import ANY of it, so
which registry file carried an engine import did not matter. Narrowed, it does: a value
`import { z } from "@furnace/core/registry"` in `descriptors.ts`, `keys.ts`, `result.ts` or
the barrel would ride a legitimate chrome value-import into the main bundle, and
`no-chrome-leakage.test.ts` scans this directory for React, `frontend/` and `field-host/`
only. So `frontend-no-engine-leakage.test.ts` now runs its ENGINE and ZOD rules over
`src/action-registry/` too, with `schemas.ts` the one exempt file. Three sabotages hold it: a
value core import in `descriptors.ts` reddens, the same import in the barrel reddens, and the
identical import in `schemas.ts` stays green.

**One check in that file is not a proxy.** Every rule above is a specifier scan, and that file
says in its own words that it deliberately does not chase `await import(…)`. So it also
BUILDS `frontend/lib/actions.ts` for the browser — the chrome module that value-imports the
registry, and therefore the door the narrowing opened — and asserts zod's runtime class names
are absent from the output (with a positive marker so an empty build cannot pass). One
esbuild of one module, milliseconds — deliberately recorded with no figure, since a KB/ms
pair nothing reads rots every commit (the original pair, "28 KB and ~16 ms", was already
wrong on both halves within the slice). Sabotage-verified with a DYNAMIC import of
`schemas.ts` planted in `descriptors.ts`: invisible to every regex in the file, caught here.

**Six schemas, not twelve — the axis views take their input from their own ids.** The
measured worklist counts twelve actions as needing input; six of those are the axis views,
and they carry no schema. Their axis and sign ARE the id, so a `{axis, sign}` schema on
`view.snapNegZ` would let a caller hand it `x` and make the id a lie. What they carry instead
is `mcpProjection`. The six that do take one are `world.saveAs` and `world.makeDefault`
(`{name}`), `edit.duplicate` / `edit.delete` / `edit.grab` (`{entityId}`) and `tool.stamp`
(`{generatorId}`), and the two sets are asserted disjoint.

**Every field inside an input is REQUIRED and the whole input is optional**, which is the
chrome/agent split expressed once: `InputOf<Id>` admits `undefined`, so a chrome surface
dispatches a verb with nothing and each run falls back to what the ctx has selected, while a
caller that names a verb must name its object too. One asymmetry is worth knowing: `edit.
delete` REFUSES an `entityId` that is not the selected one, because its confirm names the
generator and counts the ops and both come off `ctx.selectedEntity` — the only entity the
chrome can describe. Duplicate and Grab need the id alone and take any.

### 22.6 The action's own verdict — `ActionResult`, and the one dispatch funnel

Before T3b2 Task 4 every `run` was `(ctx) => void`: **zero** actions were async, **zero**
produced a result anything read, and failure had three shapes, none of them the action's —
the host's `reportToolError` channel (41 call sites across `field-host/`, 33 of them in
`field-host.ts` — the planning digest said 46 and 38, and **the gap is the counting rule, not
a move**: at `294c34df`, the commit the digest states it measured, `grep reportToolError`
gives 46/38 and `grep 'reportToolError('` gives 41/33, and those files are byte-identical at
head. The five extra are one interface declaration, two dep-object passes and two prose
mentions. *Corrected 2026-08-07: this passage previously said the five "left with T3b1's
cluster extractions", which is wrong — the digest was measured AFTER T3b1, so nothing could
have. The claim survived because `field-host.ts` really did hold 38 CALL sites before T3b1's
void-cast extraction and 33 after, which makes the wrong explanation reproduce the right
number by coincidence.*), a `notify.error` from
inside a chrome seam, or silence. `run: (ctx, input) => Promise<ActionResult>` is a NEW
channel for all 39.

```ts
export type RefusalClass =
  | "modal" | "typing" | "looking" | "menuOnly" | "session" | "inert" | "member";

export type ActionResult =
  | { ok: true }
  | { ok: false; kind: "refused"; message: string; because: RefusalClass }
  | { ok: false; kind: "failed"; message: string };
```

**Three provenances, never a doubled toast.** This is the reconciliation the
type's own module header carries, and it is why there are two non-ok kinds rather than one.
(The heading above says *the one dispatch funnel* because that is what T3b2 built; since T4a
it is a PAIR sharing one sequence — clause 3 below, and the section number stays as seals and
backlog entries cite it.)

1. **The host's** — `reportToolError` → `subscribeToolError` → a toast. Not actions, and they
   did not move. A verb that hands off to the host returns `{ ok: true }` on the hand-off —
   most of the table, and the membership is greppable (`run: handOff(` in `BEHAVIORS`) rather
   than counted here, for the reason that function's own note gives; the host answers for
   itself, later, on its own channel.
2. **The world seam's** — `frontend/lib/world-actions.ts` composes and says its own save and
   load sentences ("bake failed: ENOSPC"). Same shape as the host's, one layer up.
3. **The action's** — the Result. `runAction` in `frontend/lib/actions.ts` is the one funnel
   every surface dispatches a NAMED ACTION through, and it says a Result out loud exactly
   once. Since foundations T4a it has a sibling, `runMember(family, memberId, ctx)` (an ID
   since T4b, so the funnel resolves the member against the family it was handed rather than
   taking the caller's word that the pair belongs together), for picking
   a member out of a tool family — gated against the family's own arm action through the same
   sequence (`refuseOrClaim`, shared by both funnels), voiced the same way, answering the same
   `ActionResult`, and synchronous because every member arm is. It is a second way into an
   existing row, not a fourth provenance, which is why it needs no descriptor row of its own;
   `member.arm` is the effect and has exactly one caller (pinned by a source scan in
   `tests/actions.test.ts`). It read `controlVerdict` for exactly one commit (T4a Task 1),
   which was the same behaviour and the wrong seam — that three-way is the DISPLAY projection
   and collapses a silently-refused gate onto the inert case's `reason: null`, so a pick
   refused by a modal answered with the family's LABEL. T4a Task 2 moved both funnels onto the
   shared sequence instead.

`refused` is a verdict the action itself reached that nobody has said yet, so the funnel says
it with `notify.error` — the same call, in one place, that used to sit inside the verb.
`failed` is an error a layer below already surfaced on its own channel, so the funnel stays
quiet and the Result carries it to a caller who is not looking at the screen. Both halves are
pinned in `tests/actions.test.ts`, and the sabotage that proves it: make `sayResult` speak
`failed` too and the no-double-toast case reddens.

**Two sentences moved into the funnel, and two were newly created.** The MOVED pair is
`write`'s invalid-name error and `bake`'s untitled backstop — same wording, same
`notify.error` severity, now said in one place. The NEW pair is `write`'s own guard, which was
one silent `if (!host || inFlight.current) return;` and is now two refusals a caller can read:
*"the engine is not up yet"* and *"a world write is already running"*. Both are reachable and
both are pinned, and neither is the path it looks like. **No host** is not a pre-engine ⌘S —
`save`/`bake` reach `write` only with `name !== null`, `name` is set only inside `write`/`open`
which both already had a host, and `App.tsx` assigns the host once and never nulls it; the way
in is `saveAs`, which takes its name from the drawer's FORM and has no such precondition, on a
shell `App.tsx` renders unconditionally (⌘S → type a name → Save, before the bundle lands).
**In flight** is the window `inFlight` exists for and its own docblock names: `job` is React
state that every control reads, a held ⌘S repeats faster than a commit, and the synchronous
ref covers the gap. `WorldActions.save` / `saveAs` / `bake`
therefore return `Promise<ActionResult>` — they were `void` returns over `void write(...)`,
which made a rejection out of the upload an unhandled promise rejection — and the other eight
world verbs still return `void`, because no action dispatches into them and each already
reports through `runVerb`'s toast. `world.makeDefault` is **not** one of the awaiting three
the planning digest named: it opens a MODAL and returns, the promise lives two hops down
inside the confirm's `onConfirm`, and awaiting a human decision would leak the promise on
every cancel. Its verdict answers for the dispatch — the confirm was raised.

**The digest's async column was wrong in both directions**, which is worth stating because
the two errors cancel in the total and would otherwise look like agreement: it marked
`save`, `bake` and `world.makeDefault`, so it named `makeDefault` (which does not await) and
MISSED `saveAs` (which does — it returns the seam's promise whenever an input carries the
name, and only opens the drawer when it does not). Three either way, a different three.

**`runAction(def, ctx, env, input?, onClaim?)`** is gate → claim → `enabled` → run → say.
`onClaim` fires the instant the gate ALLOWS and before `enabled` is consulted, because at
that point the key has been claimed: a disabled ⌘S must still suppress the browser's
save-page dialog. It is `useGlobalKeybindings`' `preventDefault` seam and nothing else passes
one. The INERT case (`enabled` false, gate open) returns a refusal carrying the action's
LABEL and says nothing — the existing three-way policy made answerable, since those labels
already state the reason on screen ("Bake — name the world first (⌘S)") while a caller who
cannot see the screen gets that same sentence as the message.

**The third caller class the gate's env was never written for (S12).** `clickGate` used to
branch around `gateAction` for menu-only actions and hard-code `inTextInput: false` on the
argument *"the user typed to find it and then named it"* — true of a palette row, untrue of
an agent. `GateEnv` is now a UNION discriminated by `caller`:

| | `key` | `named` (menu / palette / rail / agent) |
|---|---|---|
| modal confirm open | refuses | refuses |
| `armsTool` during a session | refuses, with the hint | refuses, with the same hint |
| no `gate` (menu-only) | refuses | **runs** — the rule is about keycaps, and a control has none |
| `typed` gate + `inTextInput` | refuses | not asked |
| `flyLetter` + right button held | refuses | not asked |

The three key clauses live inside the `key` branch, so the two key-only facts are simply not
askable of a named call — there is no `false` left to write down and nobody has to justify
one. That is the whole fix: the hard-code became unwriteable rather than relocated.

**The named class has TWO envs since T4a Task 2, differing on exactly one clause**, and the
table above is the DISPATCH one. Until then there was a single module constant `NAMED_CALL`
hard-coding `confirmOpen: false`, defended by *"a chrome control activation cannot arrive
while a modal covers the surface it sits on"* — a fact about RENDERING a control, being used
to answer a question about DISPATCHING a verb, which is the same caller-specific story the S12
split had just made unwriteable, re-entered one field along.

| | `namedDispatch(ctx)` | `NAMED_RENDER` |
|---|---|---|
| asks | may this verb RUN, now? | how does this control LOOK, now? |
| callers | `runNamed`, `runMember` | `clickGate` → `controlVerdict` (its only `src/` caller) |
| `confirmOpen` | `ctx.isConfirmOpen()` | `false`, by decision |

`isConfirmOpen` is a CALL on the ctx, not a boolean field, for `host.isLooking()`'s reason
exactly: a modal goes up and down between renders, so a snapshot would answer for a frame that
has gone. The chrome supplies it from the one `confirmRef` the key dispatcher already reads
(`useActionContext`); the key dispatcher keeps stating `confirmOpen` from that ref directly, so
the fact still lives in exactly one place.

**The display path stays modal-blind on purpose**, and three things make that the right
asymmetry. (1) A modal is an ENFORCEMENT fact, not a display one: `ConfirmDialog` is a Radix
dialog at its `modal: true` default, so while one stands the dismissable layer sets
`body { pointer-events: none }` and every chrome control is behind an overlay nobody can
click — dimming them all would say nothing a user could act on. (2) It keeps `controlVerdict`
a pure function of memoizable ctx facts: `ToolRail` derives it inside a `useMemo` keyed on ctx
fields, and a verdict that polled `isConfirmOpen()` could survive the modal's close and leave
the rail visibly dimmed with nothing on screen explaining why. (3) It makes "display behaviour
did not move" a property rather than a coincidence — pre-T4a the display path was modal-blind
by construction, and routing the computed truth through it would have preserved that only for
as long as the memo happened not to re-run. The consequence is that a control can render
runnable while a dispatch of the same verb at the same instant refuses; that is invisible to a
human (the overlay) and correct for an agent (which is on the dispatch side), and it is pinned
by name in `tests/actions.test.ts`. **Enforcement lives in the funnels; `clickGate` is not one
and never was.**

**Every refusal now carries a machine-readable reason.** `GateVerdict`'s refusal arm is
`{ hint: string; spoken: boolean; because: RefusalClass }` where it was `{ hint: string | null }`
— one absence had been doing two jobs, "say nothing" and "there is nothing to say", and the
second was never true. The four silent classes (modal open, user typing, right button held,
menu-only backstop) state their sentences; `spoken` is the display policy and only `armsTool`
sets it. Nothing a human sees moved: `controlVerdict` projects `spoken` back onto the
`string | null` its display callers read, and the silent classes stay toast-silent. What the
change removes is `runAction`'s `refused(verdict.hint ?? def.label(ctx))` — the fallback that
made an agent's "a modal is open" refusal read `"Frame selection"`. The label survives as a
reason in exactly one place, the INERT case, where it is the honest one.

**And since T4b, WHICH KIND of refusal it was.** `because` is the third field, required on
every `refused` result and on the gate verdict that produces most of them: the `message` is
prose written for a toast and is free to be reworded, so the CLASS is the half a caller may
branch on. Seven names — `modal`, `typing`, `looking`, `menuOnly`, `session` are the gate's;
`inert` and `member` are raised past it. `inert` is the widest: it is `refuseOrClaim`'s own
verdict when the gate is OPEN and `enabled` is false (the canonical instance — the sentence
there was the LABEL until T5 and is the row's `inertHint` now), and it is also what a verb's own body answers when it
finds nothing to act on — no world name, no selected stamp, no engine, no generators. `member`
is the one class about the REQUEST rather than the state: the member funnel takes an ID and
resolves it against the family BEFORE gating, so an id nothing answers to is refused as a
malformed ask rather than as a bad moment. Nothing a human sees moved here either — `spoken`
is untouched, `controlVerdict` does not read `because`, and every existing sentence is
byte-identical. The vocabulary is pinned as a `Record<RefusalClass, …>` in
`tests/actions.test.ts`, so a class with no route that produces it does not compile. That absence
is now filled: the `input` class landed at **T4c Task 3** with its first caller, and the two
`inert` refusals that were really about an argument moved onto it (`write`'s invalid world
name, `edit.delete`'s non-selected `entityId`). Eight arms, five of them the gate's. See
§27.1.

**Where the input typing does and does not reach.** The DECLARATION site is checked — the
behavior table is keyed by `ActionId` and each row's `run` states its own `InputOf<Id>`, so
`edit.duplicate` reading a `generatorId` does not compile. The DISPATCH site is not:
`runAction` types `input` as the widened union, so handing an action another action's input
compiles and degrades to the ctx fallback. A generic was tried and does not close it — `byId`
answers `ActionDef` with `id: string`, so the id cannot be inferred at any call site the chrome
writes, and recovering it means making `ActionDef` generic everywhere it is held. Not bought:
no chrome caller passes an input at all, and T4's agent surface is what will have a reason.

**A throw out of ANY of the 39 runs is now surfaced rather than thrown past the dispatcher**
— the second user-visible change this task shipped, and the whole of what `failed` means.
Before the funnel a run that threw took its listener with it: a sync throw out of the keydown
handler, and an unhandled rejection once the world verbs became async. `runAction` catches it,
returns `failed`, and — uniquely among `failed` results — SAYS it, because this is the one no
layer below has voiced. The funnel says what the funnel owns.

**`ActionId` earned its first consumer.** `ACTION_DESCRIPTORS` is declared `as const
satisfies` and exported widened, which is two statements about one array: the literal tuple
gives `ActionId` (a union of the 39 ids), the widened export keeps `d.hint` readable without
narrowing. The chrome's behavior table is `{ readonly [Id in ActionId]: ActionBehavior<Id> }`
— so a descriptor with no behavior and a behavior with no descriptor are both COMPILE errors,
where the join they replace was a runtime `find` that threw at module init. `byId` narrowed to
`ActionId` in the same change. `shared/action-table.ts`'s `ToolActionId` still cannot use the
union (the floor sits below the registry) and still resolves by throwing.

**The keycap is derived for every surface that prints an ACTION's cap.** `ActionDef.keys` is the
`KeyBinding`, and `capOf(def)` (a thin read of the registry's `keycap()`) is what those surfaces
call. What that replaces is a `keys: "⇧⌘S"` string on every row, declared beside a matcher it had
to agree with by review — the gap `keybindings.test.ts` had already named in writing and closed
for exactly one row.

**One surface prints keycaps and does NOT go through `capOf`, and it is not an oversight**: the
status bar's keymap line, whose clauses spell their own keys as row text (`⌫ delete`,
`R rotate ¼`, `Esc clears`, the `⏎ ` lead-in). Ten of that line's 27 distinct clauses lead with a
cap `keycap()` also derives. It is a real duplication, measured and adjudicated rather than
assumed, and it is open because `keycap()` lives ABOVE the floor those rows sit on — closing it
would reverse the import arrow. §22.7 and
`docs/backlog/editor-and-tooling/chrome-shape-follow-ons.md` §"The status line spells ten keycaps the action registry already derives".

### 22.7 As built — the six become derivations (Task 5)

Each of §22.1's six homes now COMPUTES its table from the rows, at module scope, and the
literal is deleted:

| was | is now |
|---|---|
| `TOOL_OPTIONS` literal, `tool-params.tsx` | `deriveToolOptions()` |
| `STRIP_PARAMS_MIN` literal, `ToolStrip.tsx` | `deriveStripParamsMin()` |
| `SELECT_MODES` + `FLOOD_BUDGET_LABEL`, `ToolStrip.tsx` | `deriveSelectModes()` |
| `POINTER_FAMILY` / `BRUSH_FAMILY` / `SELECT_FAMILY` + the `TOOL_FAMILIES` literal, `actions.ts` | `deriveFamilies()`, joined with three closures |
| `armedKeymap`'s branch cascade + `segmentLine`, `status-keymap.ts` | `deriveArmedKeymap()` |
| `modifierParts`, same file | `deriveModifierParts()` |

**`status-keymap.ts` is an ADAPTER now and nothing else.** What is left in it is the one thing
the floor cannot do: reach the host's `StampSession` / `PendingStamp` / `SegmentHud` and
flatten them into the plain `KeymapInput` a module below `field-host/` may take, resolving the
two session verbs through `SESSION_VERBS[sessionStateTag(...)]` on the way. `Keymap` is the
table's own `StatusLine`, re-exported rather than declared a second time.

**The family model became a join keyed on the RULE FIELDS, not on the family id.** `actions.ts`
maps `deriveFamilies()` and adds the three things a row cannot hold — `label`, `members`,
`armed` — with each implemented ONCE per rule rather than once per column: `labelRule` picks
`"arm"` (the action's own label) or `"running"` (pendingStamp ▸ session ▸ arm-label), and
`memberSource` picks `"rows"` (the table's members, `armed` from `armedIndex`) or
`"generators"` (the host's registry, `armed` = the staged grammar is running). The third
follows the second because that field is what the two answers actually differ by: a `"rows"`
column is armed when one of its own refs matches what LMB is on, and a `"generators"` column
has no ref to match.

**`DerivedMember` carries its REF and no `id`.** Task 2's `id: row.label` existed to match a
literal that spelled both; once the literal went it was a second name for one string. The ref
replaced it and does more work than it did — `armMember` reads the discriminator off the
member, so the arming machinery and the flyout's display are one list instead of two walked in
parallel. The one surface that needs a per-member KEY (`ToolFamilyMember.id`: a generator's id
for the stamp family, the label everywhere else) now makes that choice in the one place the
two cases meet.

**Two strip names moved from literals to row reads.** `GESTURE_ROWS.pointer.stripName` and
`.segment.stripName` were correct but unread; `PointerStrip` and `BrushStrip` read them now,
and `tests/chrome/tool-strip.test.tsx`' existing DOM assertions are what gate them (verified
by sabotage: renaming either reddens that suite and only that suite). `EffectRow` deliberately
carries NO strip name — `BrushStrip` renders `effect.toUpperCase()`, a derivation from the id,
and a `stripName: "DIG"` field would be new restatement rather than removed restatement.

**The two written non-derivation decisions retired by QUOTATION.** `status-keymap.ts` and
`ToolRail.tsx` each keep a header block that quotes the paragraph it used to carry and states
the supersession (2026-08-06, §22.2). The free-prose member restatements (§22.1) were
resolved individually: four died with the literals they sat in, three comments/glosses
(`ToolRail.tsx`'s flyout rationale ×2, `CommandPalette.tsx`'s member roll-call) were rewritten
to stop enumerating members, `ShortcutsDialog.tsx`'s canvas gloss had its roll-call DELETED
rather than derived (the same dialog already renders `tool.brush`'s hint, which names every
brush member off the rows — the hand-written copy sat a few rows below a derived one), and
**all FOUR descriptor hints that promise a cycle order became reads** — `tool.brush`,
`tool.brushCycle`, `tool.select` and `tool.selectCycle` now build the order from `FAMILY_ROWS`
through `cycleOrder`.

*(Two counting corrections, both found by review rather than by the digest. The planning digest
listed eight prose sites and missed `tool.brushCycle`'s hint entirely. The first pass of this
task then converted three of the four cycle hints and left `tool.brush`'s literal standing
beside its own twin — so renaming an effect made `B` and `⇧B` promise different orders in the
shortcuts overlay, the commit's own thesis failing in the commit that states it. Both fixed;
`cycleOrder`'s docblock records the second, and the pin asserts four.)*

That gave `action-registry/descriptors.ts` its second value import, arrow-legal for `LATTICE`'s
reason, and `tests/action-registry/node-door.test.ts` covers the new edge — a `document`
reference planted in `action-table.ts` fails the Node door (sabotage-verified).

**The gate turned into shape pins.** With no literal left to diff, `action-table.test.ts`'s six
comparisons became tautologies and were deleted rather than left as green cases that cannot
fail. What replaced them: the precedence order DRIVEN one shadow at a time, the strictly-`>`
overCap rule with both non-toning cases beside it, **one full status-line string per armed
state** (fourteen golden strings — the line's whole content is words, it is rendered by one
span, and nothing else holds it), the strip-prefix invariants `onStrip ≤ all.length ≤ D-6's
cap` plus the class-shapedness the Tailwind scan depends on, and a member-ref/label alignment
case. Seven sabotages, each verified to redden: precedence reordered, one status word edited,
`>` → `>=`, `onStrip` past the list, a breakpoint that stops being class-shaped, a dropped
member ref (caught by ten cases across the package), and the session verbs swapped in the
adapter.

**Two residues were adjudicated rather than closed**, both filed:
`chrome-shape-follow-ons.md` §"The status line spells ten keycaps the action registry already derives" (the status line's own keycap clauses, measured
and stated once in §22.6 — a real duplication, but `keycap()` lives ABOVE the floor and the
fix that keeps the arrow costs `StatusFragment`'s two-kind model) and
`family-member-picks-bypass-the-dispatch-funnel.md` (`member.arm` reached the host directly and
returned no `ActionResult`; believed unreachable-while-refused because both surfaces pre-check,
but "the one funnel" was not literally true). **The second is CLOSED and its entry deleted** —
foundations T4a Task 1 gave a member pick a funnel of its own (`runMember`), gated against the
family's own arm action. It also found the pre-check claim half-true: the rail's check is on the
flyout TRIGGER, so a session opening while the flyout stands leaves its members past their gate.

### 22.8 The tool seam converts — a state seam, and the cell retires (Task 6)

**A sanctioned behaviour change, the one this slice planned for.** `FieldHost.setTool` on the
plain path assigned `tool = clamped` and announced nothing; the seam had no snapshot. The
chrome absorbed both: `useFieldHostState`'s provider held a `tool` cell and a `radius` cell,
written by whichever surface set the brush and by a shell-owned `subscribeTool` effect. All
three of those are gone. `setTool` now value-compares (`sameTool`) and publishes through
`notifyTool()`; `toolChannel` carries `{ snapshot: () => [toolPush()] }`; and `useFieldTool`
latches the seam like any other reader.

**Both halves were needed and neither is sufficient**, which is why the cell had survived a
publish-only proposal:

- The **publish** answers who owns the value. Three surfaces read the tool simultaneously
  (the strip, the status keymap, the action registry). With no announcement, a copy each
  diverges the first time anyone picks a brush and nothing ever reconciles them.
- The **snapshot** answers the late mount. `TopBar` swaps `ToolStrip` out for a
  `SessionStrip` for the whole of every stamp session, so the surface that displays the
  brush remounts once per session; without a catch-up push it would come back on
  `DEFAULT_TOOL`. `tests/chrome/tool-strip.test.tsx`'s "the strip comes back from a session
  still showing the brush the host holds" is that claim at product scale — it opens a
  session, asserts the strip really unmounted, ends the session, and reads `FILL`.

**The value guard is not an optimisation.** Every strip control rebuilds the whole
`FieldTool`, so a publish without a compare would push on every no-op set into a path that
previously ran only on momentary taps. `sameTool` is `applyRadius`'s
`if (clamped === digRadius) return` one type up. Its PLACEMENT — below the momentary branch
— is a separate property with its own failure mode and its own pin; see *the guard's
placement* below.

**Two comparators, and `shared/` is the option not taken rather than the option not seen.**
`sameTool` (host) and `toolsEqual` (`frontend/lib/field-host-mirrors.ts`, chrome) are the
same predicate on opposite sides of a boundary the chrome may not cross with a value import
— which rules out `field-host/` as the shared home but says nothing about `shared/`, where
this slice's Task 5 already put `HOLLOW_MIN_M` and the radius bounds for the same reason and
where `BrushEffect` already lives. It stays duplicated on tolerate-until-three, and because
this duplication is the safe kind: both carry the destructure `satisfies Record<string,
never>` backstop, so a new `FieldTool` field fails to compile in both places at once. What
the backstop cannot catch — a comparison someone DELETES from one copy — is covered per-field
on both sides instead. The move is filed:
`docs/backlog/editor-and-tooling/chrome-shape-follow-ons.md` §"`sameTool` and `toolsEqual` are one predicate written twice".

**What the chrome lost.** Six cells became four (`gesture`, `flags`, `filters`, `verifying`);
three shell-held seams became two (`toolError`, `flags`); ten per-consumer latches became
eleven. `tool` and `radius` are ONE latch over `subscribeTool` rather than two — they arrive
in one push, and a latch each would be the duplicate subscription
`tests/chrome/host-seams-and-catalogs.test.tsx` exists to catch. The seam-ownership tables in
that file and in `shell.test.tsx` moved `tool` from the shell column to the reader column,
which is the change stated as data.

**Three behaviour deltas a user can observe.**

1. **A set the host CLAMPS corrects the control.** A hollow below `HOLLOW_MIN_M` used to
   leave the field displaying what it asked for while the strokes carved the clamped band.
   The readout is the host's answer — but this took a second commit to be TRUE rather than
   merely intended, and how it broke is the more useful half (see "the display-honesty
   regression" below).
2. **Before the engine is up, the brush controls do nothing visible.** `fieldHostRef` is
   assigned in the same tick as the `engine-ready` dispatch, so `host` is `undefined` for
   every render before it, and the latch is gated on `engineReady` besides. The cell used to
   move under a click that never reached a host — and then never reconciled, because the
   fresh host started on `defaultTool()` while the cell held the user's pick. The window
   trades a silent permanent divergence for a control that visibly does nothing for the
   length of the engine-bundle load.
   **In the `no-webgpu` and `engine-error` states that window never closes**: `App.tsx`
   renders `<Shell />` unconditionally, `status` never reaches `ready`, and the tool rail
   and strip therefore render fully interactive and permanently inert. Judged the RIGHT
   outcome and left alone — there is no host, so there is nothing a brush could arm, and the
   alternative the old cell provided was a strip that moved and lied about a world nobody
   can paint. It is not the right PRESENTATION: a control that is permanently dead should
   say so rather than absorb clicks in silence, and that is a visible-affordance question
   for the surfaces, not for this seam. Filed rather than built here —
   `docs/backlog/editor-and-tooling/chrome-legibility-gaps.md` §"The brush controls are permanently inert with no engine".
3. **Every `setTool` that changes something reaches every reader.** That is the point; it is
   also the delta with the widest surface, since it puts a push on a path that had none.

**The display-honesty regression, and why the suite could not see it.** The conversion broke
`HollowThickness` (`shell/tool-params.tsx`) — the editor's only free-text tool field, and the
one control that keeps a LOCAL text buffer and reconciles it on render. Its blur handler
corrects a sub-floor entry with `setTool({…, hollow: HOLLOW_MIN_M})`, and the buffer used to
re-seed because that write hit a chrome cell comparing by IDENTITY, so a fresh object always
published and always re-rendered. A latch compares by VALUE, and `HOLLOW_DEFAULT_M` equals
`HOLLOW_MIN_M` — so the corrective set asks for a value the host already holds, nothing
publishes, nothing renders, and the field sat on `0.1` over a 0.5 m band. Exactly the defect
the F2b rider exists to prevent, on the control the rider is written at.

**The fix is that the control normalises its own buffer** (`setText(String(committed))` beside
the corrective set) rather than waiting for an echo a value-guarded seam is entitled to
withhold. Note what is NOT the fix: removing the host's guard would not have helped, because
the chrome's own `toolsEqual` latch guard suppresses the re-render independently — and that
guard is load-bearing (it is what stops a momentary ⇧/⌃ tap repainting every tool reader).
**A control that displays anything the tool does not literally say owes its own
normalisation.** `HollowThickness` is the only one, and the reason is structural rather than
a survey: it holds the only `useState` in `tool-params.tsx`. Every other renderer in
`PARAM_RENDERER` is a control that cannot express an illegal value in the first place —
`radius` and `strength` are `min`/`max`/`step` range inputs, `iterations`, `mode` and `mask`
are `<select>`s over exactly the legal option set, and `material` is a swatch grid — so none
of them can hand the host something to clamp, and none of them keeps a buffer that could
fall out of step with the answer.

**The stub had to convert with it, and its first cut hid the bug.**
`tests/chrome/_stub-host.ts` holds the armed pair, its tool seam snapshots from it, and
`setTool` / `setDigRadius` clamp then publish only if something moved — the production
funnels, seam for seam. The first cut modelled the publish but neither guard, reasoning that
"the chrome cannot tell the difference: its latch drops an equal push by value anyway". That
is true of the LATCH and false of the chrome: no-push and equal-push really are
indistinguishable downstream, but an UNCLAMPED push is a third thing that is neither, and it
manufactured a render the real host does not. The floor is imported from
`shared/field-limits.ts` and the guard borrows `toolsEqual`, so neither can drift from the
number the strip shows or from the fields the host compares. Sabotage-measured: removing the
stub's `setTool` publish reddens every case that arms a brush and then reads the strip;
removing its snapshot reddens the two remount cases and nothing else; removing the
component's own `setText` reddens the hollow case and nothing else.

**The guard's PLACEMENT is a second property, and it needed its own pin.** `sameTool` sits
BELOW the momentary branch: while a modifier is held `tool` is the DERIVED brush, so a set
equal to it can still be a real change to the base the release lands on (picking smooth under
a held ⇧). Hoisting it above the branch makes letting go of ⇧ restore the wrong brush — and
left the entire editor suite green, because nothing drove the host's own key listeners.
`tests/field-host-momentary.gpu.test.ts` does: it needs a device only because `init` is what
attaches those listeners. Dropping the guard and hoisting the guard are different failures and
now fail different cases.

## 23. Foundations T3c — the interactive middle becomes a module, and a tool becomes a registration (2026-08-07)

Where T3b1 moved the CLEAN clusters (§21) and T3b2 removed restatement (§22), T3c moves the
one the cluster map called *"the worst available first extraction"*: the stamp session, the
move that rides it and the armed-gesture slot, out of `createFieldHost` and into
**`src/field-host/field-machine.ts`** as ONE module. Then the pointer chain followed it, and
a second, much smaller module — **`src/shared/tool-registry.ts`** — gave the editor its first
answer to *"which tools exist?"* that is not a chrome literal.

**The honest headline first, and it is the largest single movement this file has seen.**
`field-host.ts` went **7,266 → 6,337 lines (−929, −12.8%)**, and its CODE column — comments
and blanks stripped by §1's method in `docs/reference/field-host-clusters.md` — went
**3,434 → 2,854 (−580, −16.9%)**. Closure-level `let`s went **81 → 69**. Against that, the
two new modules are **2,198 lines** between them (`field-machine.ts` 1,936 / 833 code at T3c —
1,970 at T3d head, all of it comment; §21.5 is the live roster;
`tool-registry.ts` 262 / 53 code), so the tranche ADDS ~1,269 lines across the three files.
That ratio is the same one §21 recorded and for the same reason: a cluster's prose travels
with it, the wiring left behind earns prose of its own, and a module that has to justify why
it is one module rather than four writes that justification down. **The file is still 2,854
lines of code — ~7.1× the ~400-line guideline — and it is not a facade.** §23.7 states that
plainly against the tranche's own exit clause rather than leaving it to be inferred.

Two properties hold across the slice. **The facade moved by exactly one member**, 66 → 65,
and the member that went (`commitSession`) had zero production callers — §23.5. And **no
`FieldHost` signature changed except `setTool`'s**, which widened to a patch to fix a defect
the whole-tool seam could not express (§23.6).

### 23.1 One module, because it is one state machine

`field-machine.ts` is one module and not three because the three clusters are one machine,
and the cluster map had already measured exactly that: `stamp` and `move` *"share one slot —
the move session IS a stamp session with `moving: true`"*, so any boundary drawn between them
cuts a state machine in half; `gesture` and the pending-stamp arm above it are the other half
of the same click, because an arm SHADOWS the armed gesture rather than replacing it and the
two must be read together to know what LMB does. §7.5 of that map ranked this cluster the
worst available extraction — 13 partner clusters, 45 cross-cluster edges — and named the two
facts that would bite: it cannot go without `move`, and `cancelStampSession` is reached from
14 regions across 7 clusters. **Both held.** What changed is not the difficulty but the
floor: `HostSubstrate` exists (§20.3, §21.1), so the shared reads are one record rather than
sixteen arguments, and the Esc ladder is a capture STACK (§20.2), so a cluster can own its own
cancellable state without the host holding a list of it.

It took **13 of the three clusters' 14 state bindings** and **all 28 of their functions**. The
one that stayed is `stamp.ghostMeshes` — a substrate value the host draws directly, and
`substrate.ts` is where it already lived by declaration. The module is a **factory returning
an object** (`createFieldMachine(deps): FieldMachine`, 28 members), on `createSegmentBrush`'s
precedent, because a set of free functions would have to be handed the memory on every call.
That is the difference from its pure siblings (`field-stamp.ts`, `field-move.ts`,
`field-ghost.ts`): those are transitions and arithmetic over data handed in, and they were
extractable precisely because they remember nothing. **This is the memory.**

**Two things it deliberately does NOT own, and both were decided by re-reading the as-built
rather than by the shape of the name.**

- **`boxAnchor` and its two overlay batches.** By name the anchor is gesture state. By EDGES
  it is the selection cluster's, owned jointly with `anchorBatch`, `boxPreviewBatch`,
  `updateBoxPreview`, `boxCorner` and `selectionClick`. Taking it would have dragged the whole
  box-select overlay across the line for the sake of two calls, so the two calls arrive as
  deps instead (`setBoxAnchor`, `boxCorner`) — the `armMaskDropReport` precedent §21.1 set.
- **`commitToolOp`.** It is a BRUSH verb wearing a commit's name: it applies one op through
  `field.logApply` with the active tool's mask and pushes the history feed, and it was already
  a `field-segment.ts` dep. The two verbs that DID move are the session's terminal pair
  (`commitStampSession`, `applyReconfigureSession`), and they moved because leaving them
  behind would have meant exporting `setStamp`, `destroyGhosts`, `notifyStamp`, `endMove` and
  `reportEmptyPreview` purely to serve two callers — five private-state verbs promoted to
  public surface, which is the opposite of what "owns its state privately" means.

Every cross-cluster dependency arrives in `MachineDeps` (**39 members**), and the
reassignable ones arrive as FUNCTIONS rather than as values — §21.1's first clause, applied.
Two members are `let`s in the host (`archetypes`, and the selection behind `selectionRegion`),
and either one snapshotted at construction would give the module a private copy the host's own
writes never reach: a stamp opened after `setEntityCatalog` would seed from a catalog the
project no longer has, and `startStamp` would arm region-draw over a selection the user made
an hour ago.

### 23.2 The canonical-setter law closes over `stamp` and `pendingMove`

§20.2 states the router's law: **every mutation of a captured state must go through its
setter**, because a bare assignment that skips the reconcile leaves a capture behind and the
next Esc spends itself cancelling something that already ended. At T3b2 the machine's own
central slot was the one state that did not obey it — `stamp` had **13 write sites and no
setter**, and its Esc reconcile was a hand-maintained list of which writes crossed
null↔non-null, kept as a comment. Nothing failed when a fourteenth write was added and the
comment was not.

**`setStamp` is that setter.** All 13 writes route through it; it computes
`crossed = (stamp === null) !== (next === null)` and reconciles only then, so the structure
answers what the comment used to assert. The distinction the comment was maintaining is real
and survives: a crossing write reconciles the capture, a live→live transform does not,
because a reconcile at a transform would be a no-op with a cost and — worse — would imply
that a slider drag re-acquires and moves the session's stack position every time a param
changed.

**`setPendingMove` is the same law one slot over, and it is the slice's ONE sanctioned Esc
change.** The sub-threshold press — a press on the already-selected entity, waiting to see
whether the cursor travels far enough to mean "move" — held no capture, so Esc fell straight
past it to the selection the user was pressing on. It now has a rung of its own, and Esc
cancels the press. There is **no pointer-capture release on that rung**, and the omission is
verified rather than overlooked: the branch that arms `pendingMove` does not capture — capture
is taken at the threshold crossing, in the same breath that clears the slot — so a release
would be a line that could only ever throw on a stale id.

**The rung mechanism itself left the closure.** `escRung`, which §20.2 describes as *"a
shared `escRung` helper"* private to `createFieldHost`, is now **`createRung`, exported from
`input-router.ts`**, and `field-segment.ts` dropped its hand-rolled handle slot for it in the
same change. **Seven rungs now stand across three modules on one implementation** —
`field-host.ts` 3 (box anchor, selection, selected entity), `field-machine.ts` 3 (the session,
the pending stamp arm, the pending move press), `field-segment.ts` 1 (its anchor). That
promotion is what made a cluster owning its own cancellable state extractable at all, and it
is the teardown edge §7.5 of the cluster map named as the second thing that would bite.

The 14 `cancelStampSession` call sites became `machine.cancelSession()` — **nine still spelled
in `field-host.ts`** (the world reset, the table swap, dispose, the history step, and the
entity verbs), the rest internal to the machine.

### 23.3 The machine arbitrates the pointer; the host attaches and steps aside

The four pointer listeners' CHAINS moved into the machine as `pointerDown` / `pointerMove` /
`pointerUp` / `pointerCancel`; the four functions in `field-host.ts` are now one- and two-line
delegates. **The rule that drew the line is stated where the chain is: most of what those
branches TEST is state the machine owns and nothing else does** — a live move, a pending stamp
arm, the armed gesture, a stroke in progress — so the chain follows the state, while every
branch's VERB stayed with its cluster and arrives as a dep (`eyedropper`, `applyTool`,
`selectionClick`, `pointerPress`, the segment brush's three). Exactly three branch tests are
NOT the machine's — `camera.look`, `selection.boxAnchor`, `segment.segmentAnchor` — and they
travel the other way, as liveness thunks. `MachineDeps` going 22 → 39 members is the
measurement of what the chain was already reaching for.

**What stayed on the host, and why each is not an omission:**

- **The listeners themselves.** `attachListeners` owns the canvas element; the machine has no
  canvas and should not acquire one.
- **keydown, keyup and blur.** The momentary ⇧/⌃ pins are closure-private keydown state with
  no facade route — `tests/field-host-momentary.gpu.test.ts` reaches them ONLY through the
  real listeners — so moving the keyboard three would have meant inventing a route to test
  through, in a slice whose licence was a move.
- **The wheel**, which is half camera.
- **DOM pointer capture.** It became one host thunk pair (`capturePointer` / `releasePointer`)
  called from four sites, three of them in the chain. §20.2 predicted that *"T3c's gesture
  machine takes … pointer capture"*; it did not, and could not — the machine holds no element.
  What T3c did take is the ARBITRATION, and the correction is recorded here rather than left
  as a claim §20.2 makes about a future that arrived differently. `input-router.ts`'s own
  header was corrected in the same tranche to say that its "capture" means the Esc stack's,
  not the DOM's — the two words had been sitting one file apart meaning different things.

The move was net **+1 line** on `field-host.ts` and drifted every line number in it anyway:
~150 lines of chain left the input handlers near the bottom, and a comparable number arrived
~3,000 lines higher up as the look-drag and pointer-capture verbs the machine could not take,
plus the prose saying why. A net-zero file is not an unchanged one.

### 23.4 The tool registry — existence and liveness, and the `build` that could not ship

`src/shared/tool-registry.ts` answers **two questions and no others**: `toolEntries()` says
which tools EXIST, in registration order — the enumeration T4's MCP surface needs — and
`toolCanActivateControl(id, ctx)` says whether one of a tool's controls may render LIVE
against the current material classes. Two tools are registered, `brush` and `segment`. The
machinery is a factory (`createToolRegistry`, on core's `createRegistry` precedent) with the
editor's own instance at module scope; `define` is **setup-loud** on a duplicate id, and both
query paths are **runtime-quiet**, because every caller is inside a React render where a throw
over one knob takes the whole strip down.

**It absorbs exactly one rule, and moving it is the point.** `tool-params.tsx`'s
`availableParams` used to spell `id === "material" ? classes.length > 1 : true` inline — a
swatch strip with nothing to choose between is a control that cannot do anything — and was
therefore the only place in the editor that knew a control could be dead for a reason the
effect table cannot see. It now asks the registry, so a second surface asking the same
question gets the same answer by construction. The filter still runs BEFORE the strip's ≤4
cap, so a material param a one-class catalog cannot fill never eats a slot and strands a real
control behind the ⋯.

**Three deviations from the plan and the spec, all forced, all verified at source.**

1. **It is on the FLOOR (`shared/`), not under `field-host/`.** Three facts each decide it
   alone: the chrome must read the capability answer at React-render time and may not
   value-import anything reaching under `field-host/` (§7 — the barrel carries core, and
   `tests/frontend-no-engine-leakage.test.ts` exists to prevent a second core in the main
   bundle); a descriptor table must be DOM-free so a daemon process can import it for MCP
   (§22.5), and `field-host/` is the DOM-facing half by definition; and `action-registry/` —
   the other DOM-free node — pins its file list BY NAME in that same guard, so a fifth file
   would rewrite the pin rather than satisfy it.
2. **There is no `build` on the row, so `ToolDeps` / `ToolInstance` do not exist and the
   machine does not look tools up by id to arm a gesture.** The spec's §3.2 `defineTool`
   bullet pairs a builder with the capability query on one row. They cannot share a row. The
   only `build` that has an implementation today is `createSegmentBrush`, a VALUE in
   `field-host/` and immovable — it value-imports `field-ghost.ts`, which value-imports
   `@furnace/core/field` — so a row carrying it can only be WRITTEN in `field-host/`, where by
   (1) the chrome can never read the capability answer sitting beside it. **The structural
   fact underneath both is that the chrome and the host are two BUNDLES, not two directories
   in one bundle**: the chrome builds from `src/frontend/index.html` plus the two worker
   entries, while the host reaches the browser as `/engine.js`, a separate esbuild bundle the
   chrome fetches and dynamically imports at runtime (§7). Each graph therefore gets its own
   module instance and its own table, so a `defineTool` call written host-side never runs in
   the chrome's graph — the strip would query an EMPTY table, take the default, and put a dead
   control back on screen with every test green. Two ways out were considered and both fail:
   registering the whole row from the host (dead on arrival, per the two bundles), and
   splitting the registration so the host attaches only the builder — which makes the table's
   CONTENTS bundle-dependent while its TYPE says otherwise (a chrome caller writing
   `entry.build(deps)` type-checks and gets `undefined is not a function` in the browser, with
   the suite green, because tests run UN-BUNDLED in one process where the host's attach HAS
   run). A separate host-side registry keyed by the same ids was rejected too: it converts a
   bundle-visibility problem into a drift class — two enumerations of one set with nothing
   pinning them equal, which is precisely the shape §22 had just removed. **The builder half
   is deferred whole rather than half-built.**
3. **`canActivate` shipped as `canActivateControl`.** The spec and the plan both name the bare
   verb; the suffix is doing real work, because the semantics changed. The question the strip
   asks is per-CONTROL — a one-class catalog kills the swatches and leaves radius, mask and
   hollow alone — and a tool-wide boolean could only kill all four or none. The per-TOOL
   question ("may this tool be armed at all?") is a different one that T4's MCP surface will
   want, and `canActivate` is the name it should get; spending the obvious name on the
   narrower question is how the two would end up telling one story.

`segment` registers with no `canActivateControl`, and that is a fact about the tool rather
than an omission: a segment click commits a brush op built from the live effect and material,
so the controls under it are the BRUSH's and the brush's answer governs them.

**What the registry deliberately does NOT own is PRESENTATION.** `shared/action-table.ts`
(§22) goes on owning which member a family lists, in what order, under what label, with which
params. Registration order here is not rail order and nothing may read it as one.

### 23.5 `txn` was dropped; `commitSession` was deleted

**The `TransactionManager` / `txn(label, fn)` bullet in the foundations design is DROPPED — a
user decision taken at T3c planning (2026-08-07), on measured evidence, and recorded here so
that the fact is citable from a tracked document.** Its premises did not survive the T2–T3b
as-builts:

- **Only 3 of the 5 named commit paths are real writers**, and each owns a core composite that
  cannot decompose (`commitGenerator` / `reconfigureGenerator` / `logApply`).
- **`commitSession` had ZERO production callers** — T3c deleted it (below).
- **`logApplyGroup` (§20.4, T3a) already IS the grouping layer**, and has no editor caller
  because nothing in the editor emits a multi-op gesture yet. Verified at head: zero
  occurrences of `logApplyGroup` anywhere under `packages/editor/`.
- **A `txn` LABEL would author a fact `field-history.ts` already DERIVES**, and that module's
  no-label stance is a written decision, not an accident.

**The transaction story, stated once so nothing has to reconstruct it:** core's OpLog is the
mechanism (LIFO stacks, persistence, replay) and stays in core because the game needs it;
`logApplyGroup` is the grouping layer for the day a gesture emits a list; history labels are
derived. There is no editor-side second undo system and none is planned. UI state (selection,
camera, palettes) stays non-undoable — status quo, now stated. The one open question about
`logApplyGroup` is unchanged by this and is filed:
`docs/backlog/engine-architecture/oplog-group-apply-is-not-a-transaction.md`.

**`FieldHost.commitSession` is deleted, and the facade is 65 members.** It meant "end the live
session with whichever verb its MODE calls for", and at T3b2 it had zero production call sites
repo-wide: the app-level ⏎ is `session.confirm` → `confirmSession`, and the session card's
footer routes there too because the button wears the ⏎ keycap and must mean what the key
means. The mode→verb mapping it exposed is not deleted — it survives inside the machine as
`confirmSession`'s first step. Four comments that still described it as live were corrected by
quotation rather than removed, and the two test callers moved onto `confirmSession`.

### 23.6 Three defects fixed, and the 2-D model the state now names

**`setTool` takes a PATCH** (`Partial<FieldTool>`), and the widening is a fix rather than
ergonomics. Hold ⇧ (momentary smooth), drag the strength slider, let go — and the brush was
permanently smooth, because every strip control spread `ctx.tool`, and under a held modifier
`ctx.tool` is the DERIVED brush. The seam then read the echoed `effect` as a deliberate pick
and adopted it as the base the release restores to. **The whole-tool seam could not tell the
two apart, because a deliberate pick of the derived effect and a param echo are the same
VALUE.** A patch separates them by construction: a control names only the field it owns. The
alternative of spreading field-by-field host-side while keeping the host's own `effect` was
checked and rejected on evidence — it provably breaks the deliberate-pick case the branch
exists for. **The widening is source-compatible** — a whole `FieldTool` still satisfies
`Partial<FieldTool>` — so no existing caller or test had to change to keep compiling, and the
change is visible only where a caller CHOSE to narrow: the **eight** controls in
`tool-params.tsx` dropped their `...ctx.tool` spread, and `tests/chrome/tool-strip.test.tsx`'s
material-swatch case became a `toEqual` over a `toMatchObject`, because with a patch the
ABSENCE of an `effect` field is the claim.

**`dropMove`'s zero-step rule asks the REGION, not the drag.** It used to ask whether the
CURSOR had travelled (`d.applied === [0,0,0]`), so `G` → ← ← ← → ⏎ discarded a grab the user
had moved three steps with the arrow keys, silently. `sameRegion` in `field-move.ts` replaces
`moveIsIdle` and compares the session's region to the entity's RECORDED one — which also fixes
the other direction, an out-and-back drag that lands where it started and used to spend an
undo entry.

**A history step cancels ANY live session**, not only a moving one. `resetWorld` and
`setMaterialTable` already applied that blanket rule, on the reasoning that a session whose
inputs moved must not be left offering an Apply that would build something the ghost never
showed; a ⌘Z that rewrites the log under a plain reconfigure session is the same class of
event.

**The 2-D model, which the state now names and the facade type still does not.** What LMB does
is really TWO independent facts: an EFFECT (dig / fill / smooth / paint — the tool cluster's)
and a GESTURE (stroke / two-click box / two-click segment / pointer — the machine's `gesture`
slot). What runs is the product of the two, and today's `ViewportGesture` is a **1-D
projection** of it: `segment` is a brush EFFECT wearing a gesture's costume, which is why
arming it has to reach into the tool and why the suspension check needs a branch of its own.
Naming the model in the STATE is what an extraction can honestly do. **`ViewportGesture` stays
the 1-D CONTRACT**, and that half stayed presentational and filed: the rail still shows an
exclusive five-member list, `ToolStrip` still compensates at render time, and `armMember`
still walks a one-dimensional ring over two-dimensional state. Changing the type is a
chrome-visible decision with consequences for the keyboard ring, the flyout and `armedIndex` —
a MOVE task is the wrong place to change a contract
(`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` §"Segment reads as a fifth brush, but it is a modifier on the other four", whose
state half T3c closed and whose presentation half it did not).

### 23.7 The T3 exit, measured at T3c

**SUPERSEDED BY §24.6, which is the T3 exit table's FINAL form.** This subsection is kept as
written because the two read together are the record: three clauses were answerable at T3c
and two were not, and every one of the five moved at T3d. Where they disagree, §24.6 wins —
it is a measurement at a later head, not a revision of this one.

The foundations design's T3 exit has five clauses. Three of them are answerable at T3c head
and two are not, and saying which is which is the point of this subsection.

| Clause | Verdict at `foundations-t3c` head |
| --- | --- |
| `field-host.ts` is a facade over framework + tools | **Does not hold.** 6,337 lines / **2,854 code**, 69 closure `let`s, and **14 of the map's 23 cluster rows still live** (two of them, `tool` and `input`, part-hollowed). The tranche took the largest single bite yet — −929 lines, −580 code — and the file is still ~7.1× the ~400-line guideline. |
| 70 cross-cluster mutation edges structurally gone or ViewStore-mediated | **Partially, and NOT fully re-derived.** See below. |
| chrome tool tables generated from the registry | **Holds**, with a split the spec did not anticipate: the six per-tool chrome tables derive from `shared/action-table.ts` (§22.7), which owns PRESENTATION, while `shared/tool-registry.ts` owns EXISTENCE and the one capability rule. Two tables, two questions, no join beyond the ids. |
| suite green | **Holds** — 2905 pass / 1 skip / 0 fail. |
| Chrome + Safari visual gate on the cockpit loop | **Not run.** It is the user's gate, not an executor's, and it is owed. |

**On the 70 edges, honestly.** That number is the cross-cluster mutation register in
`docs/reference/field-host-clusters.md` §5, a hand attribution taken 2026-08-03 and **never
re-summed since** — §2.2 of that document says so, and re-deriving it is a full attribution
sweep rather than a grep. This tranche did not run that sweep. What it CAN state is exact at
the BINDING grain, because §5's own tables name every target and T3c annotated each affected
row with a `Status`:

- **§5.4's whole session cycle — 3 edges — is gone**, being the only bidirectional mutation
  pair in the closure and now entirely internal to `field-machine.ts`.
- **§5.2 loses 7 of its 20.** Five (`tool.digging` ×2, `tool.lastStroke`, `move.pendingMove`
  ×2) have state and writers both inside the machine; two (`camera.look` ×2) were re-homed
  in-file onto `beginLook` / `endLook`, which are camera's own.
- **§5.5 loses 2 of its 12** (`gesture.suspendReported`, written by both session openers,
  which are now inside the machine).
- **§5.1 (24) and §5.3 (12) are untouched.**

So roughly **12 edges are structurally gone and ~59 stand**, of which four changed MODULE
without ceasing to be edges (`tool.maskDropReported`, `drift.drift` and
`stats.lastReconfigureMs` from `applyReconfigureSession`, and `move.pendingMove` from the
host's `pointerPress`, which now travels through `setPendingMove`). **Two caveats attach to
those figures.** First, §5's subsection totals (24 + 20 + 12 + 3 + 12) sum to **71**, not the
70 its own opening line states — a discrepancy in the original attribution that this tranche
noticed and did not resolve, since resolving it means the sweep. Second, no `ViewStore`
mediates any of the remainder: T3a's `ViewChannel` (§20.1) is the publish half only, and the
slots-and-change-detection half §7.3 step 3 recommended **was never built and is no longer
needed for these three clusters** — they went into one module instead, which internalises the
forking problem rather than solving it in a shared store. The recommendation still stands for
`tool`, `camera` and `selection`, which are still in the closure.

**Both caveats were discharged at T3d and the outcome is in §24.6.** The 70-vs-71 discrepancy
was resolved at the T3c review's own re-attribution (70 target × writer PAIRS over 71 write
SITES — two units, one section), and the `ViewStore` half is now closed by absence rather than
by build: all three clusters it was still recommended for left the closure at T3d Tasks 4 and
5, so there is nothing left for a shared slot store to mediate.

## 24. Foundations T3d — the facade, finished (2026-08-08)

Six tasks, six atomic commits, one branch (`foundations-t3d`). T3d took `createFieldHost`
from a 6,337-line file with fourteen live clusters in its closure to a **3,999-line facade
over framework + tools**, and it is the tranche that closes foundations T3.

**The bar was BEHAVIOUR-FROZEN throughout.** Zero behaviour changes and zero facade changes
were the tranche's absolute constraint: the `FieldHost` type block is **comment-stripped
byte-identical to master** at every one of the six commits (sha `7568c33b…`, 81 stripped
lines, **65 members**), and every existing test passed **unmodified** — a red pin meant a
move was wrong, never that a pin was. The suite ran **2912 pass / 1 skip / 0 fail** at the
branch point and at each commit.

### 24.1 The six tasks

| Task | What left the closure | Landed as |
| --- | --- | --- |
| 1 | `targeting`, `picking`, `drift`; `catalogs` DECLARED FACADE-RESIDENT | `field-targeting.ts`, `field-picking.ts`, `field-drift.ts` |
| 2 | `analyzer` — whole, 18 of 19 bindings and all 14 functions | `field-analyzer.ts` |
| 3 | `materials` (16 of 17 bindings) + `render` (whole) | `field-materials.ts`, `field-render.ts` |
| 4 | `tool` + `camera` — whole; the listeners STAYED and became callers | `field-tool.ts`, `field-camera-rig.ts` |
| 5 | `selection` + `entities` as TWO modules; `stepHistory` DECLARED FACADE-RESIDENT | `field-selection.ts`, `field-entities.ts` |
| 6 | `world` (3 of 8 bindings, all 14 functions) + the five facade entity verbs; `lifecycle` and `input` DECLARED FACADE-RESIDENT | `field-world.ts`, `field-entities.ts` (+5 verbs) |

**Task 5's plan premise was measured and REFUTED**, which is the tranche's one scheduling
correction: the pair task existed because `selection` and `entities` "write each other's
capture rungs". They do not — every rung rides `createRung` and names only its own cluster's
state — and the measured coupling is ONE directed call at ONE site. They shipped as two
modules.

**WHAT T3d DID NOT CHANGE, said once so the diff is accountable.** No `FieldHost` signature,
no chrome file, no test file, and no daemon command. Exactly ONE SOURCE file outside
`src/field-host/` was touched by the whole tranche: `src/shared/field-limits.ts`, at Task 4,
**+5 / −4 lines and all of it comment**. No constant moved and none was deleted — all six are
still exported there, and the file's bar is untouched (a number belongs there only if the
host ENFORCES it and a surface STATES it). What changed is that three TSDoc blocks named
`field-host.ts` as the enforcement point and the enforcement had moved: `clampRadius` and
`clampTool`'s `hollow` floor are `field-host/field-tool.ts`'s since that task, so the docs
now name the module. That is the whole `shared/` footprint of six tasks.

### 24.2 The module roster

**Eighteen** modules under `packages/editor/src/field-host/` — counted as "exports a
`create*` factory over a `*Deps` record", which is what makes a file a lifted CLUSTER rather
than a pure helper or a seam primitive. T3d produced **eleven** of the eighteen (Tasks 1–6)
and **changed** two more (`field-entities.ts` took the five facade verbs at Task 6;
`field-stats.ts`' two deps changed owner). The live inventory with line counts, deps and seam
widths is **§21.5**, whose counts were derived by script from the source at the T3d review
(the script was session scratchpad, not a tracked gate — whoever edits §21.5 re-derives
its counts from the source rather than adjusting them by hand).

### 24.3 The facade's final shape, measured

By the closure map's §1 method (`docs/reference/field-host-clusters.md` §2), re-derived at
Task 6:

| Fact | At T3c head | At T3d head |
| --- | --- | --- |
| File total | 6,337 | **3,999** (−36.9%) |
| Code / comment / blank | 2,854 / 3,273 / 210 | **915 / 2,996 / 88** (code −67.9%) |
| `createFieldHost` span | 4,665 lines from 1,673 | **2,495 lines from 1,505** |
| Closure bindings | 232 (69 `let` / 163 `const`) | **56 (9 `let` / 47 `const`)** |
| Live cluster rows in the closure | 14 | **0 extracted-owner rows; 4 DECLARED facade-resident** |
| `FieldHost` members | 65 | **65** (unchanged, by contract) |

**The code bar was ≤ 1,000 and it landed at 915** — but the number was the guard, not the
definition. **The definition is the MECHANISM: no state and no functions left in the closure
with an extracted owner.** That holds exactly, and the accounting is worth stating precisely
because the closure's data side is not zero and should not be:

- **20 data bindings remain, in three categories.** Eleven are `HostSubstrate` VALUE members
  (`requestContext`, `store`, `log`, `dirty`, `worker`, `chunkMeshes`, `flagStore`,
  `litByClass`, `propMeshes`, `ghostMeshes`, `voidCastMeshes`); five are the BACKING of
  substrate THUNKS (`table`, `archetypeById`, `ctx`, `disposed`, `canvasEl`); four belong to
  the rows declared facade-resident (`archetypes` → `catalogs`, `raf` + `lastFrameT` →
  `lifecycle`, `lastCursor` → `input`). **11 + 5 is exactly the substrate's sixteen members**
  — the closure's data side IS the substrate's backing, plus four.
- **16 functions remain**: `input`'s fourteen, `lifecycle`'s `tick`, `history`'s
  `stepHistory`. All three rows are declared.
- **20 module records** assemble the nineteen modules plus the Esc router.

The general rule this settles, and the one a future reader should carry: **a substrate value
member does not belong to the cluster that writes it most.** `flagStore` (Task 2),
`litByClass` (Task 3) and `world`'s five (Task 6) all stayed for that reason, not for want of
trying.

### 24.4 The four declared stays, and why each is a decision

"Not extracted" and "examined and staying" needed to stop looking the same, so T3d introduced
a **DECLARED FACADE-RESIDENT** verdict recorded at source and in the cluster map's §6 row.

- **`catalogs`** (Task 1) — 3 state / 0 functions. What a module would have contained is its
  three SETTERS' bodies, and all three are facade members; two of the three bindings already
  ride the substrate as thunks.
- **`history.stepHistory`** (Task 5) — six of its seven statements are calls into **five**
  different modules (`world`, `machine`, `entities` ×2, `props`, `drift` ×2 — seven calls,
  five modules) and it owns no state. All three callers are facade-resident, one of them
  `onKeyDown`'s ⌘Z branch. Task 6 closed its last non-module statement by taking
  `markDirtyWithNeighbors` with `world`, so the body is now a pure composition.
- **`input`** (Task 6) — the adapter that turns DOM events into calls. It reads ZERO other
  clusters' state, and its standing mutation edges cross a module line **while every writer
  stayed where it was born** — twelve of the thirteen directly, the thirteenth
  (`tool.maskDropReported`) because T3c moved its writer into `field-machine.ts` first. The listeners own the canvas element and are never
  going to follow their targets.
- **`lifecycle`** (Task 6) — three reasons, of which the ordering is only the middle one.
  (1) Its state cannot leave: `requestContext` is a substrate VALUE member and `ctx` /
  `disposed` BACK two substrate thunks **seven** modules read through (`field-analyzer`,
  `field-machine`, `field-materials`, `field-props`, `field-selection`, `field-voidcast`,
  `field-world`), so a module owning them would hand the substrate its own contents from
  below. (2) The teardown ORDER is
  load-bearing across **eight** modules and a context guard (`advisor`, `world`, `props`,
  `selection`, `machine`, `voidcast`, `materials`, `cameraRig`) — each module owns its own half
  (`materials.destroy`/`release`, `cameraRig.unbind`/`release`, `advisor.dispose`/
  `destroyMarkers`, `world.discardChunkRenders`); what remains is the SEQUENCE. (3) `init`,
  `dispose` and `tick` are what a facade over framework + tools owns. A `field-lifecycle.ts`
  would take ~25 deps across every module in the file plus three facade-resident functions.

**This corrects the closure map's §7.3 step 4** ("leave `lifecycle` and `render` last"). The
`render` half was already half-wrong (Task 3 moved it early at no structural cost). The
`lifecycle` half was right about waiting and wrong about the unstated third clause: going
last is what made the answer legible, and the answer was "declare it", not "extract it".

### 24.5 The coverage findings — counterexamples to any blanket claim

T3d ran sabotage probes at every task, and the green ones are the load-bearing half of the
record. Three task totals are recorded in the map and are the ones this section cites without
re-deriving the rest — **note the suites differ, which is itself a caveat on comparing them**:
**Task 3 five** (§2.8: three green + two red, measured against the EDITOR suite at 1469/0,
not the full one), **Task 5 twelve — six red and six green** (§2.10, full suite), **Task 6
ten — eight red and two green** (§2.11, full suite). *(An earlier draft of this paragraph
said "Task 3 eight (§2.8)"; eight is §2.9's figure — Task 4's — and §2.8 records five.)* **Six** stand as counterexamples to "the suite covers the viewport", and the sixth is a
different class from the other five:

- **The frame's draws.** Task 3 measured that an empty viewport is fully green: `render`
  moved with no seam negotiation and the suite proved almost nothing about it afterwards. The
  suite pins that the frame RUNS, not what it DRAWS.
- **The materials cache.** Task 3's second finding, same shape one layer down.
- **The camera pose lane.** Task 4.
- **The selection cell display.** Task 5 measured it exactly: `field-host-selection-cells.gpu.test.ts`
  reads `selectionCellCount()` at 7 sites and the `SelectionInfo` payload at 10, and asserts
  the instanced MESH at **zero** — so forcing `cellMesh()` to `null` is 2912/0.
- **Two more from Task 6**, and one of them is a different class: `setMaterialTable`'s
  post-swap re-mesh is unpinned (though `ret.init`'s identical call is), and
  `exportArtifact`'s `playerYaw` is unpinned — **a DATA output, not a drawn frame**, so a
  bake could write the wrong spawn yaw and no test would say.

The predictor Task 5 derived and Task 6 confirms: **"does a public seam expose what this
cluster decides", not "does it write across a line"**. `entities` has zero mutation edges in
both directions and is the best-pinned cluster of the tranche; `render` has no facade member
at all and is the least.

### 24.5b What T3d parked, and where it is written down

Six behaviour-frozen tasks meet deletion-shaped questions they may not answer. T3d declared
each at source with the words "prune tranche" — **eight sites across six files** — and the
Task-6 review found there was no `docs/backlog/` entry for any of them, plus three more items
(the `boxCorners` move, `field-host.ts`'s tombstone density, the `~N lines` hint staleness)
with no record at all. That is now
`docs/backlog/editor-and-tooling/field-host-internals.md` §"The `field-host/` prune tranche", which lists the eight sites so
the two records cannot drift, and carries one shape the code-quality review surfaced:
`field-world.ts`' seven pure-read verbs need `{ substrate }` and nothing else, so a
world-lifetime / chunk-geometry split is available at 16 deps + 1 dep. Not taken — ~150 lines
and a 22nd file for a boundary the freeze could not test.

### 24.6 The T3 exit — all five clauses, final

Supersedes §23.7, which measured the same five at T3c head.

| Clause | Verdict at `foundations-t3d` head |
| --- | --- |
| **1. `field-host.ts` is a facade over framework + tools** | **HOLDS, with the accounting stated.** 3,999 lines / **915 code** (was 6,337 / 2,854), **56 closure bindings** (was 232), **zero cluster rows with an extracted owner** live in the closure, and the four that remain are DECLARED facade-resident with the argument at source. What the closure still holds is the substrate's sixteen backing slots plus four bindings owned by those declared rows, and sixteen functions that are `input`'s, `lifecycle`'s and `stepHistory`'s. It does **not** meet the ~400-line guideline (915 code is ~2.3×) and that was never the bar; the bar was the mechanism, and §24.3 is the measurement. **Read this clause together with §24.5** — the facade is thin, and the tests do not prove what the modules behind it draw. |
| **2. 70 cross-cluster mutation edges structurally gone or ViewStore-mediated** | **NEITHER, AND THE HONEST ANSWER IS A THIRD THING.** Re-tallied per write site at each task: **11 edges are structurally gone** (9 internalised by `field-machine.ts` at T3c, 2 re-homed) and **59 stand — all 59 now crossing a module boundary, 18 of them MODULE→MODULE, and ZERO remaining cluster-to-cluster inside the closure**. No `ViewStore` was ever built and none is needed: `ViewChannel` (§20.1) owns the publish half for all thirteen seams, and every cluster the slot-store half was recommended for has left the closure. **So an extraction tranche converts cluster-to-cluster edges into module boundaries rather than deleting them** — only a merge deletes an edge, only a re-homing retires one. That is a finding, not a shortfall: the coupling was real, and a boundary makes it checkable rather than making it go away. Full arithmetic in the map's §5.7. |
| **3. chrome tool tables generated from the registry** | **HOLDS**, unchanged from T3c, with the two-table split the spec did not anticipate: `shared/action-table.ts` owns PRESENTATION, `shared/tool-registry.ts` owns EXISTENCE. |
| **4. suite green** | **HOLDS** — **2912 pass / 1 skip / 0 fail**, at the branch point and at every one of the six commits, with **every existing pin unmodified**. |
| **5. Chrome + Safari visual gate on the cockpit loop** | **OWED — it is the USER's gate and no executor may run it.** T3d is behaviour-frozen, so it is a REGRESSION walk (generate → dig → paint → bake → walk) plus the T3c checklist's touchpoints. |

### 24.7 The objectives audit's rulings (2026-08-08, at T3 close)

The T3-close objectives audit reconciled the programme's as-built against its design and
put three findings to the user; the rulings are decisions of record:

- **The ViewStore state-placement rule is RETIRED by ratification.** The design had
  written *"a `let` crossing a module boundary belongs in the ViewStore, never a
  parameter"*; the as-built answers every crossing with a deps-record member — a named
  setter, a thunk, or a substrate slot — and the audit found the rule contradicted
  without a record retiring it. **Ruling: the deps-record architecture is ratified**; it
  won on evidence (59 boundary-crossing edges, every one typed, named and auditable at
  its record — §24.6 clause 2), and this paragraph is the retirement the rule never got.
- **The provider-collapse promise is recorded as a MISS.** The design promised the
  ~870-line chrome provider would collapse; `useFieldHostState.tsx` is 1,093 lines at
  head — the latch conversion (the real goal, achieved — §21.3) grew the file it was
  supposed to shrink. Not scheduled as work; recorded at
  `docs/backlog/editor-and-tooling/chrome-shape-follow-ons.md` §"The chrome provider the design promised to collapse grew instead".
- **The typed `furnace.*` vendor-key namespace rides T4.** Built at T1b, deleted at T2
  as a scene orphan, never re-typed — a silent regression against the schema-boundary
  design. Ruling: re-filed for T4, where the JSON-Schema projection gives the type its
  first consumer with teeth
  (`docs/backlog/engine-architecture/furnace-vendor-keys-untyped.md` (gone)). *(The ruling was
  carried out and that entry is DELETED: `FurnaceMeta` lives in `core/registry` beside the
  `z` its writers build with, its six defining sites `satisfies` it, and the door's
  `paramSchema` reader is the consumer-with-teeth this predicted — foundations T4c Task 6,
  §27.4. The path above is kept as the record of what the audit ruled, not as a live one.)*

The audit's full record (every §9 criterion, every design commitment, the MISSING list
and the dropped-records batch it triggered) is a session artifact; its durable outputs
are the eleven backlog filings of 2026-08-08, `engine-architecture.md` §16 (the
huge-world handoff, promoted to a tracked home), the T4 donor entry's re-anchor, and
this section.

## 25. Foundations T4a — the honest substrate (2026-08-08 → 2026-08-09)

The first tranche of foundations T4, and **it contains no MCP work at all** — no SDK, no
transport, no tools, no claim state. T4's direction session settled that an agent would drive
the editor over MCP; this tranche is what runs BEFORE one is connected. Its whole thesis is
that four things the substrate said about itself were not true, and each was tolerable only
while every caller was a human at a keyboard:

- a funnel that called itself the one funnel and had a second door beside it;
- a gate that answered a caller who cannot see the screen as though it could, and refused
  without stating why;
- a shape validator that checked a capsule's numbers and let a sphere's and a box's through;
- a load path that checked every string on the wire and no number.

None of the four is reachable by the chrome's clamped gestures. All four are reachable by an
op stream written by hand or by an agent, which is why they close here rather than inside the
slice that first hands one over.

**Where the work landed.** Six tasks — **three in the editor** (T1 the second funnel, T2 the
gate envs, T6 the daemon) and **three in core** (T3 `assertShapeValid`, T4 `parseOps`, T5 the
group-apply locators) — and this section is an index rather than a second copy: **the second
funnel** (`runMember`) and its source-scan pin are §22.6; **the two named gate envs**
(`namedDispatch` computed, `NAMED_RENDER` modal-blind by decision) and the widened
`GateVerdict` are §22.6 as well; **the daemon's `Origin` refusal** is §2 with its code in §6;
**the validation boundary posture** — the daemon as the untrusted edge, `parseOps` as the
boundary — is §2. The three core-side halves
(`assertShapeValid` over all three brush shapes, `parseOps`' numeric interiors and the
`assertOpValid` = `assertOpStructure` + table-legs split, and the rejection locators on all
three committing paths) are in `core-modules.md`, under the field module and the § *oplog wire
format*.

### 25.1 The T4a exit — all six clauses

Verdicts re-derived at the tranche's head, each from the artifact rather than from the commit
that claimed it.

| Clause | Verdict |
| --- | --- |
| **1. One funnel — no bare `member.arm` outside it** | **HOLDS.** `grep -rn "member\.arm" packages/editor/src` returns **one** call site, `frontend/lib/actions.ts` inside `runMember`; the other three hits in that directory are `member.armed`, a rendering field. Held by machine rather than by review: `tests/actions.test.ts` walks `src/` for `\bmember\.arm\(` and asserts the caller list is exactly `["frontend/lib/actions.ts"]` — the file, deliberately, not `[]`, which would pass just as happily with the funnel deleted. A second scan holds the asymmetry's other half (`clickGate` has one caller, the display seam). **The instrument's limits are stated where it lives**: a source scan is a proxy, blind to a caller spelling the receiver differently and — since definition and caller share a file — to a second caller added inside `actions.ts`. |
| **2. Every refusal carries a machine-readable reason; no label fallback** | **HOLDS.** `GateVerdict`'s refusal arm is `{ ok: false; hint: string; spoken: boolean }` — `hint` is a non-nullable `string`, so the type makes a reasonless refusal unwriteable rather than discouraged, and `spoken` carries the display policy that the old `hint: string \| null` had been overloading. `refuseOrClaim` returns `refused(verdict.hint)` with no `?? def.label(ctx)` behind it; the grep finds the fallback only in the comment recording its removal. **The one surviving label was retired at T5**: the INERT case (`!def.enabled(ctx, input)`) answered `refused(def.label(ctx))` — argued then as "the verb's own name IS the honest reason, and no gate was consulted" — and the T4c gate walk falsified it live, an agent reading `{because:"inert", message:"Move"}` off `edit.grab`. It now answers `refused(def.inertHint ?? def.label(ctx), "inert")`, where `inertHint` is the ENABLING CONDITION as prose. The label survives only as the fallback for rows whose `enabled` is `() => true` and can never be inert. |
| **3. `confirmOpen` is computed truth for named callers** | **HOLDS FOR DISPATCH; one declared display exception.** Stated as PARTIAL rather than PASS on purpose: the clause says *named callers*, and `NAMED_RENDER` is literally a named caller carrying a hard-coded `false`. `namedDispatch(ctx)` builds `{ caller: "named", confirmOpen: ctx.isConfirmOpen() }` per call, and both dispatch funnels take it — `runNamed` and `runMember`. The constant `false` survives at exactly one env, `NAMED_RENDER`, which is not a dispatch env: `clickGate` → `controlVerdict` is the DISPLAY projection, and its modal-blindness is a decision with three arguments at source (a modal is an enforcement fact, `ToolRail`'s memo has no dep for a poll, and "display behaviour did not move" becomes a property rather than a coincidence). **One consequence is worth naming, and it is by design**: a control can render runnable while a dispatch of the same verb at that instant refuses. Invisible to a human (the modal's overlay) and correct for an agent (which is on the dispatch side). |
| **4. sphere / box / capsule numerically validated at `assertOpValid` AND `parseOps`** | **HOLDS.** `assertShapeValid` (`core/src/field/ops.ts`) covers all three members — finite centres and endpoints, finite POSITIVE radii and half-extents, zero rejected with the negatives — behind an exhaustiveness guard, so a fourth shape fails to compile rather than silently validating as a box. Both paths reach it through ONE definition rather than two agreeing copies: `assertOpStructure` calls it, `assertOpValid` is `assertOpStructure` + the table legs, and `parseOps` runs `assertOpStructure` on **both** of its brush decode paths (the native `decodeBrushOp` and `upgradeLegacyDig`, so an F1-era bake gets the same pass). That relation is what makes the load predicate a SUBSET of the commit predicate, so an op the editor could commit can never fail to load. |
| **5. An invalid op in a group means nothing applies** | **HOLDS as stated — and read the boundary of what it states.** All three committing paths run validate-the-whole-list-then-apply: `logApplyGroup`, `commitGenerator` and the reconfigure span builder. Pass 1 reads no store state, so a mid-list rejection leaves store, `log.ops`, both stacks and `nextId` untouched — and since T4a it NAMES the rejection: `field op group: ops[N] — <predicate message>` where the caller wrote the list, `commitGenerator: generator "<id>" — …` / `reconfigureGenerator: generator "<id>" — …` where nobody did and an index would address nothing openable, each with the original on `cause`. **What it does not cover, on any of the three:** an op that VALIDATES and then throws out of the applier strands earlier ops' writes with no entry describing them. That is a store-rollback design decision, not a validation gap; it is the residue the group-apply backlog entry was narrowed to and it stands open. |
| **6. Cross-origin requests get 403** | **HOLDS.** `assertLoopbackOrigin` (`daemon/origin.ts`) is `route`'s first statement, ahead of every branch AND ahead of parsing the target (§2), throwing `forbidden-origin` → 403 through the daemon's existing typed-envelope catch. Coverage splits by question: **`tests/origin.test.ts`** is the pure spelling table (**12** admitted rows, **14** refused, each carrying its reason, plus a row asserting the predicate and the assert agree), and **`tests/server.test.ts`** is the wiring — the refusal on **all five** route branches, because a check that had drifted into the POST branch would satisfy a POST-only suite, and the SSE case additionally asserts JSON since that branch hijacks the response and a late check would leak an open feed. Plus the loopback pass, the absent pass, and the order pin (a malformed cross-origin target answers 403, not 400). **Scope, restated because the code cannot enforce its own reading:** this is DNS-rebinding defence, not client authentication. |

**Backlog dispositions, re-derived from `git diff --name-status d134fd8b..HEAD -- docs/backlog/`
rather than from memory.** Two DELETED — `family-member-picks-bypass-the-dispatch-funnel.md`
(Task 1) and `field-brush-shape-numeric-validation.md` (Task 3). Two NARROWED rather than
closed, each retitled to its residue and re-measured at head:
`field-reconfigure-and-parse-edges.md` §"`parseOps` cannot resolve a class id" is now that —
it has no `MaterialTable`" (the half the seam genuinely cannot answer without a table it does
not take), and `oplog-group-apply-is-not-a-transaction.md` is now "Pass 2 of a group apply
does not roll the store back" (clause 5's stated boundary). **THREE FILED**, all surfaced
mid-tranche and left as findings rather than absorbed:
`core-internal-structure-debt.md` §"`field/artifact.ts` is four codecs in one file"
(four serialization formats in one file, found while working in `artifact.ts`), the same
file's §"One locator re-throw, spelled six times" (the
catch-and-relocate convention Task 5 generalised exists as six hand-written copies, already
diverging) and `field-reconfigure-and-parse-edges.md`
§"`reconfigureGenerator`'s empty-evaluation leg" (Task 5 pinned one of the two
failure classes `reconfigureGenerator`'s `@throws` names, not both). AGENTS.md asks that
end-of-tranche surfaced findings be summarised so the user can decide follow-ups; this is that
list, and it stood at one until the count was taken from the diff.

## 26. Foundations T4b — an agent reads a live session (2026-08-09)

The tranche where an agent first reads a furnace editing session **truthfully**. T4a made the
substrate honest with no agent connected (§25); this one connects one — and connects it to the
**READ half only**. Nothing an MCP client could call *at the close of this tranche* edited a
world, wrote a file or moved the human's camera — **T4c is where that stopped being true, one
section down**, and the sentence is kept in the past tense rather than deleted because the READ
half's design is what the rest of §26 argues.

Four things had to become true, in order, and each is a task's worth of work:

- the daemon had to know **which tab is authoring**, having never held a byte of session
  identity (§5.1);
- it had to be able to **ask that tab a question**, because every fact an agent wants about a
  live session lives in the other bundle (§26.1);
- it needed something worth asking for, with a **change cursor that admits what it misses**
  (`session.state`, §4; the cursor, §17.6);
- and it had to **advertise all of that in a protocol an agent already speaks** (§26.2).

The tranche opened on a fifth, ahead of any of them: T4a's own review had left `runMember` able
to claim a success it never delivered, and refusals with no machine-readable class. Both are
faults only a caller who cannot see the screen ever meets, so both closed **before** anything
agent-facing was mounted on top — `because: RefusalClass` (seven names: `modal`, `typing`,
`looking`, `menuOnly`, `session`, `inert`, `member`; required, no default) and an `arm` that
returns an `ActionResult` typed `Exclude<ActionResult, {kind:"failed"}>`. §22.6 carries both.

**This section is an index for everything that already had a home, and the record for the two
things that did not.** The claim table and the connection token are §5.1; the daemon's two
resident tables and the route ladder's new first branch are §2; the five `session.*` commands
and the forwarded-arguments decision are §4; the SSE feed's three addressed frames are §5; the
two new error codes and the MCP edge's `AGENT_REMEDY` are §6; the revision token and the change
guard that pays for it are §17.6; `shared/wire.ts` arriving as the first contract the daemon and
the chrome both *import* rather than mirror is §7's layer note. What lands **here** is the relay
itself (§26.1), the agent door (§26.2), and the exit table (§26.3).

**Measured at T4b's head, each from the artifact rather than from a commit message — and
every count below moved at T4c, which is one section down (§27's own measured block carries
the current figures).** The registry was
**13 commands** across five families (`grep -rn 'handlers\.set(' src/daemon/` returns fourteen
lines: eight named verbs in `handlers.ts`, five in `session-handlers.ts`, and the loop that
merges the second map into the first), and the chrome speaks **11** of them. `DaemonEvent`
has **6 arms** and `EVENT_TYPES` mirrors all six. `EditorErrorCode` went **8 → 10**
(`no-session` 409, `session-timeout` 504) and `HTTP_STATUS` covers all ten. The agent door
advertised **3 tools**. `FieldHost` went **65 → 66 members** — `cameraPose()` — which is the
whole facade delta: `historyRevision()` was added and deleted inside the same task, once
measurement showed a polled token answers ahead of the latched payload beside it. The suite was
**3057 pass / 1 skip / 0 fail across 359 files**, with **7 new test files** and two new helpers
(`tests/_helpers/mcp-probe.ts`, `tests/_helpers/daemon-feed.ts`).

**Human-visible surface, stated so the gate walk can be honest about it — five surfaces, and
they are the whole list** (the toast trio counting as one, since all three speak through the
same stack):

1. the **steal prompt** — a refused claim opens the existing `useConfirmDialog`;
2. the **claim-lost cover** — `components/ClaimLostOverlay.tsx`, terminal in three channels;
3. **claim-on-connect** — silent when it works, which is every time but a contended world;
4. **three toasts on the claim path** — `notify.error` when a claim fails for anything other
   than a conflict, `notify.error` when a steal fails, `notify.success` when one lands;
5. **one new daemon banner line** — `main.ts` printing `mcp  http://127.0.0.1:<port>/mcp`
   beside the chrome's URL, because the door's address is the one thing about it a human has
   to type somewhere else, and the path comes from `mcp.ts` so the banner cannot outlive a move.

All three toasts sit on commands that did not exist before, so **nothing a human could
previously see has moved**. Silence on a failed steal was the alternative and is refused on
the chrome's own established pattern: `useWorld`'s `runVerb` toasts BOTH outcomes of every
world verb, because a click that says nothing reads as a click that did nothing.

### 26.1 The backchannel — one ask, one id, one budget

`src/daemon/backchannel.ts` exists because of the two-bundle constraint. `project.get` and
`world.list` answer from disk with no tab open; **every other fact an agent wants — what is
selected, which tool is armed, where the camera points, what the history holds — lives in the
chrome's mirrors, in the browser.** The daemon cannot compute them, cannot cache them honestly
and must not guess. So it **relays**: one addressed `session-request` frame out to the claimed
connection, one `session.answer` POST back, correlated by `requestId`. **A relay with a
correlation table, never a reader** — `ask()` returns whatever the session said and the daemon
validates not one field of it, having no standing to police a shape neither half would learn
about from it.

**Every way an ask can end is a rejection that ARRIVES**, which is the whole point of the type
and the literal reading of the settled policy's *"a typed error, never a hang"*:

- **No claimed session, or more than one** → `no-session`, immediately, with the message
  carrying which. Many is **refused rather than resolved by picking**, because picking is the
  failure this tranche exists to avoid: an agent would read a tab the human is not in and
  nothing anywhere would say so. Two claimed tabs is a state the claim table allows by design
  (one claim per *world*), so it is a real branch, not a defensive one — and **the route that
  reaches it with ONE human at ONE keyboard is worth writing down, because it is not two
  people opening two editors.**

  **The stale claim key — CLOSED at T4c, and the shape is worth keeping because the fix is
  read off it.** Through T4b, `useSessionClaim`'s `onToken` claimed under
  `worldNameRef.current` **at token time** and a world switch deliberately did not re-claim.
  That cost nothing while nothing routed by the claim's world — Task 2's own reasoning, and
  true when it was written. Task 3 then made the GLOBAL claim COUNT load-bearing through
  `soleTarget()`, and the two composed: a tab that booted on the untitled scratch, claimed
  `null` and was then pointed at world `W` went on holding `null` while authoring `W`, so a
  SECOND tab opening `W` claimed it with **no conflict, no steal prompt and no toast** — and
  the daemon held two claims, making every later `session_state` the two-claims refusal with
  nothing anywhere explaining why. **A conflict test only works if the key is true.** (The
  key also un-lied itself at random: any reconnect re-read the world and re-keyed, and the
  `bun run edit` loop restarts the daemon on every source change, so which behaviour a user
  got depended on when they last saved a source file.)

  **What ships now.** `useSessionClaim` owns the authored world and re-claims under the new
  name the moment it changes; `editor-context.ts` carries the verb (`setAuthoredWorld`) down
  to `WorldProvider`, which calls it from the one effect that already tracked the name. The
  T4b ref went — a ref carries a value and what the claim needed was the EVENT. **One command
  does the re-key**, because `daemon/claims.ts` gives a connection at most one world and a
  successful claim of `W` drops `null` in the same step; `session.release` (which had no
  client method until now, on the argument that a tab which stops authoring is a tab that
  closed) is reached only on the REFUSED path, where the old key would otherwise survive and
  the fix would manufacture the very lie it exists to end. A LOST tab still never re-claims:
  the re-key is a second route into the same body, and the cover's guard is inside it.
  `tests/chrome/session-claim.test.tsx` §(a2) pins all five branches.

  **What did NOT change, and is not a defect:** two tabs on two DIFFERENT worlds are still
  two claims, and `session_state` still refuses. That is the claim table's design (one claim
  per world) and the refusal is the right answer — typed, immediate, and carrying a remedy a
  human can act on (*"close all but the tab you want driven"*), which is strictly better than
  picking one. What T4c removed is the case where the conflict was invisible because the key
  was wrong.
- **The connection departs mid-ask** → `no-session` **now**, not at the timeout. The two
  sentences send a caller to different places — a timeout says "it is slow, wait longer", this
  says "the tab you were reading closed" — and only the second is true and has a remedy. It also
  lands in milliseconds rather than ten seconds. The listener is registered by this module
  (`hub.onClose(abandonAsksOn)`) rather than by `server.ts`, unlike the claim table beside it:
  `Claims` knows nothing of hubs and must be wired from outside; this module is *handed* the
  hub, so watching it is its own business — one fewer line `startServer` can forget.
- **Silence** → `session-timeout` at `DEFAULT_ASK_TIMEOUT_MS` = **10 s**. The number is chosen
  against the CLIENT's floor, not against a feel for browser speed: Claude Code's per-request
  timer for an HTTP MCP server is 60 s and its config knobs can only *raise* it, so 60 s is a
  floor no client configuration goes under and 10 s is strictly inside it for every client.
  **The pin asserts the inequality, not the number.**
- **The session answers that it could not serve the method** → `internal`. The chrome supplies
  PROSE, never a code: `EditorErrorCode` is the daemon's closed union and the chrome is not one
  of its throwers, so the chrome says the sentence and the daemon decides the code — the same
  division `claims.ts` already keeps. Without this arm an unrecognised method would produce no
  answer and time out, and the route is routine rather than exotic: the `bun run edit` loop
  restarts the daemon on every source change while the tab keeps its bundle.
- **`params` that will not serialize** → `internal`. `hub.emitTo` is wrapped because
  `JSON.stringify` raises synchronously inside the frame builder, and a raw `TypeError` with
  `code: undefined` would escape a contract promising **three** codes while the entry sat out
  its full budget.

**Three codes across four clauses**, and the distinction is the one a caller branches on:
`no-session`, `session-timeout` and `internal` are the whole set `ask` can reject with —
`internal` covers two of the four clauses above (a chrome that refuses the method, and
`params` that will not serialize). `ask`'s `@throws` names them correctly; a comment beside
the emit guard said "four" by counting clauses, and is corrected in the same commit as this
section.

**One-shot is structural rather than remembered.** Every exit routes through `takePending`,
which removes the entry from the map *before* settling it — so a duplicate answer, a late one
that lost the race with its own timeout, and a forged `requestId` are the same harmless miss.
`session.answer` reports `{ delivered: false }` for all three rather than refusing: a late
answer is the routine race (the chrome cannot know its ask has timed out), and a 4xx would
manufacture a client-side failure for a tab that did exactly the right thing a moment late.

**The chrome's half is a registry, not a component.** `hooks/useSessionAnswer.ts` mounts at
`App` with `lib/session-answerers.ts` as a parameter, so a new method is a row rather than a
change to the wire. It renders nothing and notifies nothing. The seam **normalizes** rather than
narrows — `Promise.resolve(handler(…)).then(answer, refuse)` with the synchronous `catch` kept,
both arms load-bearing and pinned separately — because a seam that served only synchronous
answers would push a worker round trip into a fire-and-forget inside a sync body, i.e. the same
silence one door over. What makes async safe is the correlation id: answers may come back out of
order, which is what the table is for.

### 26.2 The agent door — three reads, guests only

> **This subsection is T4b's record and keeps T4b's numbers. The door is NINE rows since
> foundations T4c — five reads and four writes, each advertising a projection of the zod its
> command validates with — and §27.4 is its current shape. What survives verbatim is
> everything this subsection argues rather than counts: the one-branch route position, "every
> tool is a `dispatch()` call and computes nothing", `field.load`'s deliberate absence, the
> guest clause, the per-POST server-and-transport, and the SDK's measured per-process cost.
> The GUEST half of the title is still literally true — no `session.*` verb is projected, and
> a claim token remains unspellable through this door.**

`src/daemon/mcp.ts` is **one branch on the route ladder and one module behind it**, and its
whole mapping is a table of three rows: `session_state` → `session.state`, `world_list` →
`world.list`, `project_get` → `project.get`. **Every tool is a `dispatch()` call and computes
nothing.** A tool that computed anything would be a second author on an answer the registry
already owns, and §4's *"every client funnels through one validator"* would stop being literal
at the one edge where the caller is least trusted. Route position and the committed-response
guard are §2; the error mapping is §6.

**`field.load` is deliberately not projected**: it answers with a whole world — every chunk and
`.mat` sibling base64'd, plus the oplog — which is megabytes against a per-result budget
measured in tens of thousands of tokens. There is no honest way to hand that to an agent as
text, and a truncation would be a lie in the one direction this tranche exists to close. What a
trimmed world read looks like is T4c's question, and it is a design question rather than a
plumbing one.

**And no `session.*` verb is projected, which is the guest clause in one line.** `claim`,
`steal` and `release` are not absent because they would be dangerous — they are **unspellable**:
all three take a connection token minted *into* an SSE stream, and this door holds no stream, so
an MCP client can never present one structurally rather than by a check. `session.answer` is the
chrome's return leg and names a pending ask, not a caller. An agent therefore reads **through**
whichever session is claimed and can never become one; a call to an unadvertised name is refused
as a protocol error rather than an `isError` result, which is that same line. `readOnlyHint`
states the posture in the protocol's own vocabulary, and it is a *hint* by specification — at
T4b the guarantee behind it was that no mutating command was projected at all, and it was
hard-coded `true` for every row on exactly that reasoning. T4c Task 6 made it a property of the
ROW instead, which is what the hard-coding could not survive: see §27.4.

**A server and a transport per POST, closed in a `finally` through `allSettled`.** A stateless
transport cannot be reused in SDK 1.30.0 — the second request throws inside the SDK's own hono
listener and the client sees a bare 500 with an **empty body**, always on the second call and
never the first, so it survives every smoke test (measured on both runtimes at Task 0). A
stateful transport was the other shape and is fenced out on purpose: it serves exactly one
client, so it would need a table keyed by `Mcp-Session-Id` and **the daemon would then have two
session concepts**. The editor's one session is the SSE claim a human's tab holds; a per-request
transport is what keeps that literally true, and it buys the guest clause for free — two agents
are two independent POSTs reading through one human's claim.

**`MCP_INSTRUCTIONS` is 2,036 bytes** (pinned ≤ 2,048) and carries exactly four things an agent
that has never heard of furnace cannot infer, each chosen because not knowing it produces a
specific mistake: that the live half is **relayed** to a browser tab (without it a `no-session`
refusal reads as a broken server), the **claim model** (without it an agent watching two tabs
cannot tell the human what to do), that the **cursor is compare-only** (without it an agent
caches a payload against a token certifying one member of it), and that **`{ready:false}` is a
real answer** — the arm `shared/wire.ts` declares and this door really returns, which an agent
that read only the first three would meet as a payload carrying none of the fields promised one
line up.

**That fourth clause is INSURANCE, not a description of today, and `wire.ts` is explicit about
it: the arm is currently UNREACHABLE through the daemon.** Follow the gate: a tab is asked only
if it is claimed, it claims only after a token arrives, and the token arrives on a feed
`useDaemonFeed` opens only once `state.status === "ready"` — by which point `App` has assigned
the field host (synchronously, immediately before the dispatch that makes the editor ready) and
the shell has long since committed. Two network round trips stand between the commit that fills
the chrome's reader and the earliest possible ask. A tab that failed to boot (`engine-error`,
`no-webgpu` — both live states) never opens a feed at all and earns `no-session` instead, which
is the honest sentence and has a different remedy. So the chrome CAN spell `{ready:false}` and
today nothing relayed can receive it; the clause is in the instructions because it is the answer
that stays honest **when the gate moves**, which `wire.ts` names as the trigger — whoever opens
the feed before `ready` puts a permanently-not-ready tab behind an arm that reads as "still
starting" to a caller that will retry for ever, and owes it a reason field in the same change.
Its one reachable caller today is `tests/chrome/session-state.test.tsx`, which asks the registry
row directly. The tool descriptions carry the rest, where they are read next to the call.

**How to connect.** The daemon prints the URL at startup; `claude mcp add --transport http
furnace http://127.0.0.1:4500/mcp` registers it, and the tools then appear as
`mcp__furnace__session_state` and siblings — **the client namespaces by the key the human wrote
in its own config**, which is why the tool names here carry no prefix of their own and
`SERVER_INFO.name` identifies the server in logs rather than the tools. Under `--port 0` read
the port off the banner.

**The SDK has a price this tranche measured rather than paid.** Constructing *any* MCP SDK
`Protocol` object — `new Client(…)` or `new Server(…)`, no transport, no HTTP, no request —
inflates the wall clock of *the rest of that `bun test` process* by multiples, enough to drag
several `@furnace/core` budget tests over ceilings they otherwise clear by an order of
magnitude. (The per-run table is in the filed entry below, where it can be re-measured rather
than trusted; the figures are not restated here, because a wall clock is the one number a
reference doc has no way to keep true.) Eliminated by measurement rather than
argument (not the transport, not Ajv, not SSE, not `globalThis`, not GC, not module load —
`daemon/server.ts` imports the SDK on every run and the suite is unaffected with the door
mounted and unexercised). So `tests/mcp.test.ts` spawns `tests/_helpers/mcp-probe.ts` in a
**fresh runtime**, which performs every exchange and prints one JSON transcript the cases assert
on — the same remedy `tests/action-registry/node-door.test.ts` already uses for a different kind
of process pollution. Nothing in `src/` changed to accommodate it, and the whole table plus the
eliminations is filed under
`docs/backlog/editor-and-tooling/editor-test-harness-fragility.md`.

### 26.3 The T4b exit — all seven clauses

Verdicts re-derived at the tranche's head from the artifact, not from the commit that claimed
each one. **Clause 5 is the review session's to walk** and is the only one not closed here.

> **Clause 5 WAS walked, and its script is now a historical record — do not run it as a
> checklist.** The T4b review walked it against a real world and it found the defect T4c Task
> 5 fixed: the payload's `tool` and `gesture` were each truthful and the JOIN between them was
> not written down anywhere the agent could see, so the reviewing agent reported "dig armed"
> over a screen with nothing armed (§27.3). Both member names are GONE from the wire — the
> payload carries `armed` and `brush` — and step (b)'s *"lists exactly three tools … and no
> fourth"* is false at nine. The wording below is left byte-identical because it is what T4b
> asked for and what was actually walked; **the live walk is §27.5's, which supersedes it.**

| Clause | Verdict |
| --- | --- |
| **1. An MCP call with no claimed session returns a typed error, never a hang — timeout path included** | **HOLDS.** Every exit from `ask()` is a rejection that arrives (§26.1), and each has its own case. At the agent door: `tests/mcp.test.ts` *"session_state with no editor open refuses in a sentence an agent can act on"*. At the relay: `tests/backchannel.test.ts` *"no claimed session → `no-session` at once, with nothing written to anyone"*, *"two claimed sessions have no single one to speak for — refused, not picked"*, *"silence becomes a typed `session-timeout`, never a hang"*, *"the session's departure rejects its pending asks AT ONCE, with `no-session`"*, *"a departure abandons only ITS OWN pending asks"*. At the HTTP edge: `tests/server.test.ts` *"with no session claimed, `session.state` says so rather than hanging"*. The budget is pinned as an **inequality** against the client floor it must sit under (*"the default budget sits inside the client timer that would otherwise expire first"*), not as the literal 10 s. **One residue, stated rather than claimed away:** a chrome that REFUSES a method answers `internal` — indistinguishable at the code level from a daemon fault, with only `AGENT_REMEDY`'s sentence carrying the difference. Filed. |
| **2. Exactly one connection holds a world's claim; steal transfers it and the loser is told; nothing survives restart** | **HOLDS.** `tests/claims.test.ts` covers the table (*"one connection holds a world; a second is refused and changes nothing"*, *"a connection holds AT MOST ONE world — claiming a second releases the first"*, *"the untitled session is a KEY, distinct from every named world"*, *"steal transfers the claim and tells ONLY the connection that lost it"*, *"stealing an UNHELD world simply claims it, and notifies nobody"*). **Nothing survives restart is pinned by CONSTRUCTION, not by clearing** — *"a fresh hub/claims pair starts empty"* builds a second pair, which is what a restart is. `tests/server.test.ts` holds the wiring the module tests cannot see: *"a second session is refused, steals, and the loser is TOLD over its own feed"* and *"a hang-up frees the world for the NEXT connection, with no steal"* — the second exists **because sabotage found that cutting `server.ts`'s own `hub.onClose(… release …)` reddened nothing**, the module suite having built its own pair. The claim's liveness rests on a runtime defect this uncovered and fixed (`res.on("close")` never fires under Bun, §5.1), pinned per-half: *"the RESPONSE's departure alone releases"*, *"the REQUEST's departure alone releases"*, *"one departure is announced ONCE"*, and *"release is IDENTITY-CONDITIONAL: a late close cannot revoke a newer claim"*. |
| **3. The backchannel round-trips with correlation ids; concurrent asks never cross** | **HOLDS.** `tests/backchannel.test.ts` *"a question reaches the claimed session and its answer resolves the ask"* and *"two concurrent asks resolve to their OWN answers"* — swapping the two ids in the resolver reds that case **alone and by name**, which is what makes it a crossing test rather than a round-trip test twice. The frame is **addressed, not broadcast**, pinned by its negative (*"a request is ADDRESSED — a second subscriber never sees another session's question"*) and again end-to-end at the door (*"TWO agents read through ONE claim, and the unclaimed tab is never asked"*). One-shot is structural — `takePending` removes before settling — and pinned from both sides (*"a late answer settles nothing and is REPORTED as having settled nothing"*, *"a SECOND answer cannot settle a second ask"*, *"an invented requestId is accepted and delivers nothing"*). The **instance** wiring is pinned by `tests/server.test.ts`'s round trip, which reds if the seam is handed a backchannel built over a different hub or a different claim table — a hole Task 3 reported as un-reddened and Task 4 closed by building the far end. |
| **4. `session.state` reports the live chrome truthfully, with a cursor that changes on edit / undo / world-swap** | **HOLDS, and its boundary is pinned rather than merely stated.** `tests/chrome/session-state.test.tsx`: *"a mounted chrome answers what its mirrors actually hold"*, *"every mirror the payload names moves the answer"*, *"the live SESSION and the selected ENTITY are projected, not passed through"*, *"the payload is a COPY — no member aliases live chrome state"*, *"the CAMERA is POLLED at answer time — never mirrored, never on the ctx"* (with *"the ACTION CONTEXT did not grow a member for this"* pinned as a **type**, mutually, so a removed member reds as loudly as an added one), and *"an UNFILLED reader and a HOSTLESS chrome share one honest arm"* for the `{ready:false}` discriminant that makes a false claim of emptiness unspellable. Cursor motion is `tests/field-host-history.test.ts`: *"the token moves on a mutation, and an undo/redo round trip returns it"*, *"a NEW WORLD over an empty one still moves the token — and PUBLISHES"* (the world-swap leg, which also forced the change guard's three new terms), and *"`ops.length` is LOAD-BEARING — undo, then a mutation that mints no op"*. **What the cursor does NOT certify is pinned too**: it rides the history payload and certifies `history` alone, and its one reachable alias (freeze → ⌘Z → bake) is reproduced rather than described, in *"THE ONE ALIAS IT CARRIES, pinned so the gap cannot be forgotten"*. |
| **5. Claude Code end-to-end: connect, list, read truth** | **NOT CLOSED HERE — the REVIEW session walks it**, against the user's own daemon on a real world. It is the only clause no test can stand in for, because what it checks is that the payload matches what a *human* sees. The walk, and what a pass looks like: (a) start the editor (`bun run dungeon:editor`), open a world, and confirm the banner's second line prints `mcp  http://127.0.0.1:<port>/mcp`; (b) `claude mcp add --transport http furnace http://127.0.0.1:4500/mcp`, then a Claude Code session **lists exactly three tools** — `session_state`, `world_list`, `project_get` — and no fourth; (c) `session_state` returns `ready: true` and its `world`, `tool`, `gesture`, `selection` and `camera` **agree with what is on screen** — arm a different tool, select an entity, orbit, and read again to see each move; (d) kill the tab mid-call and the next call answers the **typed** `no-session` (fast) or `session-timeout` (at the budget) with `isError: true` and a remedy sentence — never a hang; (e) a **second** Claude Code client against the same daemon reads the same claim as a guest, and neither client can claim, steal or release. Any step that needs a source change fails the clause. *(The deferred HOLISTIC user gate stays at T4 close; this is the functional gate only.)* |
| **6. Advertisement round-trips validation for all six schemas** | **HOLDS, with one divergence stated rather than hidden.** `tests/action-registry/projection-round-trip.test.ts` is the first caller of `toJsonSchema` on an action at all, and **it compares VERDICTS, not shapes** — a case asserting the reflected document *looks like* the zod schema re-derives one side from the other and would keep agreeing while both drifted together. `admits()` reads the advertised document the way a client would (root `type`, `required`, each property's `type` and its bounds) and its answer must equal `safeParse().success` for the same value; every sample runs against **every** row, so no row is graded only on arguments tailored to it. A second case forbids agreement bought by reading less: every keyword the six documents carry must be one the reader interprets, and `admitsField` **throws** on an unreadable type rather than returning `false`, which would look like a refusal the advertisement made. **The divergence:** all six rows are `z.object`, which STRIPS unknown keys, and the reflected document carries no `additionalProperties` — so both *admit* a stray key and the compared verdicts agree, while the OUTPUT differs. That is a live posture split against the daemon's `z.strictObject` commands, it becomes agent-visible the moment T4c projects these rows, and it is filed rather than changed here (a behaviour change does not belong in a plumbing commit). |
| **7. `runMember` refuses unknown members, never claims false success, and every refusal carries a `because`** | **HOLDS.** The funnel takes an **id**, and resolution happens **before** the gate deliberately: an id no member answers to is a malformed *request*, and answering it with "finish the session first" would send the caller off to end a session and back to the same typo. `tests/actions.test.ts`: *"a member id no member answers to is `refused` as `member`, and names the ids that exist"*, *"an unknown member id is answered BEFORE the family's gate — a bad request, not a bad moment"*, and *"a stamp pick with no engine is `refused` — and a brush pick with no engine is not"* — the pair that pins the false-success fix at the ARM rather than as a blanket guard in the funnel, since Paint needs no host and a blanket guard would refuse it for a fact about a different family. The compiler holds the no-false-success rule rather than a docblock: `arm` returns `Exclude<ActionResult, {kind:"failed"}>`. The vocabulary is exhaustive by type — *"every refusal class is REACHABLE through a funnel, and answers with its own name"* is a `Record<RefusalClass, …>`, so an eighth class with no route producing it does not compile — and the one-funnel rule is a source scan asserting the caller list is exactly `["frontend/lib/actions.ts"]`. **The same false-`ok` shape survived ONE DOOR OVER and was filed rather than claimed closed**: the action table reached the host through `ctx.host?.` at 14 sites, ten action ids reachable pre-engine, and fixing it coherently touched five deliberate always-live stances. *Closed at T4c Task 3* — all 14 went through `handOffToHost`/`okAfterHost`, refusing `inert`; the five always-live stances were kept, since each argued about a host that EXISTS and has nothing to do, which is not an argument for answering `ok` when there is no host (§27.1). |

**Backlog dispositions, re-derived from `git diff --name-status 0e89327d~1..HEAD -- docs/backlog/`
rather than from memory: seven added, five modified.** **NONE DELETED** — the donor entry
(`editor-ai-integration-milestone.md`) was to delete at **T4c** with the disposition of its items 3
and 4, which are outside T4's scope, *and it did: the file is gone since T4c Task 7 and this
is the last section that names it as live — §27.5 carries the disposition of all four of its
items*; at T4b it carried a dated re-anchor instead, recording that its
item 1's READ half is built, that the backchannel its `viewport.capture` needed now exists, and
that the SDK zod probe ran (1.30.0 declares zod BOTH as a `dependencies` entry and as a
NON-optional peer, read from the SDK's own manifest — so the workspace's single instance rests
on that one zod satisfying `^3.25 || ^4.0`, and **the check is re-run on any zod bump**).
**Seven filed**, five of them mid-tranche by the tasks that
surfaced them: `named-run-bodies-claim-ok-with-no-host.md`, `refusal-class-has-no-input-arm.md`
and `member-id-is-a-display-label.md` (Task 1 — *all three RESOLVED and deleted at T4c Task 3;
named here as the historical record of what T4b filed, not as live paths*),
`read-only-chrome-for-an-unclaimed-session.md` (Task 2's declared narrowing of the settled
policy — this tranche ships steal plus the cover, because read-only is a per-control decision
across the whole shell and half of it would be worse than none),
`wire-contracts-are-hand-mirrored.md` (Task 3 — `shared/wire.ts` is shared where the other three
cross-boundary contracts are still hand-mirrored), and two at this seal:
`action-input-schemas-strip-what-commands-refuse.md` (clause 6's divergence) and
`backchannel-refusals-blur-two-causes.md` (clause 1's residue, plus the shutdown half —
`hub.close()` fires no close handlers, so a daemon shutdown leaves a pending ask to its unref'd
timer instead of telling it the daemon is gone; unreachable today, live the day an ask outlives
a restart). **Three appended to** rather than duplicated:
`editor-test-harness-fragility.md` (the SDK's per-process cost, the eliminations, and the three
programme-level fixes), `chrome-shape-follow-ons.md` (`useDaemonFeed` reached four positional
parameters), and `core-internal-structure-debt.md`
§"One locator re-throw, spelled six times", whose standing trigger was
**checked and did not fire** — the MCP edge converts a throw into a value rather than
re-throwing one and adds no locator, so it is still six sites, with T4c's mutation verbs named
as the clause's remaining live half. **One re-cited**: `world-verb-follow-ons.md`'s
`handlers.ts` line numbers, which the session family's split into `session-handlers.ts` moved.
Nothing was reclassified as "defer" without being written down, and nothing surfaced was
absorbed silently — this list is the summary AGENTS.md asks for at a tranche's end.

**Four things the whole-branch review surfaced that are NOT filed, recorded here so the T4c
opener meets them rather than rediscovering them.** Each is stated rather than filed because
none needs a design decision and every one of them is cheapest inside work already scheduled.

- **The 10 s budget has two spellings.** `session_state`'s agent-facing description hardcodes
  *"within 10 seconds"*; `DEFAULT_ASK_TIMEOUT_MS` is what decides, and the pin deliberately
  asserts the INEQUALITY against the client floor rather than the number (§26.3 clause 1). So
  a budget change moves the behaviour and leaves the advertisement lying. Pinning the
  description against the constant is a test change and belongs in whatever commit next moves
  the budget — not in a docs commit.
- ~~**Two deletion candidates**~~ — **one, now.** `session.release` was the first: no
  production caller, its only callers tests, and the argument for keeping it ("the claim's
  lifetime is only statable with both ends") the same argument `api.ts` used to REJECT giving
  it a client method. **T4c Task 0 answered it by USE rather than by deletion**: the claim
  re-keys on a world switch, a refused re-key is a real moment at which a tab must give up a
  claim without closing, and the release is what says so (§26.1). The remaining candidate
  stands: `session.ping` + `BASE_ANSWERERS` are a liveness probe with no production prober.
- **One terminal branch is untested**: a client that disconnects mid-call. It is reasoned from
  source, not pinned, and it belongs to the live walk rather than to a suite — clause 5's
  step (d) is the closest thing to it.
- **The SDK's per-process cost was removed from the TEST process, not from the daemon.** The
  measured multiple was eliminated by moving `Server` construction into a spawned probe; the
  production daemon still constructs a `Server` and a transport **per POST** (§26.2), and
  **nobody has measured a daemon that has actually served MCP traffic.** The gate session will
  have one running and an agent calling it, which is the cheapest place this can be found out.
  It is a note for the walk rather than a defect: nothing predicts a problem, and nothing has
  looked.


---

## 27. Foundations T4c — an agent builds a world (2026-08-10)

T4b gave an agent EYES: three read tools, a backchannel that relays a question into the
claimed tab, and a refusal vocabulary honest enough to branch on. T4c gives it HANDS. The
gate is one script end to end — `world_list → generate → edit_apply → session_query →
world save+bake → viewport_capture` — and what it needs is a way to write that is neither a
second engine API nor a puppet of the pointer.

**Seven commits, and the shape of the tranche is that the first three buy the last four.**
Task 0 took MSAA out of the editor, which sounds like housekeeping and is load-bearing: core's
`frame.renderToTexture` refuses any context whose sample count is not 1, so a `sampleCount: 4`
viewport could not be photographed with its OWN pipelines and a capture would have needed a
second set — the thing the research verdict says no shipped tool does. Task 1 gave the
off-screen pass lights and taught lines a second target, in core, because a capture that
borrows the viewport's composition has to be able to draw what the viewport draws. Task 2 spent
both: `field-capture.ts` composes the same frame at a chosen pose and reads it back. Then the
hands — Task 3's mutation seam, Task 4's spatial read, Task 5's armedness fix and presence —
and Task 6 advertised all of it truthfully.

**Where each task's record lives.** Tasks 0–2 recorded themselves in place, in the sections
they changed rather than here, because each moved an existing mechanism instead of adding one:
the claim re-key at **§26.1**, MSAA's exit at **§16.1** (`init`'s options), **§16.5** (the View
popover's departed switch) and **§17.1** (the CPU-pick argument that rested on it), the capture
module in **§21.5**'s roster and in `field-host-clusters.md` §2.8 (the render seam's split into
`compose` + `scene`), and the deleted AI-bindings register in **§19**. The subsections below
start at Task 3 — the first that adds a seam rather than moving one — and **§27.5 is the exit
table, the backlog walk and the gate handoff**.

**Measured at T4c's head, each from the artifact rather than from a commit message.** The
registry is **19 commands** (`grep -rn 'handlers\.set(' src/daemon/` returns twenty lines:
eight named verbs in `handlers.ts`, eleven in `session-handlers.ts`, and the loop that merges
the second map into the first), and the chrome speaks **12** of them — the seven it does not
are the relayed set, and §4 says why a chrome method for any of them would be a tab addressing
itself. `DaemonEvent` still has **6 arms** and `EditorErrorCode` still **10**: this tranche
added no wire event and no error code, which is the honest measure of how much of it rode
substrate that already existed. The agent door advertises **9 tools** (five reads, four
writes), whose descriptions total **7,082 bytes** and whose projected schemas total **6,312**;
`MCP_INSTRUCTIONS` is **1,970 bytes** against a pinned 2,048. `FieldHost` went **66 → 70
members** — `captureScene`, `applyOps`, `generate`, `query`, one per agent-facing capability
and no more — and `field-host.ts` grew **3,999 → 4,230 lines** while the directory went 43
files to **46**, all three new ones modules beside the facade rather than closure. `RefusalClass`
went **7 → 8 arms** (`input`). The suite is **3,201 pass / 1 skip / 0 fail**, from 3,057 at the
branch point.

### 27.1 The mutation seam — `applyOps`, `generate`, and the named-verb door (Task 3)

**Three doors, and only one of them is new machinery.** `edit.apply` and `generate` are
answerer rows over `fieldHostRef` reaching two new `FieldHost` members; `action.run` is a
door onto the 39 verbs the editor already had. All three are brokered commands on the
existing backchannel — same ask, same correlation table, same typed refusals — because a
write does not need a different relay from a read.

**`FieldHost.applyOps(ops)` is a composition, not a capability.** It rides
`field.logApplyGroup`, which core shipped at T4a with **zero editor consumers** and a TSDoc
naming this exact caller: *"A caller handing over a list it WROTE — a batched op stream
rather than a drawn gesture — has no other way to find the record to fix."* One batched verb
rather than one per op, deliberately: the group is ONE undo entry, so an agent's batch is one
⌘Z for the human. That is the **named-stroke guardrail**, and it buys the human's undo stack
back without needing op attribution — which is post-T4 and fenced.

**The failure posture is the whole design, and it is the OPPOSITE of the interactive one.**
`field-tool.ts`'s `commitToolOp` catches every setup-loud throw, reports it on the host's own
channel, and DROPS the op — right for a pointer drag, where a human is watching and a throw
out of `pointerdown` would strand the gesture mid-capture. None of that holds for a caller
with no canvas. `applyOps` **returns** its refusal, typed, and says nothing out loud: an
agent-caused refusal must not interrupt the person in the tab, which is T4b's ruling carried
forward. What it DOES copy is the two visibility lines — `markDirtyWithNeighbors` and
`notifyHistory` — because a write that skipped either would land in the store and be
invisible, and an agent's edit must be the same event to every surface as a human's.

**`generate` commits atomically and opens no session.** `startStamp` is the interactive
route and it opens one — or, with nothing selected, arms region-draw and waits for two clicks
that never come from a caller with no pointer. Worse than useless: a session left standing
refuses `world.bake` (whose `enabled` requires `ctx.session === null`) and every family key
with it, so the gate script would die at the step after this one. So `generate` calls
`field.commitGenerator` directly — what `commitStampSession` calls at the END of the
interactive path — and touches session state at no point. Every default is READ and never
invented: params from the def's own `defaults` (overlaid, so naming one keeps the rest), seed
from a fresh roll, region from the current selection. **With no region and no selection it
REFUSES** rather than inventing a box at the origin: `startStamp` has no third answer either,
and a silent guess at the one input that decides where the world changes is the class of
default that produces a confident commit in the wrong place. The outcome is the committed
record READ BACK — entity id, generator, seed, region, params — never an echo of the request,
so a caller that named no seed can still reproduce what it made.

**Both verbs refuse under a live stamp session, and it is one rule.** A session holds a
GHOST computed against the store as it stands; `commitStampSession` then commits from those
same inputs, so the ghost IS what will land — with one documented exception, a store that
moved underneath the preview. D-7 suspends the brush for the whole of a session, so the
interactive path cannot reach that state; a caller that is not the pointer is the only one
that can. `logApplyGroup` writes cells and `commitGenerator` writes cells, so the mechanism
does not distinguish the two verbs and neither does the refusal. A PENDING stamp is not a
session and deliberately does not block: nothing has been evaluated, so there is no ghost to
invalidate.

**The residue is declared, not fixed, by ruling.** `logApplyGroup`'s all-or-nothing covers
VALIDATION only — an op that clears `assertOpValid` and dies in the applier leaves earlier
writes in the store with no entry describing them. `applyOps` restates that and, since the T4c review, **tells the two
cases apart and answers them differently.** The discriminator is structural, not prose:
`logApplyGroup` wraps a pass-1 rejection with `cause` set and nothing else in that file sets
one, so `cause !== undefined` IS "validation refused this before touching the store". A
pass-1 rejection is `refused(…, "input")` — nothing moved, fix the op. A pass-2 applier throw
is **`failed`**, because the caller's argument is not what broke and the world is NOT fine,
and its message carries what no caller could otherwise discover: the ops before the failure
are written, unrecorded and UNMESHED (the dirty set exists only on the success path). An
earlier version lumped both onto `"input"` under a docblock asserting they *"cannot be told
apart"* — a claim the cited code disproves, and one that made the verb lie in exactly the
case that matters most.

**`generate` classifies differently, and the asymmetry is deliberate.** Its catch covers
`commitGenerator`, which reaches `def.evaluate` — arbitrary generator code — so the throws
behind it span the caller's params, a defect in the DEF (`emits` contradiction, an invalid op
in the evaluated span) and a bug in the generator itself. Those disagree about whose fault
they are, and nothing structural separates them (the two that most need separating both
arrive raw from `evaluateGenerator`). So the honest class is the one claiming nothing:
`failed`. Under `"input"` an agent meeting a broken def would retry with different params for
ever. The two causes `generate` CAN attribute — an unresolvable id and a missing region — are
settled before the call and keep `"input"`. Pass-2 rollback stays
`docs/backlog/engine-architecture/oplog-group-apply-is-not-a-transaction.md`'s, whose trigger
this task fired.

**`action-registry/` stopped being `field-host/`'s sibling and became a layer beneath it.**
`applyOps` answers an `ActionResult`, and `result.ts` puts that vocabulary below the chrome
precisely so non-chrome callers can hold it — *"there is ONE vocabulary of refusal in this
editor"*. A host-local result type converted in the chrome verb was the alternative and is
the second-name-for-a-subset that file argues against. The edge is **asserted rather than
merely permitted**: `tests/no-chrome-leakage.test.ts` now pins that `field-host/` imports
exactly `../action-registry/result.ts` from that directory and nothing else — the file, not
the barrel, so `schemas.ts`'s zod stays unreachable from the host's graph. Before this the
reverse direction was banned and this one was simply unguarded, which is the accident-of-file-
layout the repo's boundary rule exists to prevent.

**`RefusalClass` has eight arms.** `input` — *the ARGUMENT was wrong, and the world is fine*
— arrived with its first caller, exactly as its docblock said it would wait for. It is the
counterpart to `inert`: where that one says *change the state and ask again*, this says *ask
again differently*. The two refusals that were miscarrying `inert` moved (`useWorld`'s invalid
world name, `edit.delete`'s non-selected `entityId`), joined by every refusal the mutation
seam raises. `member` did NOT move and is the near miss worth naming: it is also about the
request, but it carries a LIST of what would have worked.

**The dispatcher ref is the one new chrome seam.** `runNamed` takes an `ActionCtx`; the
answerer registry holds a serialized projection and is memoized `[]` for the feed's stability
rule. So `action.run` travels through a `RefObject<(id, input?) => Promise<ActionResult>>`
that `ActionContextProvider` fills — `sessionStateRef`'s shape exactly, one verb over, and
for the same reason: the ctx is assembled far below the mount point. The two together are one
ref to READ the session and one to DRIVE it, both closing over the same ctx, so an agent's
picture and an agent's actions cannot come from different assemblies of the chrome. **The
created-above/filled-below precedent list therefore has FOUR members** — `bakeBusyRef`
(filled by the shell's world verbs), `viewportFocusRef` (installed by `CanvasHost`),
`sessionStateRef` and now `dispatchRef` (both filled by `ActionContextProvider`).
`fieldHostRef` is still not one of them, being a ref `App` owns end to end, and
`claimLostRef` is not either — it is written inside a hook `App` itself calls.

**`edit.apply` and `generate` are NOT registry rows, and that is a product decision.**
`CommandPalette.tsx` renders every descriptor, so a row would put "Apply ops" and "Generate"
in front of a human as commands they cannot meaningfully invoke — nobody types a JSON op list
into a command palette. What a row would have bought is the gate, and the host applies the
only clause of it that means anything for a write (the live-session refusal above). It would
also have forced `generate` to discard the entity id, since `ACTION_OK` is a payload-free
frozen singleton and widening it would make most of a 39-row table carry a meaningless field.

**`action.run` builds no allow-list, and holds one DENY-list.** Which ids EXIST is the
registry's answer and `runNamedById` is the one funnel that knows the table — it refuses an
unknown id as `input` and names the verbs that do exist, because the caller cannot see a
menu. Which ids are ADVERTISED is the MCP door's separate choice.

**`edit.undo` and `edit.redo` are FENCED at the daemon**, and that is a user ruling enforced
rather than a policy this layer invented. The tranche's stop condition — no agent undo verb —
was satisfied literally, and `action.run` then made it moot: a door that accepts `edit.undo`
IS an agent undo verb wearing a different spelling. Without op attribution the log is a bare
LIFO with no `origin` on an entry, so an agent's undo pops whatever is on top, routinely the
human's own stroke; undo and attribution are to be designed together, and the fence's message
says so and names the lift condition. It is **not** the second allow-list the plan forbade —
that was about not keeping a second copy of *which ids exist*; this is two ids the user ruled
out, named once, which cannot drift out of step with a registry it does not mirror. It lives
DAEMON-side rather than in the chrome's answerer because the `bun run edit` loop restarts the
daemon on every source change while an open tab keeps the bundle it booted with: a chrome-side
fence would hold only for tabs that did not need it. And it is a rule rather than a reliance
on `mcp.ts` listing three tools — advertisement is not enforcement, which is the gap this
tranche keeps closing elsewhere. (Task 6 proved that the hard way round: `action_run` IS
advertised, its `id` is a free string, so an agent really can name `edit.undo` — and meets
this set. §27.4.) The daemon validates the half it can: the six
verbs with an input schema have it applied from `action-registry/schemas.ts`, which makes the
daemon the **first consumer of that directory** — by relative path, so the export-map entry
still has no consumer and its trigger (an outside-the-package importer) has still not fired.

**A member id is data now, not copy.** `ToolFamilyMember.id` was the member's LABEL for four
of the five families, harmless while it was a React key and a cmdk value — and load-bearing
the moment T4b made it `runMember`'s caller-facing argument. It is `memberRefId(m.ref)` since
T4c: `dig`, `fill`, `paint`, `smooth`, `segment`, `box`, `material`, `void`. Two ids no longer
echo their labels (`material` is displayed "Wand", `void` is "Room"), which is the point. The
palette's cmdk `value` contains the id, so **its `keywords` carrying `member.label` became
load-bearing** rather than belt-and-braces — a human searching "Wand" matches only through
that, and dropping it degrades search while every other test stays green. Pinned for exactly
that reason.

**The 14 silent-ok host bodies are closed.** `handOffToHost`/`okAfterHost` replaced
`ctx.host?.` (joined at T5 by a third seam, `answeredByHost`, for the one host verb that
ANSWERS), refusing `inert` when the engine is not up — T4b's member-arm fix one door over,
with the precondition stated at the effect rather than in the funnel (a body reaching
`ctx.run` needs no host, so a blanket guard would refuse it for a fact about a different
family). The five deliberate `enabled: () => true` stances were KEPT: each argues about a host
that EXISTS and has nothing to do, which is not an argument for answering `ok` when there is
no host at all. `edit.delete` is the variant — its `okAfter` claim ("the confirm was raised")
was always honest, and what was wrong was raising a destructive prompt over a host that could
not serve the answer; resolving the host BEFORE the question makes that unreachable.

### 27.2 The spatial read — `session.query` (Task 4)

**The posture is the design, and it comes from evidence rather than taste.** *Ask this; do
not squint.* Task 2 gave the agent eyes; the eyes are for SEEING, not for MEASURING. An agent
must never read a rendered image to answer "is this prop resting on the floor" or "do these
two things interpenetrate" when the field can state it exactly. The tracked research
(`docs/research/2026-08-09-viewport-capture-technique.md`, point 4) is the source: VULCAN
(arxiv 2512.22351) answers floating and collision with ray probes and Set-of-Mark renders,
and its floating metric collapses from 0.711 to 0 without them. **Reads stay ahead of
writes** — Task 3 shipped the mutation verbs and this is what makes them checkable; the
gate's `verify` step does not exist without it.

**WHERE THE CONTACT DEFINITION LIVES, stated precisely because an earlier draft of this
paragraph overstated it.** At Task 4 it said *"the sentence is in the tool's own contract, not
only in this document"*, and there was no tool contract: `daemon/mcp.ts` projected three tools
with a hardcoded empty `inputSchema`, so `session_query` was not advertised at all and no
`.describe()` existed anywhere in `src/daemon/`. The definition lived in `FieldHost.query`'s
TSDoc, in `field-query.ts`'s `Query.answer`, and here — and **carrying it into
`session_query`'s tool description was named as Task 6's row**, at the declaration, with the
marker convention on it. Task 6 did it: the rule is restated in full in the advertised
description (§27.4), because a tool that says "ask me about contact" without saying what
contact MEANS hands an agent a boolean it cannot calibrate, which would leave "ask this, don't
squint" worth nothing to the only reader it is addressed to.

**ONE tool, parameterized on `about`** — `entities`, `ray`, `selection` at T4c, **five
since T5** (`entity` and `generators` joined; §28), and **six since sculpting-worlds cycle
2** (`flags`, the walkability advisor's findings; §28.2). Three tools would
have spent a third of the door's remaining room (a hard ceiling of ten, a planned set of
nine) on one concern. A `z.discriminatedUnion` is what makes a bad request report against the
arm it MEANT rather than "no union arm matched", which for three arms is the difference
between a fixable message and a riddle — and the trade got BETTER as the arms grew, which is
the test of whether it was a trade or a rationalisation: six questions, still one row, the
tenth slot still unspent.

**It lives in `field-host/field-query.ts`, and the placement was decided rather than
defaulted.** The plan left it open ("`frontend/lib/spatial-query.ts` or a field-host module").
Every answer derives from the LIVE store and LIVE log, so the module value-imports
`@furnace/core` (`raycastField` directly; `collisionCenter` behind `proxyCorners`) — and
`tests/frontend-no-engine-leakage.test.ts` fails such an import from any non-worker-entry
file under `src/frontend/` (the exemption is exactly `field-worker.ts` and
`analyzer-worker.ts`, which ARE separate bundles; a `lib/spatial-query.ts` would be neither).
The chrome version does not compile past the suite; this is a machine-enforced constraint,
not a preference. What the chrome holds is a serialized
projection, one latch per seam, which cannot answer a question about geometry it does not
have. `field-mutation.ts` met the same question a task earlier and landed the same way.
api-posture: **R1** (every export is a query — no resource, no lifecycle verb, one member),
**R3** (pure helpers take their inputs and no ctx; the seam takes state through `QueryDeps`),
**R8** (editor surface built ON core, reached through the barrel's declared surface),
**R9** (a read that cannot be answered THROWS — `[]` and "there is no session" are different
facts).

**The contact rule, stated because a caller has to act on it.** A prop is IN CONTACT when a
ray cast straight down from the centre of its proxy box's BASE finds a solid sample within
one CELL SIZE. Each half is chosen for determinism: the probe is a function of the prop's own
box and nothing else (no camera, no ordering); the one-cell tolerance is the answer's
RESOLUTION rather than a fudge factor, because `raycastField` reports the entry into the first
solid sample's cell and the extracted isosurface lies within one cell of it — anything tighter
would report lattice noise as a defect; and a prop BURIED in the floor reports contact at
`gap: 0`, since core's raycast hits its own start voxel at t=0 and "sunk in" is not the defect
being hunted. **Entities are not contact-probed at all**, and the asymmetry is not an
oversight: a carver's footprint is a volume of AIR it removed, so a downward probe from its
base hits the rock under the floor it just made — "in contact", always, for every hall. The
question has meaning for a thing PUT somewhere, which is a prop.

**The prop report is EXCEPTIONS, not a roster** — `total`, `scanned`, `floating`,
`overlapping`, `truncated`. A scatter emits hundreds of records; a row per prop is tens of
kilobytes of "this one is fine" for a reader whose whole question is which ones are not. Both
lists are the VULCAN metrics exactly, and both are empty on a clean world — the answer an
agent most often wants and the cheapest to read. `total`/`scanned` beside `truncated` are what
keep the empty lists honest: a silently-capped list reads as "no overlaps", which is the
single most damaging thing this verb could say.

**Two bounds, measured, and neither is silent.** `MAX_QUERY_PROPS = 2048` is a COST ceiling,
sized against the HUMAN's frame budget rather than the ask timeout — the read runs
synchronously on the tab's main thread, so an agent's question is paid for in the editor's
smoothness while somebody else is working in it. Measured (bun, 2026-08-10): the O(N²) pair
scan plus the full-reach contact probes total ~34 ms at 2048, ~96 ms at 4096 and ~319 ms at
8192, against the 100 ms interaction ceiling core's `materializeSelection` already cites. A
sort-and-sweep was weighed and rejected: it would not change the degenerate case (props
stacked at one X stay quadratic), which is precisely the case a bound has to survive, so the
bound does the work either way and the simple loop is what it was measured against.
`MAX_REPORTED = 32` is a separate SIZE ceiling on what is said — one number for both lists,
because they are one kind of thing.

**The selection answer never carries cells, and the spec is why that is a gain rather than a
compromise.** A flood may hold `MAX_SELECTION_BUDGET` = 262 144 cells; as coordinate triples
that is megabytes no agent can act on. What travels instead is core's REPLAYABLE
`SelectionSpec` — the same shape a selection-masked op embeds — plus `count`, `truncated` and
the metre `aabb`. An agent holding the spec can write an op acting on exactly those cells
without naming one. The cells were never the answer to "what is selected"; the spec is.
`SelectionInfo.displayed` is dropped in the projection: it says how much of a flood the
VIEWPORT draws as cubes, which is a fact about the human's screen.

**One new host seam member, and it is a pull beside a push.** `Selection.info()` returns the
same `SelectionInfo` the channel publishes, read synchronously — the channel serves a React
surface that re-renders when the selection moves, and the query is asked at an arbitrary
moment with no render to hang a subscription off. Both go through the one `selectionInfo`
builder, so the sentence an agent reads and the chip the human sees are one derivation.

**`SessionQueryRequest` is DECLARED ONCE and imported by both ends** — the first request type
on this wire that is, and deliberately unlike `ViewportCaptureRequest` and `GenerateRequest`,
which are hand-mirrored against their host twins. `shared/wire.ts` holds it and
`field-host/field-query.ts` type-imports it; the edge is legal and already worn
(`field-capture.ts` ← `shared/capture.ts`). The mirrors' docblock claimed the duplication was
"forced" because the wire cannot import the host — true, and not sufficient: the other
direction was available the whole time. That sentence is corrected in place rather than acted
on, because retrofitting a shipped contract with no defect behind it is churn.
`QUERY_SCHEMA_MATCHES_WIRE` pins the daemon's zod against that single declaration; it catches
a RETYPED field and a newly-REQUIRED one and misses optional add/remove/rename, per
`op-schema.ts`'s measured table (both catching directions sabotage-verified at this task).

**It writes nothing an answer depends on, and the code earns it rather than declaring it.**
Nothing on any of the three paths touches the store, the log or the undo stacks, and every box
handed out is a copy — the footprint memo is live host state that the camera framing and the
pick both read. The one hedge is exact: `deps.footprints()` fills `field-entities.ts`'s
signature-keyed memo of a pure log derivation, which changes nothing observable and is why
that dep is taken as a CALL. That is what makes the door's `readOnlyHint: true` on this row
(§27.4) true rather than aspirational — and the pin behind it compares chunk CONTENTS, not `chunks.size`, after the
review measured that a size check stays green over a write into an already-allocated chunk
(which is every chunk a probe walks through).

**Three guards were added at the review and each closed a hole a test could not see.** The
`about` dispatch is a `switch` with a `const _never: never = req` exhaustiveness binding — the
first cut ended on a bare `return entitiesAnswer()`, so a fourth arm added to the wire type
would have compiled clean and answered confidently about ENTITIES; the schema pin cannot cover
it either, because a narrower schema union stays assignable to a wider wire union. `dir` is
refused as the zero vector at the door: `z.number()` rejects `NaN`/`Infinity` but `[0,0,0]`
survived, and core normalizes by `hypot(...) || 1`, so it would have walked +X from the origin
and answered about a ray nobody cast. And `maxDist` is now CLAMPED in the host as well as
refused at the door — `MAX_PROBE_M` = 512 m, where `raycastField`'s own 4096-step ceiling would
otherwise start terminating walks early and a `null` would stop meaning "nothing there"
(`shared/field-limits.ts` carries the measurement and the worst-direction derivation). Until
the clamp, this module's central promise about `null` depended on a sibling door being in the
call path.

**`scanProps`, `findOverlaps` and `lint` are module-level and exported**, not closures — the
review's observation that they capture only the store, taken because the caps and the
truncation arithmetic are the logic most worth asserting exactly, and they were reachable only
through a 2 100-record fixture. `field-capture.ts`'s `capturePixels` is the precedent and its
docblock the argument. `lint` takes its `tolerance`, so the contact rule is assertable at more
than the editor's one cell size. **The entity list was still unbounded at T4c** where the prop
scan is capped twice — a payload-size risk rather than a frame-budget one, whose fix was a
shape decision rather than a slice. It was filed at the time and is now **closed**: T5 split
`{about:"entities"}` down to id + generator + footprint with a top-level `entityTotal`, and
added an `{about:"entity", entityId}` arm carrying what the fat row carried, for one entity.
The split IS the size answer — no numeric cap was added anywhere, because a cap would need a
measurement nobody has taken.

### 27.3 What is armed, who is here, and one Esc (Task 5)

**The armedness fix is what this task is FOR, and the defect was found by an agent, live.** At
the T4b gate walk the payload read `tool: {effect: "dig", …}` beside `gesture: "pointer"`; the
reviewing agent reported "dig armed" and the human was looking at a screen with nothing armed
but the Select button. Both fields were truthful. The whole answer was the JOIN — `gesture` is
the arming fact and `tool` is the dormant brush CONFIGURATION — and the rule for joining them
lived in a chrome hook's docblock the agent cannot see. It was filed as
`session-state-armedness-is-two-fields.md` with three candidate shapes and the instruction to
decide at T4c; the entry is deleted in this commit.

**The shape: one `armed` member, and `tool` renamed to `brush`.** `ArmedState`
(`src/shared/wire.ts`) is a discriminated union on `does` — `session`, `stampRegion`
(+`generator`), `selectEntity`, `selectCells` (+`mode`), `segment`, `brush` — and the wire
carries **no `gesture` slot at all**. That is the load-bearing half: keeping both would have
left the misreading available and added a third field to disagree over, and "two ways to spell
one thing" is the smell the repo's own design rule names. The dormant configuration keeps its
own member and is named for its dormancy: `brush` is a SETTING, true whether or not the brush
is what LMB strokes. The rejected candidate is the third one the entry listed — `tool: null`
while the pointer is armed — which answers "is it armed" by destroying the setting the agent's
own verbs manipulate.

**Three facts, not two, and the backlog entry named only two.** The chrome's own arming
predicate joins the STAGED GRAMMAR as well as the gesture slot (`lib/actions.ts`'s `idle`:
*"Either one owns the interaction, so no gesture family reads as armed while one stands"*). A
live session and a pending stamp arm each SHADOW the slot — LMB routes to them first while
they stand, and the slot goes on naming what the button does underneath. A member that
re-spelled `gesture` alone would have reproduced the identical misreading in exactly the states
an agent's own verbs create. The two shadows are mutually exclusive by construction
(`field-machine.ts`'s `startStamp` cancels a session before arming and clears an arm before
opening one), so their order in the join is a reading order rather than a priority. **The shadow rule has THREE sites, and the ORDER is now single-sourced across two of them.**
`shared/action-table.ts`'s `STATUS_PRECEDENCE` (`session` ▸ `pendingStamp` ▸ `gesture` ▸
`effect`) was already load-bearing — `deriveArmedKeymap` walks it for the status bar's keymap
line — so `armedFrom` walks the SAME tuple through an `ARMED_STATE` resolver table rather than
spelling a third cascade: the keymap the human reads and the payload the agent reads take their
order from one declaration, and a fifth member of the tuple is a compile error in both tables.
The third site is `actions.ts`'s `idle`, and it stays hand-kept with the full instruction on
it: it is a BOOLEAN (it cannot express an order), it feeds the tool rail's pressed state, and
deriving it from the wire's table would make a gate's refusal depend on the wire's vocabulary.

**The vocabulary cannot drift, and that is a compile-time property rather than a promise.**
`armedFrom` maps the slot through `Record<ViewportGesture, ArmedState>` written as an object
literal, so a seventh host gesture fails to build here rather than falling through to a default
arm. The two payload strings that are host vocabulary (`selectCells.mode`,
`stampRegion.generator`) stay `string`, which is the wire's standing anti-copy rule; `does` is
the wire's own closed union and is the one exception, argued at the declaration.

**`armed` is the ONE derived member in a projection whose stated property is that it derives
nothing** — and the exception is the rule read from the other side. Picking three fields and
leaving the far end to combine them is not "not deriving"; it is deriving in the one place
where the rule is invisible to whoever performs it.

**`session.interrupt` is the Esc key as a verb, and its limit is the whole of its contract.**
It calls `FieldHost.escape`, which drains exactly ONE rung of the recency-ordered capture stack
(§20.2) — a session, a stamp arm, a half-drawn box or segment anchor, the selected entity, the
cell selection. `FieldHost.escape` now RETURNS whether it cancelled anything (the canvas branch
always had the boolean; the facade discarded it), which is what makes the refusal writeable:
nothing standing is `refused` with `because: "inert"`, so an agent can tell a cancel from a
no-op. It **cannot** stop a bake, a save or an analyzer pass — there is no `AbortController`
anywhere in this editor, and a verb that accepted the call and did nothing would be worse than
one that does not exist; the honest answer for a long job is the ask budget's `session-timeout`.
Drain-one-rung was the planned scope and it is the shipped scope: a verb that emptied the stack
would take away states the HUMAN put there with nothing in the payload warning the agent it was
about to.

**Presence-lite: the chrome says an agent is here, and nothing else.** T4b's ruling was that
the backchannel is invisible; the half that stands is about REFUSALS and questions — an agent's
business must not interrupt the person in the tab, so no toast, either way. What changed is
that a T4c agent digs, generates and runs verbs, and a world changing under someone with no
sign that anyone else is working in it is a worse silence than the one that rule was written
against. So `lib/agent-presence.ts` records **that a verb ran and which one** — a framework-free
store on the `notify-store.ts` pattern — and `StatusBar`'s `AgentChip` shows `agent <verb> <n>`,
first in the right-anchored cluster (its text moves oftenest, and an element's width change
displaces only what is to its LEFT).

**The store is App's, not the module's**, and that is the one ownership decision in this
task that was made twice. A module singleton on `notify`'s pattern was written first; the full
suite failed within the task, because every chrome test file is a second shell in one process
and a case asserting "no agent has been here" read the verb an earlier FILE had recorded. The
chrome already has that rule written down — `useFieldHostState.tsx`'s cells are per provider,
*"never module-level: two shells in one process, which every chrome test file is, must not
share"* — and `notify` gets away with being a singleton only because its `clear()` has a
production caller for the suites to lean on. So `App` holds it in `useState` and it rides
`EditorContext` (the route `sessionStateRef` and `bakeBusyRef` already take), which makes
every test isolated by construction and the absence pin an ABSOLUTE rather than a delta.

Four things it deliberately is not, each a fence rather than an omission: it is **not a chat
surface**; it is **not an outcome channel** — `ran` takes no result, so a refused `edit.apply`
and an applied one are identical here, which is the quiet-refusals ruling built into the shape
rather than remembered at a call site; it is **not attribution** (that needs a `LogEntry` field
and is fenced to post-T4 with the agent undo verb); and it carries **no timestamp**, because a
fading indicator would have to answer "has the agent left?", which this substrate cannot —
an agent that stops asking is indistinguishable from one that is thinking, and the claim is
what actually knows. It is recorded AFTER the registry lookup, so a method the tab does not
serve (version skew) never reaches the bar: that is a refusal, not a verb.

**Two spellings of interrupt, and which one the door advertises.**
`action.run {id: "session.escape"}` reaches the same `FieldHost.escape`: it is a registry row
(the human's Cancel), never disabled, and not on `FENCED_ACTIONS`. The overlap is structural
rather than a slip — `action.run` is a door onto the whole 39-verb table by design, so every
registry verb has a second spelling through it — but the two are NOT equivalent, and the
difference is the reason the new verb exists: `session.escape` hands off and answers `ok`
whether or not anything was cancelled (`handOffToHost`'s contract is that the host answers for
itself on its own channel), while `session.interrupt` reads the boolean and refuses.
**`session_interrupt` is the advertised spelling; `session.escape` should not be named in the
`action_run` row's prose.** Neither is "fixed" into the other, and both directions were
considered: making the registry verb refuse would speak a PERSISTENT error toast at the human
every time they press Esc with nothing standing (`sayResult` speaks a refusal and errors hold
the screen until dismissed) — which is what that row's `enabled: () => true` and its *"an Esc
with nothing to cancel is a no-op rather than a refusal"* comment exist to protect; and fencing
it would spend `FENCED_ACTIONS` — which means *"an agent must not do this at all"*, undo
pending attribution — on a vocabulary preference, making the list mean two things.

**What Task 6 owed this task, and PAID.** At the close of Task 5 the `session_state` row and
`MCP_INSTRUCTIONS` still said *"which tool and gesture are armed"* — two members that no longer
existed — and the agent-facing prose is precisely where the last misreading came from. What was
owed was the RULE and not just a corrected field list: **`armed` is what LMB does right now;
`brush` is a standing SETTING and is NOT a claim that anything is armed.** Task 6 carried that
sentence into both places (§27.4's four discharged hand-offs), and `session_interrupt`'s row
gained its limit. The `MIGRATION (until T4c Task 6)` markers this paragraph used to point a
`grep` at were the mechanism for finding the set, and they came out with the work they marked —
`grep -rn "MIGRATION (until T4c Task 6)" packages/` returns **nothing**, which is the marker
convention working rather than a citation gone stale. The declarations that carry the rule now
are `shared/wire.ts`'s `SessionState`, `daemon/session-handlers.ts`'s `session.interrupt` (which
also carries the escape disposition above) and `daemon/mcp.ts`'s two rows; `tests/mcp.test.ts`'s
*"the four prose hand-offs the earlier tasks named are in the rows that owe them"* is what holds
them there now that no marker does.

### 27.4 The door grows — nine tools, schemas projected, the cull stated (Task 6)

**The set is nine and the ceiling is ten.** `session_state`, `world_list`, `project_get`,
`session_query`, `viewport_capture` (read) and `edit_apply`, `generate`, `action_run`,
`session_interrupt` (write). A model pays for every row it must consider on every turn, which
is why `session.query` is ONE parameterized read rather than three and why the tenth slot is
deliberately unspent: the next verb has to be worth the room it takes.

**Advertisement equals validation, structurally rather than by agreement.** Until this task
every row advertised a hand-written empty document (`NO_ARGUMENTS`) while `dispatch` enforced
a real schema — which worked only because all three commands took nothing. `createMcpDoor`
now resolves each row's command in the registry and PROJECTS that command's own zod through
`z.toJSONSchema(schema, {io: "input"})`. There is one object; the agent reads one projection
of it and the door enforces the other, so a hand-written second spelling cannot exist to
drift. Two consequences fall out of doing it at construction rather than per request: the
projection (nine documents, ~6.3 KB, one of them the whole brush-op vocabulary) is not redone
per POST, and a row naming a command the registry lacks is a STARTUP failure — which is what
lets `AGENT_REMEDY` say `unknown-command` is unreachable through this edge rather than merely
unlikely.

**`type: "object"` is hoisted over the one union-rooted row.** The SDK types
`Tool.inputSchema` as `z.object({type: z.literal("object"), …}).catchall(z.unknown())`
(read at `@modelcontextprotocol/sdk@1.30.0`), so `session.query`'s discriminated union —
which zod reflects as a bare `oneOf` — would be rejected on both sides without it. Hoisting
restates what every arm already says; the `catchall` carries the `oneOf` through. Anything
that is neither an object nor a union of objects throws at door construction rather than
being papered over with a `type` it does not have.

**The per-turn budget covers the prose as well as the row count.** The ceiling of ten exists
because every row a model must consider is paid for on every turn — and the nine descriptions
were **7,082** bytes at T4c against `MCP_INSTRUCTIONS`'s pinned 2 KB, riding the same
`tools/list`.
Pinning the discovery blurb and not the rows would have budgeted the cheaper surface and called
it discipline, so the description total is pinned at 8,192. **That was 6,004 bytes and 1.36×
head at Task 6; the T4c review spent 1,078 of the slack** correcting four rows that described
the door wrongly — `edit_apply`'s unconditional *"a bad batch changes nothing"*, the
live-session refusal neither write verb mentioned, `generate`'s *"a bad param is refused"* when
it answers `failed`, and `session_interrupt` advertising a retired fixed ladder over a
recency stack. That left **1.157×**, which still admitted a tenth row at the median length
(870). **T5 spent 420 more and that headroom is gone** — 7,502 / 8,192 at T5, 1.092×, with
690 bytes left. **Cycle 2's flags arm spent 363 more**: head is **7,865 / 8,192**, 1.042×,
with **327 bytes left, shorter than seven of the nine rows**, so the PROSE CAP is now the
binding constraint on a tenth tool before the ceiling of ten is (§28.2 measures both).
A TOTAL rather than a per-row cap, because
`session_query`'s row genuinely is a wall and it is the one length this door had to buy. The projected schemas (6,312 bytes, over half of it `edit_apply`'s op
vocabulary) ride the same response and are deliberately uncapped — they are
derived rather than authored, so a ceiling there would be a ceiling on the engine's op
vocabulary wearing a budget's clothes.

**`readOnlyHint` became a property of the ROW.** It was hard-coded `true` for every tool,
which is exactly the shape that would have gone on claiming read-only over four writes. The
five reads carry it; the four writes carry no `annotations` object at all, because the
specification's default for an absent hint is already "not read-only" and an explicit `false`
would be a second spelling of one fact. `session_interrupt` counts as a WRITE: it changes the
human's interaction state.

**`viewport_capture` answers an IMAGE block.** `shared/wire.ts` had assigned the decode to
this door — the chrome base64s the PNG because a `SessionAnswer` is JSON and JSON has no
bytes — and `ToolRow.present` is where it landed. The `png` member is destructured OUT and
everything else (`width`, `height`, `view`) rides a text block beside the image, so the base64
is carried exactly once. Left as text it would have been roughly a megabyte in a model's
context per call, with `isError: false` the whole time.

**The tuple bug, which is the reason this task's pins are about REFLECTION rather than about
editing.** `z.tuple([n,n,n])` projects to `prefixItems` and NO length keyword — measured on
zod 4.4.3 — and `prefixItems` alone constrains nothing. So every vector on this wire was
advertised as an array of any length while `dispatch` demanded exactly three: the
advertisement LOOSER than the validator, which is the single defect the projection exists to
make impossible. `op-schema.ts`'s `vec3` had even carried a docblock claiming the opposite
("tuple … so the ADVERTISED JSON Schema says 'exactly three numbers'"). Both `vec3` and
`session-handlers.ts`'s `point3` now restate the bounds through `.meta({minItems, maxItems})`,
which zod hoists onto the same node and which does not touch parsing; switching to
`z.array().length(3)` would have projected correctly on its own but infers `number[]` and so
would have cost both daemon drift pins. `generate`'s region took `point3` in the same move
(it had two more inline three-tuples). The pin is a KEYWORD INVENTORY over all nine documents
plus a "no `prefixItems` without matching length" rule, so the next lossily-reflected
construct reds before an agent reads it.

**THREE RULES THIS DOOR ENFORCES THAT ITS DOCUMENT CANNOT STATE**, counted rather than
mentioned, because "there is one" was the first draft of this paragraph and it was short by
two. Each fails to project for a different reason, all three refuse at the wire, and the probe
enumerates them so a fourth arriving unlisted is the thing that shows up.
(1) **A zero direction vector** — JSON Schema has no "not this value", so `direction3`'s
refinement rides `.describe()` and the suite pins the description as well as the refusal.
(2) **A fenced action id** — `FENCED_ACTIONS` is a rule inside `action.run`'s handler over a
free-string `id`; enumerating the fenced ids in the schema would make the deny-list a wire
contract two places have to agree about. (3) **A stray key on an action row's `input`** —
`action_run` advertises `input` as `unknown`, which is exactly what its own schema says and
what is TRUE for the 33 bare verbs; the six that take an object are parsed one layer deeper
against `ACTION_INPUT_SCHEMAS`, and a per-id `oneOf` in the document would be a lie for the
other 33. All three are honest in the prose an agent reads, which is what a caller has instead
of a keyword.

**The four hand-offs the earlier tasks left, discharged.** (1) The READS-ONLY closing line is
gone from `MCP_INSTRUCTIONS`, and its absence is now asserted — a door with hands that tells
an agent "nothing here edits a world" is worse than one that says nothing, because that
sentence is acted on. (2) The armedness RULE reaches the agent in both places: *"`armed` is
what LMB does right now; `brush` is a standing SETTING and is NOT a claim that anything is
armed"*. (3) `session_interrupt`'s row carries its limit — one rung, and no bake, save, remesh
or analyzer pass can be stopped, because nothing in this editor is abortable. (4)
`session_query`'s row carries the CONTACT rule verbatim from `field-query.ts`: a ray straight
down from the centre of the prop's proxy-box base, solid within one cell size, entities
deliberately not probed. `action_run`'s prose does NOT name `session.escape`, which is Task
5's disposition made machine-checkable.

**`z.object` → `z.strictObject` across the six action rows** (`action-input-schemas-strip-what-commands-refuse`,
resolved), at the trigger that entry named: the moment those ids became agent-reachable. Two
doors into one editor had two postures — every daemon command REFUSES an undeclared key, the
action rows STRIPPED one — and the stripping half is the worse half because it is
indistinguishable from success. The advertisement grew `additionalProperties: false` with
them, which fired the door `projection-round-trip.test.ts` predicted in as many words; its
reader learned the keyword and `PAIRS_ADMITTED` fell 13 → 6, to exactly one admission per row.
No chrome caller is affected: `runAction` hands a typed input straight to the run, and
`daemon/session-handlers.ts` is the only `safeParse` caller in the tree. The wire-level pin is
in the door's own probe (`action_run {id:"world.saveAs", input:{name, nope}}` must be refused
NAMING the key) rather than only in the isolated-schema round trip — the posture is the change
in this commit most likely to be reverted later as a style nit, and the round trip never
touches the door.

**`FurnaceMeta` is core's, in `core/registry` beside the `z` its writers build with**
(`furnace-vendor-keys-untyped`, resolved). The `furnace` vendor key had three writers
(`generators.ts` ×4, `scatter.ts`, `cave.ts`) and two readers (the inspector, and now the
door shipping a `paramSchema`) and NO declaration — so `{ unti: "m" }` type-checked, projected
and silently rendered no suffix. Each site spells `satisfies FurnaceMeta`; the editor's
`JsonSchemaNode.furnace` takes the same type by `import type` (which the leakage scan excludes
by design) rather than re-declaring it.

**`AGENT_REMEDY`'s reachability claim was wrong and is corrected.** It predicted T4c would make
four more codes reachable. The tranche tripled the table and the reachable set did not move:
still `no-session`, `session-timeout`, `internal`, `invalid-input`. The near-miss is
`action_run` reaching `world.makeDefault` — but through the CHROME's own HTTP client, so the
`not-found` is thrown one bundle away and arrives here as a relayed `ActionResult`, not as this
edge's throw.

**Two gaps recorded rather than closed.** `generate` advertises `params` as a free-form object
because that is what `dispatch` enforces, and an agent has no route to a generator's
`paramSchema` — `listGenerators` is a `FieldHost` method and reaching it is a seam plus a tenth
tool, not an advertisement (filed at T4c as `agent-cannot-read-generator-params`, with the gate
walk as its trigger). Mitigated in the same commit: every param has a default, so a params-free
call is complete, and `generatorById` now names the registered ids in its refusal. The second is
the zero-direction gap above. **The first gap is since closed** — T5 gave `session_query` an
`{about:"generators"}` arm relaying `FieldHost.listGenerators()` (id, name, param schema,
defaults, `placesProps`, `usesSeed`), which is the read this paragraph says the agent lacked; a
tenth tool stayed declined.

**The cull is stated — then re-ruled.** `core-zero-consumer-module-exports` carried the
projected vocabulary — what the nine rows advertise and what they relay back. As written at
T4c the entry framed T5's job as subtraction (everything the list does not name = a deletion
candidate); the T5 opening discussion (2026-08-11) retired that rule as too extreme — core is
a capability library for unknown consumers, and the door is one consumer, not the definition
of the surface. T5 instead ran a keep-by-default classification audit (keep / cookbook debt /
delete-with-a-per-name-argument). The ruling's durable statement is
`docs/learnings/seals/README.md` §Writing a seal — an orphaned name is "a candidate for
JUDGEMENT, not for the bin", recorded "to feed a later classification audit, **never to trigger
automatic deletion**" — and T5 Task 7's audit is its resolution: 418 exported names, 161
zero-consumer, **150 keep / 10 cookbook-debt / 1 delete**, with the surviving debt at
`docs/backlog/engine-architecture/cookbook-debt-kcc-collision-events-shader-composition.md`
and the outcome recorded at `docs/reference/core-modules.md`. The entry itself is closed and
deleted, its job done. What the door's
list still establishes: it projects no renderer, camera, material, shader, binding,
post-effect, physics or mesh vocabulary at all — so for those names it is simply silent
evidence, neither protection nor deletion warrant.

### 27.5 The T4c exit — eight clauses, the backlog walk, and the gate handoff (Task 7)

Verdicts re-derived at the tranche's head from the artifact, never from the commit that
claimed each one. Every clause carries a command a reader can run to check it, and where a
clause is only partly met the table says which part. **Clause 1 was written here as the review
session's to walk and was left unclaimed; the review then WALKED it and it passed** — that
result is folded into the row below at foundations T5, because it had lived only in the seal
and this table is where a reader looks for it.

| Clause | Verdict | Evidence |
| --- | --- | --- |
| **1. An agent session builds a small world end to end through MCP — generate, dig, bake, capture — with the measures recorded** | **WALKED LIVE, PASSED, MEASURED (2026-08-11).** *(This row read "PENDING THE REVIEW WALK" until foundations T5's citation sweep — it was written by T4c Task 7 BEFORE the walk and the walk's result landed in the seal instead of here, which is the one place a reader of this table would look.)* Ten tool calls, zero errors, against the user's claimed Safari session on the real dungeon project, and it is the clause no test can stand in for: what it checks is that a model holding only the nine advertised descriptions can compose the calls in the right order and read its own results. **The distinct gate that did NOT pass is gate 2, the holistic USER VISUAL walk** — PARTIAL, then waived to daily use by user ruling; the dig/paint/bake regression pass and the `sampleCount: 1` AA eyeball were not delivered, and the seal says in as many words that it does not record a passed visual gate. The renders-clean scar rule still stands. | `docs/learnings/seals/2026-08-11-foundations-t4c-verbs-eyes-gate.md`, which banks the measurements: `generate` (cave, defaults) **28 ms** · `edit_apply` (a three-sphere dig batch = one undo entry) **13 ms** · a geometric ray verify **13 ms** · `world.saveAs` + `world.bake` **~1.1 s** each · two `viewport_capture`s **38–45 ms** returning MCP image blocks (87/120 KB PNGs, 1024×556, **~750 vision tokens** each), visually verified by the reviewing agent. **Two firsts are in those numbers**: a daemon under real MCP traffic (the per-POST server construction is invisible in the timings — caveat 2 below is answered for one session, not retired) and the 2-D-canvas PNG encoder on Safari/wry, clean. To re-walk: `bun run dungeon:editor`, `claude mcp add --transport http furnace http://127.0.0.1:4500/mcp`, then `world_list → generate → edit_apply → session_query → action_run {id:"world.saveAs"} → action_run {id:"world.bake"} → viewport_capture` — **on a SCRATCH world**, which is the walk-design lesson this one recorded (building into `huge` made the delta invisible). |
| **2. Every mutation enters through validated batched ops = one undo entry each, refusals typed with `because` and locators** | **HOLDS.** `logApplyGroup` validates the whole list before any store write and pushes exactly ONE entry, so an agent's batch is one ⌘Z for the human — the named-stroke guardrail, which is what buys undo safety without op attribution (fenced to post-T4). Refusals are RETURNED, never toasted, and carry core's own indexed locator (`field op group: ops[2] — …`) unreworded, because the ops carry no ids until pass 2 and the list position is the only address a caller can act on. `RefusalClass` gained `input` with its first caller. **The declared residue, which is a real limit and not a formality:** pass-2 rollback does not exist — an op that clears validation and dies in the applier leaves earlier writes in the store, unrecorded and UNMESHED. That case answers `failed` (not `input`), and its message says so; the entry stays open. | `bun test packages/editor/tests/field-host/mutation.test.ts` — 16 cases, including *"an agent's batch is ONE undo step for the human"*, *"an invalid op is REFUSED naming ops[N], as `input`, with nothing written"* and *"a pass-1 rejection and a pass-2 failure are told apart STRUCTURALLY"*. Relay half: `bun test packages/editor/tests/session-mutation.test.ts`. |
| **3. `generate` leaves no ghost** | **HOLDS.** It calls `field.commitGenerator` directly — what `commitStampSession` calls at the END of the interactive path — and touches session state at no point, so there is no state for it to leak. This is the clause with the most immediate consequence for clause 1: a session left standing refuses `world.bake` (whose `enabled` requires `ctx.session === null`) and every family key with it, so a ghost here would kill the gate script one step later. | `bun test packages/editor/tests/field-host/mutation.test.ts -t "leaves NO stamp session"`. |
| **4. Capture matches the viewport (lights + overlays) at a chosen pose without touching the human's camera** | **HOLDS, and the pose half is the pin that mattered.** The capture composes through the same `field-render.ts` `compose` the live frame uses, with the same `sceneLights()` and the same line batches, into an off-screen texture — so "matches the viewport" is a shared code path rather than a resemblance. A named pose derives a camera and **mutates no input**: the rig is asserted byte-identical after a posed capture. Overlays default on and `overlays: false` removes exactly the line passes. | `bun test packages/editor/tests/field-capture.gpu.test.ts` — *"capturePixels: LIT — the ONLY variable is the light list"*, *"OVERLAYS — the line passes are there, and `overlays:false` removes exactly them"*, *"captureScene: THE COLLABORATION CONSTRAINT — a posed capture leaves the rig byte-identical"*. Pure half: `bun test packages/editor/tests/field-host/field-capture.test.ts`. |
| **5. Contact/floating answered geometrically** | **HOLDS for props, and the asymmetry is a decision rather than a gap.** A prop is IN CONTACT when a ray cast straight down from the centre of its proxy box's BASE finds a solid sample within one cell size — a function of the prop's own box and nothing else, so no camera and no ordering enters the answer. **Entities are deliberately NOT contact-probed**: a carver's footprint is a volume of air it removed, so a downward probe from its base hits the rock under the floor it just made and reports contact for every hall ever dug. The rule is carried verbatim into the advertised tool description, which is where a caller reads it. Both lists are exceptions rather than rosters, both capped, and `truncated` is what keeps an empty list honest. | `bun test packages/editor/tests/field-host/query.test.ts` — *"PIN: a deliberately-overlapping pair reports its overlap"*, *"PIN: a floating prop reports no floor contact, and a resting one does not appear"*, *"the read WRITES NOTHING"*. Door half: `bun test packages/editor/tests/session-query.test.ts`. |
| **6. The door advertises real schemas per row, ≤10 tools, instructions ≤2KB, no false `readOnlyHint`** | **HOLDS on all four, measured.** **Nine** rows against a ceiling of ten, the tenth deliberately unspent. Every row's document is `z.toJSONSchema` over the command's own zod, resolved at door CONSTRUCTION — so a row naming a command the registry lacks is a startup failure, which is what makes `unknown-command` structurally unreachable (§6). `MCP_INSTRUCTIONS` is **1,970 bytes** against a pinned 2,048, and the row descriptions (**7,082 bytes** at T4c; **7,502** at T5; **7,865** at cycle 2's head, still under) are pinned too, at 8,192, because budgeting only the cheaper surface would have been discipline in name. `readOnlyHint: true` on the five reads; the four writes carry no `annotations` object at all, the specification's default for an absent hint already being "not read-only". **Three rules the document cannot state** (a zero direction vector, a fenced action id, a stray key on an action row's `input`) are enumerated in the probe so a fourth arriving unlisted shows up. | `bun test packages/editor/tests/mcp.test.ts` — **19 cases** at cycle 2's head (17 when this row was written; the count is that command's own output) through a real SDK client in a spawned runtime, including *"tools/list advertises the nine, with readOnlyHint per ROW"*, *"the advertised documents say nothing this suite cannot read — and no tuple lies about its length"* and *"every bound the document states is a bound dispatch enforces"*. |
| **7. The donor entry is GONE with items 3/4 dispositioned** | **HOLDS.** `docs/backlog/editor-and-tooling/editor-ai-integration-milestone.md` (gone) is deleted. Item 1 (inbound MCP) shipped across T4b + T4c; item 2 (`viewport.capture`) shipped at T4c Task 2; **item 3 (the embedded agent) is DROPPED** with the supersession recorded below and in this commit's message; **item 4 (outbound editor→LLM) is re-filed** at `docs/backlog/editor-and-tooling/outbound-llm-editor-features.md` with a trigger that can fire. Every citation was re-pointed in the same commit — and the honest statement is that the NAME survives its file on purpose, never as a live path. | `test ! -f docs/backlog/editor-and-tooling/editor-ai-integration-milestone.md` (gone) proves the deletion. Then `grep -rn "editor-ai-integration-milestone" docs packages/*/README.md --exclude-dir=superpowers` — **11 hits, and it deliberately does NOT return nothing.** (The `--exclude-dir` is load-bearing rather than tidy: `docs/superpowers/` is gitignored plan scaffolding and adds 14 more hits that are nobody's to maintain.) Every one of the 11 is one of three kinds, and the counts are the check: **five in this document** (§19, §26.3, and §27.5 ×3 — recording what was deleted and where its contents went); **four former-home annotations** (`read-only-chrome-for-an-unclaimed-session.md` ×2, which quotes the claim policy the donor was the only home for, `editor-backend-architecture.md`, and `outbound-llm-editor-features.md`'s provenance line); and **two dated records keeping their original wording** (`docs/research/2026-07-06-editor-cockpit-audit.md`, `docs/learnings/seals/2026-07-06-pre-3.2-package-record.md`). A twelfth hit, or any hit presenting it as a live register, is the failure. |
| **8. MSAA is gone from the editor and the claim re-keys on world switch** | **HOLDS, and the two halves are unrelated warm-ups that shared a commit.** The editor's context is `sampleCount: 1` at the single site that requests one; `init` takes the canvas and nothing else; the View popover's AA switch, `ViewState.sampleCount`, `setSampleCount` and the `FieldCanvas` wrapper that existed only to read it are all deleted. **`packages/core` is untouched** — the engine keeps MSAA and hello-world still uses it; only the editor gave it up. The claim now re-keys: `useSessionClaim` owns the authored world, releases and re-claims on every change, and a REFUSED re-key releases what the tab left rather than holding a stale key. | `grep -rn "sampleCount" packages/editor/src` returns **9** lines and exactly **one** of them is code — `field-host.ts`'s `requestContext(canvas, { sampleCount: 1 })`; the other eight are the comments that record why the switch went, which is the intended residue rather than leftovers. The same grep over `packages/core/src` returns **65** lines, which is clause 8's other half stated as a measurement: core kept MSAA and only the editor gave it up. Claim: `bun test packages/editor/tests/chrome/session-claim.test.tsx` — *"loading a world RE-KEYS the claim"*, *"a REFUSED re-claim releases the world this tab left, then offers the steal"*, *"a LOST tab does not claim its way back in by switching worlds"*. |

**SIX THINGS THE GATE WALKER MUST KNOW BEFORE WALKING, stated here because clause 1 is the
only one that can discover them and a walker who meets them cold will misread them as
defects.** *(SEVEN now. The first walk has since been run — clause 1 above — so two of the six
no longer hold as written and say so at their own numbers, and item 7 is the thing that walk
itself taught. The list is kept for the NEXT walker.)* The whole-branch review surfaced five more of this shape; **four were fixed in the
door's own prose instead of being listed here, on the rule that the AGENT reads the door and
only the WALKER reads this document** — a caveat that protects the human walking the gate does
nothing for the model making the call. Those four were: `edit_apply`'s *"a bad batch changes
nothing"*, unconditionally true of validation and false of a pass-2 applier throw; both write
verbs refusing under a live stamp session, which neither row mentioned at all; `generate`'s
*"a bad param is refused"*, which actually reaches `failed` because the catch spans arbitrary
generator code; and `session_interrupt` advertising the RETIRED fixed ladder (five rungs in a
declared order) when the mechanism is `stack.pop()` over seven. All four are corrected in
`daemon/mcp.ts`, and the recency correction and the presence sentence below are now pinned in
`tests/mcp.test.ts`. The two that remain caveats are 5 and 6, and each says why it stayed one.

1. **An agent can CALL `generate` but cannot DISCOVER a generator's parameters.** The row
   advertises `params` as a free-form object, because that is exactly what `dispatch`
   enforces; core's `paramSchema` documents exist and are structured-clone-safe, but reaching
   them is a host seam plus a tenth tool rather than an advertisement. Mitigated in the same
   commit — every param has a default, so a params-free call is complete, and `generatorById`
   names the registered ids in its refusal — so the world an agent builds on defaults alone
   is a real world. **This was the one place clause 1's "builds a world" story was thinner than
   it read.** Filed with the walk itself as the trigger — and **CLOSED at T5** (§28.2). The
   walk had already run by then and never adjudicated it: the agent built on defaults, exactly
   as the mitigation predicted, so the gap was closed on the filing's own argument rather than
   on evidence from the walk. `session_query` gained an `{about:"generators"}` arm relaying
   every generator's id, name, param schema, defaults, `placesProps` and `usesSeed`, so an
   agent can now read the params it composes with.
2. **Nobody has measured a daemon that has actually served MCP traffic** — **true when this
   was written and no longer true; the residual is narrower and is what a walker should still
   carry.** The SDK's measured per-process cost was removed from the TEST process by moving
   construction into a spawned probe; the production daemon still constructs a `Server` and a
   transport **per POST** (§26.2). The 2026-08-11 walk banked the first data — ten calls, the
   per-POST construction invisible in timings of 13 ms to ~1.1 s (clause 1's evidence column).
   **What that does NOT answer is sustained or concurrent load**: one agent, ten calls, one
   session. Nothing predicts a problem; one session's worth of evidence is not a load test.
3. **The viewport is `sampleCount: 1` now, and that has a visible cost.** Edges that were
   4× multisampled are not. It was a user ruling ("it's pointless") and the capture path
   depends on it, but the HOLISTIC USER VISUAL GATE deferred from T4a/T4b now also has to
   eyeball this — it is the one change in the tranche a human sees without asking for it.
4. **A refused agent write is deliberately silent on screen.** T4b's ruling carried forward:
   an agent's business must not interrupt the person in the tab, so `applyOps` returns its
   refusal and says nothing out loud. What the human DOES see is `StatusBar`'s `AgentChip` —
   `agent <verb> <n>` — which records that a verb ran and which one, and deliberately not
   whether it worked. So during the walk, a screen showing `agent edit.apply 7` is consistent
   with seven applied batches and with seven refused ones. Read the tool results, not the bar.
   **The door said the opposite until Task 7** — `MCP_INSTRUCTIONS` claimed *"neither your
   verbs nor your refusals are shown to them"*, written by Task 6 over the chip Task 5 had
   already built, and nobody reconciled the two. Half of it was always true and the half that
   was false is the half an agent acts on. Corrected, and pinned in both directions.
5. **`{ready:false}` is advertised, and is currently UNREACHABLE through the daemon.** The
   instructions tell an agent to branch on `ready` first, and `wire.ts` states plainly that no
   relayed question can receive that arm today: a tab is asked only if it is claimed, claims
   only after a token arrives, and the token arrives on a feed opened only once the editor is
   ready. A tab that never booted answers `no-session` instead — whose remedy says *do not
   poll*, which is the right advice and a different one. **Kept as a caveat rather than fixed
   in the door**, for two reasons that both cut the same way: the clause is deliberate
   INSURANCE (§26.2 — it is the answer that stays honest the day someone opens the feed
   earlier, and `wire.ts` names that as the trigger), and hedging it would spend ~73 of the
   78 bytes left under the 2 KB instruction pin to tell an agent about a payload it will not
   meet, changing no behaviour — "branch on `ready` first" is correct either way.
6. **The advisor, the studio rig and the capture share one light setup, so near-camera rock
   photographs white.** Not a defect and not new: the F4.5 gate accepted it as a tuning note
   on a rig that works (`editor-seams-and-preview-deferrals.md` §"The studio key light blows out geometry close to the camera"). What IS new is
   that the capture borrows that rig deliberately, so an agent now sees it too and may report
   it as a world defect. The cheap mitigation costs nothing and is a caller-side choice:
   capture from a named axis view rather than `user` when the subject is close.
7. **START ON A SCRATCH WORLD** — the seventh thing, learned by the 2026-08-11 walk rather
   than predicted before it. That walk built into `huge`, where the delta an agent made was
   invisible against everything already there, which is half of why the human could not FIND
   the cave (the other half was the entity list's missing order and the absent position
   readout — both filed, both answered at T5, §28.1). It is a walk-DESIGN lesson rather than a
   product defect, and it is the cheapest of the seven to act on.

**THE DONOR'S DISPOSITION, IN FULL — because after this commit there is no file to read it
in.** `editor-ai-integration-milestone.md` was filed 2026-06-11 when M4 was renamed from "MCP
command layer" to "command layer", and it carried four binding shapes plus three dated
re-anchors. Items 1 and 2 are built and their as-built is §26–§27. **Item 3, the embedded
agent — the daemon spawning an agent session and handing it the command registry as in-process
tools, the Cursor model — is DROPPED, superseded by the collaboration model this programme
actually built.** The editor is driven *through* a claimed session by an agent that lives
outside it: the claim belongs to a human's tab, the daemon relays into that tab, and an MCP
client is structurally a guest that can never claim, steal or release (§26.2). An embedded
agent inverts every one of those. It would make the daemon a process supervisor and an AI
client — a second session concept beside the SSE claim, a key to hold, a lifecycle to own —
to reach tools an outside agent already reaches over a documented protocol, with the human's
own tab as the arbiter. The one thing it would buy that the shipped model does not is a chat
surface inside the chrome; that is a UX feature that can be built against the same door if it
is ever wanted, and it is not a reason to host a model. **Item 4 is re-filed** (above).
**Three facts the donor was the only tracked home for, carried here so they do not die with
it:** (a) `@modelcontextprotocol/sdk@1.30.0` declares zod BOTH as a `dependencies` entry and
as a NON-optional peer (`^3.25 || ^4.0`, read from the SDK's own manifest, not the lockfile),
so the door's "exactly one zod in the tree" premise rests on the workspace zod satisfying that
range — **re-run the single-instance check on any zod bump**, because a workspace zod outside
it gets the SDK a second copy plus a peer warning; (b) `ToolDefinition.build` was deferred
WHOLE on the two-bundle constraint (§23.4), and with it the programme's own success criterion
*"adding a tool touches the tool module + registration only"* — **judged at foundations T5, and
the question turned out to be MALFORMED; the ruling is the block below**; (c) `ServiceDefinition` is `{ fn }` with
no schema field, so the programme's "service schemas arrive via the session handshake" has
nothing to carry them — and it is now moot rather than pending, because what shipped projects
COMMAND schemas and there is no handshake.

**Fact (b), RULED at foundations T5 (2026-08-11) — and the substance of the ruling is that the
question CONFLATES TWO REGISTRIES.** `ToolDefinition` / `ToolId` (`src/shared/tool-registry.ts`)
is the **interaction-tool** registry, the one §23.4 is about: `ToolId` is `"brush" | "segment"`,
**n = 2**, both `defineTool` calls sit inside the declaring file, and exactly two commits have
ever touched it. That is the population `build` was deferred FROM. The nine MCP tools are a
different table — `ToolRow` / `TOOLS` in `src/daemon/mcp.ts` (§27.4) — living in a third bundle
graph, the daemon on Node. And §23.4's constraint is the **chrome vs `/engine.js`** split
specifically: `build` for `segment` is `createSegmentBrush`, a value in
`field-host/field-segment.ts` whose value edge to `@furnace/core/field` runs through
`field-ghost.ts`, so a row carrying it can only be WRITTEN where the chrome can never read it.
**That constraint does not reach `mcp.ts` at all.** So the nine-tool evidence is real evidence
about the door and none whatever about `build`; reading it as a verdict on `build` is the trap,
and the reason this ruling leads with the conflation rather than with a number.

**On the DOOR population the criterion is PARTIAL — and PARTIAL whether or not tests and docs
are counted, so the counting choice changes nothing.** A tenth row over an ALREADY-EXISTING
daemon command genuinely is registration-only: the row plus its pin in `tests/mcp.test.ts`
(which restates the table independently rather than importing it, deliberately), with
`advertise()` deriving the advertised schema from the command's own zod document. As EXECUTED,
though, the six rows of `d5eb5ef4` arrived with **ten non-comment source files** — `mcp.ts`
itself plus nine others, **five of them in `@furnace/core`** — and it is the SOURCE files that
disqualify it, which is why excluding tests and docs cannot rescue the verdict. *(Computed, not
counted by eye: `git show --name-only --format="" d5eb5ef4 | grep -E "^packages/[a-z-]+/src/" |
grep -v "\.test\."` returns 13, of which `field-host/field-query.ts`, `shared/capture.ts` and
`shared/wire.ts` have zero non-comment changed lines.)* **The recurring extra files are
schema-projection metadata pushed back onto the command schemas** — `.describe()`, `.meta()` and
strictness on `daemon/session-handlers.ts`, `daemon/op-schema.ts` and
`action-registry/schemas.ts` — **not a missing builder.** That last clause is the useful part of
this ruling for anyone who ever revisits it: the abstraction that would pay here is "a command
declares its agent-facing prose beside its schema", which is not what `build` was.

**On the population `build` was deferred from, the criterion is UNTESTABLE at n = 2** — nothing
was ever added to that registry, so nothing ever measured the cost of adding.

**Disposition: the deferred `ToolDefinition.build` is RETIRED — and the reason matters, because
it is NOT "the criterion holds".** It is retired because the criterion was never testable on
that population, and because §23.4's two-bundle constraint is unchanged and still binding: the
same argument, at the same strength, for the same reason it was made. §23.4 — and the docblock
in `tool-registry.ts` it summarises, which works the two rejected ways out through in more
detail than this document does — is the durable tracked home for that argument, so retiring the
deferred item costs a POINTER and not a fact. `ToolDefinition.build` is NOT built: it was fenced
from being built in T5 regardless of the verdict, and the day a third interaction tool arrives
the argument is read off §23.4 rather than re-derived. **No backlog entry is filed**, on purpose:
the fact now lives here, where a reader of the door's as-built meets it, and an entry filed
under `build`'s name would file the door's real cost against the wrong mechanism.

**One thing the T5 review must RATIFY rather than assume:** the T5 plan offered a binary — the
criterion holds, so retire the deferral; or it does not, so file the gap — and this ruling picks
a third shape that was not on the menu.

**The backlog walk — every entry the planning digest named, with a verdict. Twenty rows, and
every component is derived from the artifact rather than counted by eye:** **nine** resolved
and DELETED (eight mid-tranche by the task that did the work, plus the donor here), **five**
narrowed or updated in place, **two** filed new, and **four** checked without firing. The
deletions are `git diff --diff-filter=D --name-only 21f61d98..HEAD -- docs/backlog/`, which
returns exactly nine paths; the other three components are the table's own verdict column.
*(An earlier draft of this sentence read "eight … and six", summing to 21 against a 20-row
table — this tranche's signature defect, in the paragraph that summarises the tranche. Both
wrong components are corrected, and the arithmetic is stated so the next reader re-runs it
instead of trusting it.)*

**READ THE NAMES BELOW AS T4c'S, NOT AS PATHS.** This table is a dated record of the walk T4c
performed, kept verbatim. **Seven of its twenty rows no longer name a file**, all seven
because of foundations T5 (§28): `agent-cannot-read-generator-params` and
`session-query-entities-list-is-unbounded` were RESOLVED and deleted;
`core-zero-consumer-module-exports` was resolved by the classification audit and deleted; and
`locator-rethrow-primitive-respelled-six-ways`, `reconfigure-empty-evaluation-leg-unheld`,
`render-pass-target-union` and `studio-key-light-blows-out-near-camera-geometry` were
CONSOLIDATED into merged trackers with their content intact — respectively
`core-internal-structure-debt.md` §"One locator re-throw, spelled six times",
`field-reconfigure-and-parse-edges.md` §"`reconfigureGenerator`'s empty-evaluation leg is
documented but unheld", `frame-surface-gaps.md` §"`render` / `renderToTexture` unified
pass-target union", and `editor-seams-and-preview-deferrals.md` §"The studio key light blows
out geometry close to the camera". Nothing in this table is a live register; the live register is
`docs/backlog/` and its per-dir index.

| Entry | Verdict |
| --- | --- |
| `editor-ai-integration-milestone` | **RESOLVED — DELETED (Task 7).** Full disposition above. |
| `re-claim-on-world-switch` | **RESOLVED — DELETED (Task 0).** `useSessionClaim` re-keys; the stale-label-plus-claim-count silent two-claims state it described is unreachable. §26.1. |
| `named-run-bodies-claim-ok-with-no-host` | **RESOLVED — DELETED (Task 3).** All 14 `ctx.host?.` bodies went through `handOffToHost`/`okAfterHost`; the five deliberate always-live stances were kept with the argument re-read. §27.1. |
| `member-id-is-a-display-label` | **RESOLVED — DELETED (Task 3).** `ToolFamilyMember.id` is `memberRefId(m.ref)`; two ids stopped echoing their labels, which is the point. |
| `refusal-class-has-no-input-arm` | **RESOLVED — DELETED (Task 3).** The arm arrived with its first caller, exactly as its docblock said it would wait for; the two refusals miscarrying `inert` moved. |
| `rendertotexture-lighting` | **RESOLVED — DELETED (Task 1).** `RenderToTextureOptions` takes `lights`/`ambient` through the same `_writeSceneBuffer` call `frame.render` makes. It was capture-BLOCKING, so this is the entry the tranche most depended on. |
| `session-state-armedness-is-two-fields` | **RESOLVED — DELETED (Task 5).** One `armed` member, `tool` renamed to `brush`, `gesture` off the wire entirely. It named two facts and there were three; §27.3. |
| `action-input-schemas-strip-what-commands-refuse` | **RESOLVED — DELETED (Task 6).** `z.object` → `z.strictObject` across the six action rows at the trigger the entry named — the moment those ids became agent-reachable. |
| `furnace-vendor-keys-untyped` | **RESOLVED — DELETED (Task 6).** `FurnaceMeta` lives in `core/registry` beside the `z` its writers build with; six sites `satisfies` it. |
| `oplog-group-apply-is-not-a-transaction` | **NARROWED, trigger FIRED, entry OPEN.** `applyOps` is `logApplyGroup`'s first editor consumer, so the surviving clause fired exactly as predicted. Pass-2 rollback was an explicit stop condition — a design decision, not a task's to make. What T4c owed was the DECLARATION at the new layer and it is paid, plus one correction the entry had wrong: the two failure cases CAN be told apart, structurally. |
| `backchannel-refusals-blur-two-causes` | **NARROWED, and item 1's trigger did NOT fire the way it predicted.** It expected the mutation verbs to force the chrome-refusal/daemon-fault split. They did not, because a refused WRITE never reaches the failure path at all: it travels the `ok: true` leg as an `ActionResult` an agent branches on. So the verbs made the distinction more available rather than more urgent, and item 1 now waits on a client that retries differently for a stale tab than for a broken daemon. **Item 2 got its first live evidence** — see the harness entry. |
| `read-only-chrome-for-an-unclaimed-session` | **NARROWED (Task 0), still open.** Its sibling shipped: the claim's world is TRUE now, so it is usable as a routing key for the first time and a read-only mode would be read-only *for a world*. The obstacle went, not the question. Its "seventh `RefusalClass` arm" arithmetic is corrected here — the union has eight arms, so the proposed one is the ninth. |
| `core-zero-consumer-module-exports` | **UPDATED (Task 6), open by design.** It now carries the projected vocabulary — advertised and relayed — with T5's rule written as subtraction. The blocking half ("we cannot prune until T4 says what projects") is closed. |
| `editor-test-harness-fragility` | **UPDATED (Task 7).** The digest predicted "T4c will hit this wall again" and it did NOT: every gate that recorded a wall clock landed in **54.2–68.2 s** against a ~64 s baseline and a ~90 s tripwire, because every SDK construction stayed in the spawn-child probe — the first real load test of that remedy, and it held. A DIFFERENT contamination class bit instead: an unsettled `ask()` promise outliving its file and rejecting 30 s later inside a stranger, with the failure MOVING between runs. Fixed per-site; the `EventHub.close()` gap behind it is `backchannel-refusals-blur-two-causes` item 2, which now has its first live evidence. |
| `agent-cannot-read-generator-params` | **FILED NEW (Task 6).** The one place the projection is incomplete; the gate walk is its trigger. See caveat 1 above. |
| `session-query-entities-list-is-unbounded` | **FILED NEW (Task 4).** The prop scan is capped twice and the entity list is not — a payload-size risk whose fix is a shape decision. |
| `locator-rethrow-primitive-respelled-six-ways` | **CHECKED, DID NOT FIRE — still six sites, and the count is re-derived rather than assumed.** Its second trigger clause named T4c explicitly ("adding locators on the MCP verb boundary"). T4c added none: `applyOps` PASSES core's locator through as the refusal's message unreworded, and the two verbs' other failures answer `failed` with core's own sentence — a throw converted into a VALUE, never re-thrown under a new prefix. **The command is `grep -rn --exclude="*.test.ts" "instanceof Error ? e" packages/core/src`, which returns exactly the six** — `ops.ts`'s `logApplyGroup`, `generators.ts`'s `commitGenerator`, `reconfigure.ts`'s `evaluateSpan` and `artifact.ts`'s `atOp` / `parseOplogJson` / `parsePlacementJson`, every one in `@furnace/core/field`. Two notes a reader needs, because an earlier draft of this row named a different command and mis-described it. **Do NOT grep `"cause: "`**: it returns 15 lines, not six — the two JSON sites deliberately do NOT pass `cause` (that divergence is the entry's founding observation, so the grep cannot return them), `maintenance.ts`'s `verifyFold` chains a cause for an unrelated reason, and the string is a substring of `because: `, which the editor's refusal vocabulary uses about ten times. And the same message-extraction idiom appears **33** times under `packages/editor/src` without producing a site: those extract a sentence to REPORT (a toast, a log, an `ActionResult`), where a site extracts one to RE-THROW under a prefix. The idiom is not the convention; the throw is. Taking the extraction anyway was weighed and declined: it still reaches `artifact.ts`, which nothing in this tranche touched, and it still carries the `cause`-or-not decision — the two conditions the AGENTS.md inline-fix threshold fails on, unchanged since T4a. Noted in the entry. |
| `reconfigure-empty-evaluation-leg-unheld` | **CHECKED, DID NOT FIRE as predicted — narrowed instead.** Its trigger named "a third generator-committing path arriving (T4c's MCP verbs would drive both existing ones)". No third CORE path arrived: `generate` is a new CALLER of `commitGenerator`, whose empty-result leg IS pinned. What did change is reachability — an agent can now reach that pinned leg directly, and can reach `reconfigureGenerator`'s UNHELD one by exactly one narrow route (`action_run {id: "session.confirm"}` over a reconfigure session a HUMAN opened). Recorded in the entry; the fixture is still a one-line `evaluate` swap. |
| `render-pass-target-union` | **CHECKED, DID NOT FIRE — and the question it holds was answered at the code, once, in its favour.** Task 1 shipped `frame.drawLinesToTexture` as a SECOND command rather than a `{ target }` field on `drawLines`, decided on R9 grounds (the two forms carry different failure-policy stances — runtime-quiet on-screen, setup-loud off-screen — and R9 assigns a stance per export). `api-posture.md` R4 now points at this entry as the home for the general question rather than legislating a universal from one instance. The entry stands unchanged: its own rejection was about the MANAGED pair on R8 tier grounds and nothing here disturbs it. |
| `studio-key-light-blows-out-near-camera-geometry` | **CHECKED, DID NOT FIRE — but its reasoning now cuts the other way and the entry says so.** It argued light tuning wants the user live in front of the viewport, because "a value picked by an agent against a headless capture is a value picked against the wrong instrument". The capture now borrows the SAME `sceneLights()` rig, so an agent inspecting near-camera geometry sees the same blowout a human does — which makes the note agent-visible without making it agent-fixable. Trigger unchanged (it bothers the user in real use). |

**Two adjacent findings surfaced and deliberately not fixed, recorded rather than dropped.**
Neither is a defect and both are tidy-ups that would have widened this tranche's diff into
files it had no other reason to touch. (1) **Every host test declares its own kit-bearing
material table.** Re-derived at head rather than carried from the plan:
`grep -rln 'kind: "kit"' packages/editor/tests` returns **17** files, 16 excluding
`catalog.test.ts` (whose subject IS the parser, so its tables are the test rather than a
fixture), and **two of them arrived in this tranche** (`field-host/mutation.test.ts`,
`field-host/query.test.ts`). One shared fixture would close it; the change touches every one
of them and belongs in a hygiene pass, not here. (2) **Nothing renders `<App/>` in any test**,
so the wiring between the store `App` puts on the context and the store it passes to
`useSessionAnswer` would survive being broken. Narrowed at the review: both members are
REQUIRED, so what actually survives untested is only "`App` hands two *different* stores to the
seam and the chip" — and it is a pre-existing class covering every `ctxValue` member rather
than anything T4c introduced. Filing a per-member entry for a gap the whole context shares
would be noise; it is stated here so the next person to mount an App-level test knows what it
would buy.

**What this tranche did NOT do, on purpose, so the next planner does not re-derive it.** No op
attribution and no `LogEntry` format change — user-ruled to post-T4 and designed together with
the agent undo verb, which is why `edit.undo`/`edit.redo` are FENCED at the `action.run` door
rather than merely unadvertised (§27.1). No abort plumbing: `session.interrupt` drains one Esc
rung and cannot stop a bake, a save or an analyzer pass, because nothing in this editor is
abortable. No read-only chrome mode. No canvas-snapshot tool. No `ToolDefinition.build`. No
embedded agent and no outbound LLM (dispositioned above).

## 28. Foundations T5 — the polish, the rulings, the register (2026-08-11)

The programme's closing tranche, and the one with no new capability in it. T4c ended with six
open filings — **four of them the gate walk's own findings** (the user drove an agent through
the editor on 2026-08-11 and could not FIND the cave it built) and two filed by T4c's tasks 4
and 6 — plus a guidance debt six tranches deep, two questions parked as "judge at T5", a core
surface nobody had classified, and a backlog register at 173 files.
T5 spends itself on those five things and nothing else — **no tenth tool, no attribution, no
undo verb, no `ToolDefinition.build`**, all of them fenced by ruling before the plan was
written.

**Every number below is computed rather than typed, and where the artifact still exists to
count, the deriving command is stated beside it.** That discipline is itself one of the
tranche's outputs (§28.3) rather than a house style. A few figures are measurements OF A
COMPLETED STEP — what a scan found before the files it scanned were re-pointed, what a
sabotage probe reddened — and those are attributed to the step rather than dressed as
re-runnable; they are marked in place.

### 28.1 The gate walk's findings, closed (Tasks 1–2)

**An inert refusal now names the enabling CONDITION.** `refuseOrClaim`'s inert arm answered
`refused(def.label(ctx))`, so an agent calling `action_run {id:"edit.grab", input:{entityId:6040}}`
read `{ok:false, kind:"refused", message:"Move", because:"inert"}` — a refusal naming neither
the missing precondition nor a remedy. `ActionBehavior` gains `inertHint`, the enabling
condition as prose, and the arm is `refused(def.inertHint ?? def.label(ctx), "inert")`.
**15 of the 39 rows carry a hint** (`grep -c "inertHint:" packages/editor/src/frontend/lib/actions.ts`
→ 15; `bun -e 'const {ACTION_DESCRIPTORS} = await import("./packages/editor/src/action-registry/index.ts");
console.log(ACTION_DESCRIPTORS.length)'` → 39); the other 24 spell `enabled: () => true` and
can never be inert — 18 of them literally, and six through the shared `axisView` factory the
`view.snap*` rows are built from — so the label stays the fallback rather than becoming dead
prose.
`tests/actions.test.ts` derives the inert set from an empty ctx rather than listing ids, and
also refuses a hint that merely REPEATS the label — the fallback wearing a costume.

**The cause underneath the filed one.** `edit.duplicate` and `edit.grab` resolved
`input?.entityId ?? ctx.selectedEntity?.entityId` in their run BODIES while `enabled` saw only
the ctx — so the walk's request was refused as inert before the body that would have honoured
it, with the id in hand. `enabled` is widened to `(ctx, input?)` (method syntax, for `run`'s
bivariance reason) and `refuseOrClaim` threads it. **The widening was user-ruled in
explicitly** rather than deferred. `edit.delete` deliberately did NOT change: its confirm
prompt describes `ctx.selectedEntity` by name and op count, so a named non-selected id is
refused INSIDE the run as `"input"`, with the instruction — a wider predicate would only move
that refusal later. Pinned, so a later reader does not "fix" the asymmetry.

**`view.frame` says what it framed.** `CameraRig.frameSelection` frames the selected entity's
footprint, else the cell selection's AABB, else moves nothing — and reading it answered the
filing's open question: **there is no camera-moving fallback**, so the bug was that it
`reportToolError`'d on the host's own channel while the action answered `{ok:true}` over a
camera that had not moved. It now RETURNS an `ActionResult`
(`FieldHost.frameSelection(): ActionResult`, the facade's only signature change in this
tranche) and reports nothing; each of its two callers says the sentence on its own channel —
the canvas `F` branch through `subscribeToolError`, `view.frame` as the verdict it hands
back. That needed **a third host seam**, `answeredByHost`: `handOffToHost` discards what the
effect returned, which is right for the 13 sites whose host call is `void` and wrong for the
one that answers. A seam rather than an inline `ctx.host === null` check, because
`tests/actions.test.ts` COUNTS seam call sites to know the no-engine sweep's id list is
complete — a row resolving the host by hand would be a fifteenth site that scan could not
see. **Three seams, 14 sites** (9 `handOffToHost` + 4 `okAfterHost` + 1 `answeredByHost`).
Two judgments taken at the code and recorded: the `ok` arm was NOT given a `framed` payload
(`ACTION_OK` is a frozen singleton argued payload-free, and once reading showed the
no-selection fallback does not exist, the refusal shape answers the question the filing was
really asking); and `view.frame` keeps `enabled: () => true`, because gating it on the ctx
pair would reproduce `frameTargetBox`'s priority by agreement and an inert refusal is SILENT,
so a human pressing `F` with a palette focused would lose the sentence they get today.

**The list gained a stated order.** `EntitiesList` sorts **newest first** — descending
`entityId`, which core mints from the op log's monotonic counter — and states that order in
the section header's tooltip, so it is a contract rather than an accident of how the host
walks its log. Decided in the LIST rather than in `useFieldEntities`: that hook has four
readers and the other three do `.find` lookups which must not silently acquire a promise
about order. `CollapsibleSection` gains an optional `titleHint` to carry it — a real tooltip
on the focusable TRIGGER, because D-25 bans an authored `title` carrying documentation and a
span nested inside the button takes no focus. The wording refuses the reading a monotonic id
invites: the counter is SHARED with the ops, so "newest first" is true while "entity #3 is
the third stamp" is false.

**The bar gained a place.** The status bar's selection chip carries a world-space location —
the box's centre to one decimal (`sel 240 cells · at 5.5 12.8 13.5`, and in the accessible
name, since a name replaces the content it labels), with the per-axis extents in the popover
in the phrasing an agent's answer uses. Same axes and metres `session_query` reports; for
`about: "selection"` it is literally the same box off the same builder, so a number read off
the bar and a number in an agent's answer are comparable without conversion. **It is the
SELECTION's box and not the camera's pivot, and that is a stated limit rather than an
oversight**: `CameraPose` is `{yaw, pitch}`, `CameraRig.orbit()`'s own docblock refuses
widening the pose because that shape is published as `SessionState.camera`, and the chrome's
pose latch guards on orientation precisely so a target-only move does not re-render at frame
rate. Both routes to the pivot were this tranche's stop conditions. **The go-to affordance is
not taken**, decided at the code: `CommandPalette.tsx` is a VIEW — every label is
`def.label(ctx)`, every refusal `controlVerdict` — so a row parsing free-text coordinates
would be the D-12 violation that file exists to expose; and no host verb moves the camera to
a world POINT (`frameChunks` takes `ChunkKey[]` and `shared/` exposes no chunk size, so the
chrome cannot even derive one). Either blocker alone is sufficient.

### 28.2 The read learns two questions — `session_query` at five arms, then six (Task 3)

`session.query` grows from three `about` arms to five, and the two T4c filings it closes turn
out to be one change. **Sculpting-worlds cycle 2 took it to six** — `{about:"flags"}`, the
walkability advisor's findings — on this section's own pattern, and the arm-growth arc is
therefore **3 → 5 → 6**. That sixth arm is recorded at the end of this section rather than in
a tranche section of its own, because it changed nothing about the shape argued here: one
zod literal, one switch branch the `never` guard demanded, and no new tool.

**`{about:"generators"}` relays `FieldHost.listGenerators()`** — every generator's `id`,
`name`, `paramSchema`, `defaults`, `placesProps` and `usesSeed`. An agent could NAME a
generator and not read its params, so it could compose and not tune (§27.5 caveat 1, the one
place clause 1's "builds a world" story was thinner than it read). **A tenth tool was the
honest shape and was declined**: a registry catalogue is not a spatial question, and
`generator_list` would have been the fitting name — but it spends the door's last budgeted
slot permanently, so the next verb that wants it would argue against a full door. The stretch
is conceptual and the slot is not. That trade is written down at the wire type
(`shared/wire.ts`'s `SessionQueryRequest`), in `field-query.ts`'s header, and again where the
header's own *"every answer is derived from the store and the log"* argument stops covering
it — the generators answer is plain JSON the chrome already reads for the stamp form, so what
puts that arm under `field-host/` is the DISPATCH rather than the data: one `about` union
answered by one exhaustive switch, which a chrome-side fifth branch would split across two
layers and disable the `never` guard on.

**It is a PASS-THROUGH where the entity arms project**, and the six members were tested one
at a time rather than waved through. The hazard of a pass-through is that a seventh member
added for the panel's sake reaches an agent without anybody deciding it should, so
`tests/field-host/query.test.ts` pins the exact key set. The same projection now has ONE
home: `listGeneratorInfos` is hoisted out of the facade literal in `field-host.ts` and the
`listGenerators` member delegates to it, because `createQuery` is assembled before the
literal exists and two spellings would drift the day an archetype rule changed. It is taken
as a CALL rather than an array, since the projection changes when the entity catalog is
swapped under it.

**`{about:"entities"}` slims and `{about:"entity", entityId}` details.** The list arm carries
id + generator + footprint per row plus a top-level `entityTotal`; everything else an entity
knows — seed, region, frozen/baked, what it placed — is the detail arm's, one entity at a
time, answering `entity: null` for an id no entity carries. `EntityFact` is a SUPERSET of
`EntitySummary` rather than the fields the summary lacks, so an agent that asked about one
entity never has to hold the list row beside the detail. **No numeric cap was added anywhere:
the split IS the size answer**, and a cap would need a measurement nobody has taken.
`entityTotal` equals `entities.length` exactly today and the doc says so — it is the SIGNAL
SLOT a bound would need, put in before rows start being cut rather than in the same change
that starts cutting them.

**Nothing authors a second schema**, and the exhaustiveness guard added at the T4c review
collected on exactly the case it predicted: both new arms failed the build at the `switch`
before they had branches. The door needed no new row and no hand-written schema: `advertise()`
projects the daemon command's own zod, so both arms reached the advertised DOCUMENT by
derivation. **The advertised PROSE is the half a person still writes**, and it is where this
task's 420 bytes went — `session_query`'s row teaching the two new arms, and `generate`'s
pointing at the catalogue that now exists.

**Measured at head, not typed** (head = cycle 2's, `240ecfb9`; T5's own figure for the row
prose was 7,502 B and is kept below so the arc is readable):

| Budget | Head | Pin | Command |
| --- | ---: | ---: | --- |
| `MCP_INSTRUCTIONS` | **1,970 B** | 2,048 | `bun test packages/editor/tests/mcp.test.ts` |
| the nine row descriptions | **7,865 B** (7,502 at T5) | 8,192 | same file, *"tools/list advertises the nine"* |
| advertised rows | **9** | ≤ 10 | same case, asserted as an inventory AND as a bound |

**327 bytes remain, which is shorter than seven of the nine rows** — so the PROSE CAP has
become the binding constraint on a tenth tool BEFORE the ceiling of ten is. The docblock's
older claim that the budget "admits a tenth row at the median length (870)" went false at T5
(7,502 + 870 = 8,372, which reds) and is corrected at source in both places rather than
quietly dropped, because it is the number a later task would reason from. At cycle 2's head
only `project_get` (214 B) and `world_list` (255 B) are shorter than the remaining headroom,
and both are verbs with no arms to describe.

**The sixth arm — `{about:"flags"}` (sculpting-worlds cycle 2).** The advisor's findings,
relayed as the agent reads them: `total` and `byKindSeverity` over every deduped finding,
`findings` rows for the CANDIDATE severity band only (a pit carries `candidate`, so pits are
rowed) capped at `MAX_REPORTED` with `truncated` beside them, and `pending`. Four decisions
are worth the sentences:

- **Unfiltered, deliberately.** It reads a new `FlagStore.rows()` and NOT `summary().visible`,
  because `visible` answers what the HUMAN's filter chips admit and the chips default `info`
  and `unreachable` OFF — an agent answered through that lens would silently lose whatever
  the human had hidden. The dedupe and the verdict join are `rowByKey`'s own, so a row read
  here and a row resolved by key cannot disagree.
- **`unreachable` is TRI-STATE and stays that way on the wire.** ABSENT means no reachability
  flood has visited the finding — the mixed-vintage steady state of a per-chunk advisor beside
  a whole-world pass, and the permanent state of every pit. Absence is "unknown", never
  "reachable"; collapsing it to a boolean would have been a false negative wearing a tag's
  clothes.
- **`pending` is the freshness anchor, and the backlog entry's premise was wrong.**
  `docs/backlog/editor-and-tooling/analyzer-flags-cannot-reach-the-agent.md` (gone) (deleted in the
  landing commit) assumed flags are computed at BAKE time and the answer must name what it is
  stale against. The as-built advisor is LIVE — per-chunk passes on density writes, a
  whole-world pass after `ANALYZER_IDLE_MS` of idle — so there is no bake to be stale against.
  What is honest is `Analyzer.pendingCount()`: passes still owed an answer. **Its zero is two
  states** and the answer cannot separate them: `analyzerPendingCount` returns 0 whenever no
  agent profile is in hand, so a project without `catalog/agent.json` reads `{total: 0,
  pending: 0}` forever. That is documented at the member rather than papered over, and the
  arm deliberately does not carry a second freshness fact about a different subsystem.
- **The `never` guard collected a second time.** The switch in `field-query.ts` failed the
  build before the arm had a branch — the same mechanism T5 recorded, re-proven by sabotage
  at cycle 2's gate (comment the branch out → `tsc` reds at the `never` binding; restore →
  clean).
- **What the arm does NOT relay, discovered by using it (cycle 2's review).** The rows carry
  kind, severity, position, tri-state `unreachable` and any mover verdict — but NOT
  standability, which is the second leg of the "walkable ground" definition the project reads
  its stop condition against. The consequence is measured and it is not small:
  `low-clearance` anchors on the OFFENDING NEIGHBOUR, so it scores **0 on walkable ground in
  all twelve worlds the analyzer covers — 1,117 candidates, zero actionable, every time**
  (`bun scripts/measure-analyze.ts` from `packages/dungeon`; the walkable-ground definition and
  the exclusion note are that script's own). The arm relays it as `severity: "candidate"`,
  indistinguishable from `narrow`, and in cycle 2's run that was 184 of 255 rows — enough to
  blow `MAX_REPORTED` and set `truncated: true` on the rows that mattered. **Building the door
  was necessary and not sufficient**: cycle 1 recorded "the finding reached nobody"; cycle 2
  is "it reached the agent in a shape it could not use". Filed with the filter/rollup design at
  `docs/backlog/editor-and-tooling/advisor-answers-volume-not-questions.md`.

The door cost 363 B of the 690 that remained, and `tests/mcp.test.ts`'s projected-arm list
(five → six) is where a human had to agree the arm should be advertised — the projection
itself needed no schema written.

### 28.3 The guidance becomes tracked, and two stances get checks (Tasks 4–5)

Six tranches of foundations produced rules that lived in commit messages. Four move to
`.claude/rules/working-standards.md` §Design — **stance→check** (an architectural invariant
is not landed until a check enforces it; hygiene stances stay guidance per D8), **new mode =
new module** (the field host reached 7.4K lines one region at a time; un-growing it took four
tranches), **parallel-subsystem reconciliation** (filed the day the subsystem is born — scene
vs the field op log cost a 24K-line deletion), and **justify by scaling** (write the threshold
where the decision lives). Two more move to §Discipline, and they are the two T4a and T4c
bought: **numbers in tracked docs are computed with the deriving command stated**, and **the
sabotage bar** — delete the line an assertion pins and watch it go red before trusting it.
`docs/learnings/seals/README.md` gains §Writing a seal above its index, and
`.claude/skills/tranche-review/SKILL.md` makes the review-session protocol tracked instead of
remembered. `AGENTS.md` was touched on **two lines only**, both licensed by the plan: the
sealing bullet points at §Writing a seal, and the root-skills parenthetical lists
`tranche-review`.

**The seal section carries the ruling that bounds the audit below**: a surface a slice
ORPHANS is recorded "to feed a later classification audit, **never to trigger automatic
deletion**" — an orphaned name is a candidate for JUDGEMENT, not for the bin, because core is
a capability library for consumers we do not know.

**Two stances became machinery.** `tests/field-host-boundaries.test.ts` (4 cases) holds the
field-host star — the roster derived at runtime, the facade the only assembler, no seam
module value-importing a peer, nothing value-importing the facade but the barrel (§21.5, and
`field-host-clusters.md` §5.8 for what it measured that nothing had).
`tests/harness-conventions.test.ts` (2 cases) holds the two conventions the harness entry had
recorded as "convention, not enforced": happy-dom registers in a `tests/` SUBDIR and never at
the top level (measured cost of one such file: 12 `server.test.ts` + 1 `bundle-watch.test.ts`
failures plus a `packages/core` feature gate flipped), and no test file names an
`@modelcontextprotocol/sdk` specifier outside `_helpers/mcp-probe.ts` (measured: 64 s → 194 s
workspace suite). A new file rather than three rules in `register-first.test.ts` — opposite
polarity (present-in-two-subdirs vs absent-across-the-tree) and a different subject; the two
files name each other.

### 28.4 Two rulings — the gate, and the malformed `build` question (Task 6)

**RULING 1 — the whole-workspace `bun test` from the root STAYS**, recorded in
`docs/backlog/editor-and-tooling/editor-test-harness-fragility.md` §"The gate question, RULED
at foundations T5". It is written as a RECOMMENDATION carried to the review, not a decision a
task took, because how this repo gates is a programme-level call. Its five numbered parts:
(1) containment is structural rather than fragile (T4c's own wall clocks are the load test);
(2) the stance is MACHINERY now, not discipline (§28.3's second case is the premise a "the
convention might slip" argument no longer has); (3) per-package runs stay the documented
DIAGNOSTIC fallback, re-measured at head rather than carried; (4) `--isolate` stays recorded
NOT USABLE on the existing 32-fail measurement, deliberately not re-probed; and
(5) baseline-relative wall-clock budgets are DECLINED — an absolute ceiling is a claim about
the ENGINE a reader can argue with, a baseline-relative one is a claim about the machine and
can never fail. The entry also names what would reopen it: **a second contamination class of
the synchronous kind**, which is the one premise a single new finding could knock out.

**The finding that came out of measuring it: the fallback does not cover the workspace, and
the entry had been spelling it as if it did.** The three per-package commands sum to **369
files / 3,223 tests** against the root run's **371 / 3,226** —
`packages/cookbook/tests/demos.test.ts` and
`packages/hello-world/tests/triangle-shader.test.ts` are in neither. Splitting also buys no
wall clock (69.57 s summed vs 71.66 s for one root run, measured at `0fd37ad7`). So the three
are the right three as a diagnostic and owe a fourth command as a gate.

*Re-measured at the T5 branch review (2026-08-11, tree at `3b98daae` + the review's doc fixes):
`bun test packages/{core,dungeon,editor}` gives 1,402 + 62 + 1,759 = **3,223 tests / 369 files**
against `bun test` at the root's **3,226 tests / 371 files** (3,225 pass / 1 skip / 0 fail).
The **2-file, 3-test delta is unchanged** — `bun test packages/hello-world packages/cookbook`
→ 3 pass across 2 files — so the finding survives the correction; only the totals moved,
by the tests four later commits on this branch added. The figures this section first carried
(3,215 / 3,218) were the harness entry's, measured mid-branch at `0fd37ad7` and correct there;
they were reproduced here without their commit label, which is what made them read as stale.
`docs/backlog/editor-and-tooling/editor-test-harness-fragility.md`'s own table states its
`0fd37ad7` provenance and is left as the dated measurement it is.*

**RULING 2 — `ToolDefinition.build`, and the substance is that the question CONFLATES TWO
REGISTRIES.** The full ruling is at §27.5 fact (b), where the deferral lived; in one line:
`ToolDefinition`/`ToolId` (`shared/tool-registry.ts`) is the INTERACTION-tool registry,
`ToolId` is `"brush" | "segment"`, **n = 2**, two commits ever — that is the population
`build` was deferred FROM, and §23.4's chrome-vs-`/engine.js` constraint is about it. The nine
MCP tools are `ToolRow` in `daemon/mcp.ts`, a third bundle graph the constraint does not
reach. Verdicts: **PARTIAL** on the door population (and partial either way you count, so the
counting choice changes nothing), **UNTESTABLE at n = 2** on `build`'s own. **Disposition: the
deferred `ToolDefinition.build` is RETIRED — not because the criterion holds, but because it
was never testable on that population and §23.4 is unchanged and still binding.** No backlog
entry is filed; the fact lives in the as-built where a reader of the door meets it. **This
picks a third shape the plan's binary did not offer, and it is flagged for the review to
ratify rather than assume.** The useful residue for anyone who revisits it: the recurring
extra files in a door change are schema-projection metadata pushed back onto the command
schemas (`.describe()`, `.meta()`, strictness), **not a missing builder** — the abstraction
that would pay is "a command declares its agent-facing prose beside its schema", which is not
what `build` was.

### 28.5 The core surface classification audit (Task 7)

**The cull became a classification.** As written at T4c, `core-zero-consumer-module-exports`
framed T5's job as SUBTRACTION — everything the agent door does not project is a deletion
candidate. The T5 opening discussion retired that rule as too extreme (§27.4 records the
re-ruling), and what ran instead is keep-by-default: every zero-consumer name is classified
**keep / cookbook-debt / delete-with-a-per-name-argument**, and deletion needs an argument of
its own (wrong abstraction tier, scene-style orphan, `_`-convention leak).

The enumeration is mechanical because the precondition holds —
`grep -rn "export \*" packages/core/src --include="*.ts" | wc -l` → **0**, so every module
index re-exports explicit names. Counting them needs the compiler API rather than a regex
(type-only exports count, and a runtime import would drop them all):

```
bun -e 'const ts = await import("./node_modules/typescript/lib/typescript.js");
  const { existsSync, readdirSync } = await import("node:fs");
  const SRC = "packages/core/src";
  const mods = readdirSync(SRC, { withFileTypes: true }).filter(d => d.isDirectory())
    .map(d => `${SRC}/${d.name}/index.ts`).filter(existsSync).sort();
  const p = ts.createProgram(mods, { target: ts.ScriptTarget.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
    noEmit: true, skipLibCheck: true });
  const c = p.getTypeChecker();
  let n = 0; for (const f of mods) n += c.getExportsOfModule(c.getSymbolAtLocation(p.getSourceFile(f))).length;
  console.log(mods.length, "modules,", n, "exported names");'
```

**418 names over 22 modules at the audit's input, 257 with a workspace consumer and 161 with
none; verdicts 150 keep / 10 cookbook-debt / 1 delete.** At this tranche's head the same
command answers **22 modules, 417 names** — the difference is exactly the one deletion, which
is the cheapest available check that the audit's arithmetic and the tree agree.

**The one deletion is a RELOCATION, not an erasure.** `registry.resetServicesForTests` was
documented "Tests only." in `core-modules.md` while sitting unprefixed in the public
`registry/index.ts` — not-for-consumers surface on the consumer side of the boundary the
`_`-internal convention draws. The fix is the SEAM: the name lands in a new
`packages/core/src/registry/internal.ts` (the module had none) as `_resetServicesForTests`,
package-private because `package.json`'s `exports` map publishes `index.ts` only. Its sole
caller re-points in the same commit.

**The pin that argument leans on was BROKEN, and the sabotage bar is what found it.**
`tests/architecture.test.ts`'s *"underscore-prefixed exports stay out of public module
indexes"* caught `_name,` inside a multi-line block and `export const _name`, but NOT a
single-line `export { _name } from "…"` — the name is neither at line start nor after a
declaration keyword, so re-adding the export in that shape kept the suite GREEN. Fixed and
re-sabotaged in both shapes. It rides the audit's commit because it is the guardrail the
deletion's whole argument cites.

**The constructive half is 10 names filed as ONE entry** —
`docs/backlog/engine-architecture/cookbook-debt-kcc-collision-events-shader-composition.md`:
the physics KCC family (5), physics contact events (2), the shader composition fragments (3).
Each is Tier-1 capability absent from BOTH its module's "Demoed in cookbook" list and its
"Reference-only (no demo, by design)" register — an unrecorded no-demo state rather than a
decided one. **The entry carries an adjacent finding it will not fix**, and it stays parked
here too: the five KCC names are missing from `docs/reference/api-posture.md` altogether
(`grep -n "Character" docs/reference/api-posture.md` returns nothing, re-verified at this
tranche's head), and placing them needs a CLASSIFICATION DECISION rather than a sweep —
`CharacterController` is documented as an opaque object handle that is a world-bounded
helper, not a resource-pool handle, which is a kind the Resource/Value-type split does not
obviously hold.

**Four stale claims in `core-modules.md` and `packages/core/README.md` were found and fixed
by the same reading**, each verified false by quoted grep before editing: `shader.textured`
claimed as used by the bowling scene (only `texturedLit` is; `textured` has no consumer
anywhere, and it stays on family-symmetry grounds with that stated where the false claim
was), `toWgsl` claimed as demoed by `cookbook/shader` (the demo calls `shader.source` +
`shader.create`; `create` flattens internally), `gpu.onResize` claimed as demoed by
`cookbook/camera` (the demo subscribes through `camera.bindToCanvas` — moved to that module's
Reference-only register WITH the reason, so removing it from one list does not manufacture a
new unrecorded state), and the core README listing `retainForCollision`/`getCollisionData`
among capabilities the dungeon leans on (the dungeon collides through `voxels` exclusively
and passes `retainForCollision: false` at every `geometry.create`).

### 28.6 The register prune (Task 8)

**169 → 101 files, and exactly ONE closure.** (**173 at the tranche's start.** The delta is
the four gate filings §28.1 deleted in their own tasks; §28.5's cull entry was deleted too but
its cookbook-debt successor was filed in the same commit, so `engine-architecture` was
unchanged at 85 when the prune began. 169 is the prune's input and 173 is master's count —
both are `git ls-tree -r <ref> --name-only docs/backlog | grep '\.md$' | grep -v README | wc -l`.)
The user's bar governs it: nothing is lost.
Three moves only — promote, consolidate, close-with-disposition — and only an entry DIRECTLY
CONTRADICTING current direction may close; where a disposition was unclear, keep. So the
tranche is almost entirely consolidation: **13 new merged trackers in `engine-architecture`
and 2 in `editor-and-tooling`** (`git show --diff-filter=A --name-only --format="" 9e12a3a1 --
docs/backlog/` lists 17 additions — the other two are `field-bake-has-no-content-hash.md`, the
one closure's re-filed residual, and a cross-directory move), plus 10 absorptions into
existing trackers and 3 cross-directory moves. Each absorbed entry becomes one `##` section
that keeps its Context / Trigger / Reference verbatim.

```
for d in docs/backlog/*/; do printf "%-25s %s\n" "$(basename $d)" \
  "$(find "$d" -name '*.md' -not -name 'README.md' | wc -l | tr -d ' ')"; done
find docs/backlog -name '*.md' -not -name 'README.md' | wc -l
```

`engine-architecture` 85 → **33**, `editor-and-tooling` 40 → **21**, `dungeon` **19**,
`native-runtime` 10 → **12**, `testing-and-quality` **10**, `infrastructure` 3 → **4**,
`ai-agents` **2**; total 169 → **101**. *(Those are the PRUNE's figures, at `9e12a3a1`.)*

**At the tranche's head (`3b98daae`) the register is 102, not 101**, and `infrastructure` is
**5**, not 4 — §28.7 opened a charter entry
(`docs/backlog/infrastructure/docs-registers-findability.md`) in the commit that relaxed the
threshold, one commit after the prune. Every other dir is unchanged. Both figures are
`git ls-tree -r --name-only <rev> -- docs/backlog | grep '\.md$' | grep -v 'README\.md$' | wc -l`,
which is the form that works at any revision; the `find` block above measures the working tree.

**The four other ruled contradiction classes produced ZERO closures, and that is the finding
rather than an omission.** Ten bowling-era hits: six say bowling explicitly does NOT trigger
them, three name it as the historical site of a live engine gap, one records a closed epic's
met objective. Eleven voxel hits: not one assumes permanence, and several RECORD the bridge
status and cite Jolt. Both editor-MSAA hits already carry T4c `sampleCount: 1` annotations.
All kept. The one closure — `region-recipe-as-truth` — closes on its own final paragraph,
written at T2 when `@furnace/core/scene` and the `.fmesh`/`RegionData` region model were
deleted, which says "Delete this entry"; and it is net zero rather than −1, because its live
residual is re-filed as `field-bake-has-no-content-hash.md`.

**The reference gate ran BEFORE any deletion and over every zone, with no `--include` at
all** — a `*.md`-limited grep misses source comments, and source comments cite backlog
entries. It found 96 (file, name) pairs across 58 files, **11 of them in `.ts`/`.tsx`** across
10 source files a markdown-only gate would have missed. All re-pointed in the same commit,
each carrying a `§"section"` label so a reader lands where the work is rather than merely in
the right file. `docs/backlog/README.md` is brought true in the same move: the computed
per-dir index, the keep-by-default ruling, and the merged-tracker file shape — which is now
the dominant shape and was undocumented.

**Content preservation was verified mechanically rather than asserted**, and the prune
records how: 324 distinctive lines sampled from all 84 absorbed entries, every one still
present in the register except where a re-pointed filename changed the string. The check a
later reader can re-run cheaply is the sign of the diff —
`git show --shortstat 9e12a3a1` is **+423 net** across the whole commit (**+397** inside
`docs/backlog/` alone) — because **a prune that lost content would run negative.**

### 28.7 The T5 exit — eight clauses

Verdicts derived at the tranche's head from the artifact, never from the commit that claimed
each one. **Where a clause is only partly met the table says which part**, because a PARTIAL
stated honestly is worth more than a HOLDS a reviewer disproves in one command.

| Clause | Verdict | Evidence |
| --- | --- | --- |
| **1. All six gate filings resolved smallest-honest or narrowed to their explicitly-untaken rungs — none silent** | **HOLDS, with one filing HALF closed and saying so.** *(The clause's "six gate filings" is the plan's phrase for the whole set; strictly, four are the walk's own findings and two — `agent-cannot-read-generator-params`, `session-query-entities-list-is-unbounded` — were filed by T4c tasks 6 and 4. All six were in scope and all six are resolved.)* Four DELETED (`inert-refusals-answer-with-their-label`, `view-frame-without-selection-frames-something-unstated`, `agent-cannot-read-generator-params`, `session-query-entities-list-is-unbounded`), two NARROWED in place. `entity-list-has-no-legible-order` keeps only the presence half (creation-time grouping, "added since your last look"), which needs attribution state the chrome does not have. **`where-am-i-position-legibility` is the half-closed one**: what shipped is the SELECTION's world box, not the camera's pivot, because `CameraPose` is `{yaw, pitch}` and `CameraRig.orbit()`'s docblock refuses widening it (that shape is published as `SessionState.camera`) — both routes were stop conditions, so the entry was narrowed to name them rather than closed. The go-to affordance is likewise narrowed with both of its blockers named. | `git diff --diff-filter=D --name-only 2e2b01cd..HEAD -- docs/backlog/editor-and-tooling/` lists the four deletions among its rows. The two survivors each open with a **What shipped** section: `docs/backlog/editor-and-tooling/entity-list-has-no-legible-order.md`, `where-am-i-position-legibility.md`. Behaviour: `bun test packages/editor/tests/chrome/entities-palette.test.tsx packages/editor/tests/chrome/shell.test.tsx packages/editor/tests/actions.test.ts` → 253 pass. |
| **2. An agent can read generator params through `session_query`; the entity answer is list/detail-shaped with an honest total; the door is still nine tools and instructions ≤ 2,048 B** | **HOLDS on all four, measured.** Five `about` arms on one row (**six since cycle 2**, §28.2); `entities` slim + `entityTotal`, `entity {entityId}` in full answering `null` for an unknown id; `generators` relaying the host's own projection with its key set pinned. Nine rows, 1,970 / 2,048 B of instructions, 7,502 / 8,192 B of row prose **at T5's exit — 7,865 at cycle 2's head, still under**. | `bun test packages/editor/tests/field-host/query.test.ts packages/editor/tests/session-query.test.ts packages/editor/tests/mcp.test.ts` → 53 pass, including *"the generators arm RELAYS the host's projection — it authors no second schema"*, *"the DETAIL arm carries what the list dropped — for ONE entity"*, *"an unknown entityId answers null"*, *"`entityTotal` counts the committed entities"* and *"tools/list advertises the nine, with readOnlyHint per ROW"* (which carries both byte pins). |
| **3. The guidance is tracked: four §Design rules + two §Discipline lines + the seal section + the `tranche-review` skill; and the two enforceable stances have checks** | **HOLDS.** | `git diff 2e2b01cd..HEAD -- .claude/rules/working-standards.md` shows six added bullets, four under §Design and two under §Discipline. `grep -n "^## Writing a seal" docs/learnings/seals/README.md`; `test -f .claude/skills/tranche-review/SKILL.md`. Checks: `bun test packages/editor/tests/field-host-boundaries.test.ts packages/editor/tests/harness-conventions.test.ts` → 6 pass. |
| **4. The gate question is RULED in the harness entry with evidence** | **HOLDS, as a RECOMMENDATION for the review to ratify** — which is the honest verdict, because no task gets to decide how the repo gates. Five numbered parts, each with its measurement; the new finding (the per-package fallback does not cover the workspace) is what disqualifies it as a candidate gate. | `grep -n "The gate question, RULED at foundations T5" docs/backlog/editor-and-tooling/editor-test-harness-fragility.md`. Re-measure: `bun test packages/hello-world packages/cookbook` → 3 pass across 2 files, the two the three-command form drops. |
| **5. `ToolDefinition.build` is judged against the nine-tool evidence table and dispositioned** | **HOLDS, and the judgement is that the question was MALFORMED.** Two registries were being conflated; PARTIAL on the door population, UNTESTABLE at n = 2 on `build`'s own; the deferred item is RETIRED on §23.4 still binding rather than on the criterion holding. **Flagged for ratification: this is a third shape the plan's binary did not offer.** No entry filed, on purpose. | §27.5 fact (b) and the ruling block under it. `grep -n "ToolId =" packages/editor/src/shared/tool-registry.ts` → `"brush" \| "segment"`; `grep -c "^defineTool(" packages/editor/src/shared/tool-registry.ts` → 2, the whole population. |
| **6. Every zero-consumer core export is classified keep / cookbook-debt / delete-with-argument; deletions executed atomically; the cull entry gone** | **HOLDS.** 418 names classified 150 / 10 / 1 at the audit's input; the one deletion relocated behind the registry's package-private door in the same commit as its caller and as the guardrail it cites. | Surface at head: the `bun -e` block in §28.5 → **22 modules, 417 exported names** (418 minus the one deletion). `test ! -f docs/backlog/engine-architecture/core-zero-consumer-module-exports.md` (gone). `grep -rn "resetServicesForTests" packages/core/src` → **five** lines and **none in `registry/index.ts`**, which is the whole check: the declaration in `registry.ts`, the re-export and its comment in the new `registry/internal.ts`, and the two in `registry/registry.test.ts` — every one of them `_`-prefixed. Guardrail: `bun test packages/core/tests/architecture.test.ts packages/core/src/registry/registry.test.ts` → 16 pass. Debt: `test -f docs/backlog/engine-architecture/cookbook-debt-kcc-collision-events-shader-composition.md`. |
| **7. The register is at or under its thresholds with nothing lost — closures ratified at review, merge-docs reference-clean** | **PARTIAL against the bars this clause was written to, and the bars themselves then MOVED — see §28.9.** *Nothing lost* HOLDS and *reference-clean* HOLDS. **Against the ~100 / ~20 pair the clause was authored against, the thresholds do NOT hold**: head is **103 total** with **`engine-architecture` at 33** and **`editor-and-tooling` at 21** — three bars, none met, two barely. Getting under would mean merging a charter input (forbidden by the "nothing is lost" bar) or re-merging already-merged 200–570-line trackers into 700–1,000-line documents, which destroys the findability the merge exists to buy. **That impasse is what produced §28.9's relaxation**, so under the bars now in `AGENTS.md` (~150 / ~50, provisional) head is inside all three — which is a change of instrument, not a clause that came true. **One closure, for the review to ratify**: `region-recipe-as-truth`, net zero because its live residual is re-filed. | The two commands in §28.6. Head count: `git ls-tree -r --name-only HEAD -- docs/backlog \| grep '\.md$' \| grep -v 'README\.md$' \| wc -l` → **103** (101 at the prune, +1 for §28.9's charter entry, +1 for the dungeon dead-citations entry the tranche's own last commit filed). Reference-clean, run per deleted entry name over the whole tree (`grep -rln "<name>" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=superpowers --exclude-dir=target`): **it deliberately does NOT return nothing**, and every surviving hit is one of four kinds — dated **seal records** (left alone by rule), **this document's own historical tables** (§27.5, which now says which seven of its names are in that class), **two provenance notes that say in their own text they are not live pointers** (`field-bake-has-no-content-hash.md` on the one closure, `frame-surface-gaps.md` naming the section it is inside), and **one substring false positive** (`gpu-resident-physics` matches `docs/research/gpu-resident-physics-solver.md` and an `engine-architecture.md` heading anchor — neither is the entry). A fifth kind, or any hit presenting a deleted name as a live register, is the failure. |
| **8. 3b is handed off by name, not dropped** | **HOLDS.** §28.8 below names it, its home, its shape and its position in the queue. Nothing of it was built here, by ruling. | §28.8. `ls packages/editor/.claude/skills/` → the four third-party React skills and nothing else; the 3b skill is deliberately absent, not forgotten. |

### 28.8 What T5 did NOT do, and what comes next

**Fenced by ruling before the plan was written, so the next planner does not re-derive it:**
no tenth MCP tool; no numeric cap on the entity list (no measurement exists to size one); no
op attribution, `LogEntry` format change or agent undo verb (all post-T4, with `edit.undo` /
`edit.redo` still FENCED at the door); no `ToolDefinition.build` implementation regardless of
the verdict; no `--isolate` re-probe; no read-only chrome mode; and no 3b content.

**NEXT after T5 is the 3b session — the agent world-building skill.** It lives under
`packages/editor/.claude/skills/`, and it is deliberately NOT in this tranche: it was
user-ruled on 2026-08-11 as **the primary intent T5's guidance work was split away from**,
and it wants its own brainstorm plus external research rather than a task in a polish
tranche. T5 built the process half of that split (§28.3); 3b is the world-building half —
what an agent driving this editor should be TOLD about composing a world through the nine
verbs, which is a design question this tranche had no license to answer.
*[Executed 2026-08-12: the 3b session ran as the `sculpting-worlds` skill — cycle 1,
RED baseline build (45 door calls, owner-walked) → GREEN skill + guardrail test
(`packages/editor/tests/skill-references.test.ts`); field notes at
`docs/learnings/2026-08-11-agent-world-building-cycle-1.md`. The T5-close ruling also
inserted the TOOLING SESSION (doc strategy + build-cycle speed) into the queue between
3b and the undo + attribution pass below — the T5 seal carries that queue.
**Cycle 2 followed on 2026-08-12** — the skill's first real use, planner ≠ executor ≠
reviewer across three sessions: E0 built the `flags` arm (§28.2), E1 ran a 58-call
five-place monastery build with the skill loaded, the owner walked it, and the review
adjudicated the four on-trial `§Composing` bullets and filed eight backlog entries. Field
notes at `docs/learnings/2026-08-12-agent-world-building-cycle-2.md`.]*

**Then undo + attribution**, as ONE wire-format design pass: an origin field on the log entry
and named-stroke boundaries, designed together with an agent undo verb rather than before it.
That is the pairing `edit.undo`'s fence has been holding open since T4c (§27.1), and it is
also the state clause 1's remaining rung needs — "added since your last look" is attribution
wearing a list's clothes.

**Then F5, "scale."**

**One correction T5 made to the record rather than to the code, because it is the kind that
rots quietly.** §27.5's clause 1 — *an agent session builds a small world end to end through
MCP* — read **PENDING THE REVIEW WALK** in this document until T5's citation sweep. It was
written by T4c Task 7 before the walk, the review then WALKED it on 2026-08-11 and it
**PASSED with measurements**, and that result landed in the seal only. The row now carries the
verdict and the numbers. **The gate that genuinely did not pass is a different one**: gate 2,
the holistic USER VISUAL walk, went PARTIAL and was waived to daily use by user ruling — the
dig/paint/bake regression pass and the `sampleCount: 1` AA eyeball were never delivered, and
the seal states outright that it does not record a passed visual gate. Two of that table's six
walker caveats also stopped being true and now say so at their own numbers (generator params
are discoverable since §28.2; a daemon under real MCP traffic HAS been measured once, though
not under sustained or concurrent load). **This is what the tranche's own §Discipline rule is
for**: the number and the verdict were both right somewhere, and neither was in the place a
reader looks.

### 28.9 The register threshold relaxes — PROVISIONALLY, and the real question is filed

Recorded here because §28.6 and §28.7's clause 7 both reason against a bar that changed in the
same tranche, one commit after the prune (`3b98daae`), and §28 had not carried the change at all.

**`AGENTS.md` § "Deferred work" moved from ~100 entries / ~20 per topic dir to ~150 / ~50**, and
the new numbers are marked **provisional** in `AGENTS.md` itself rather than presented as policy.
The user's ruling is what makes them provisional:

> "these will only grow bigger, i think we should relax the threshold, and if it's truly a
> problem (and i suspect it might be) then this is something we need to look at properly … instead
> of just dialing numbers and keeping the doc strategy a mess"

So the relaxation is **an admission that the instrument is wrong, not a finding that the register
is fine.** Two measurements in the charter entry say why a constant cannot work here: the register
grows at ≈ **+2 net entries/day**, flat since June with no sign of self-limiting — so any bar is
re-crossed within weeks of the prune that satisfied it, and a bar with enough headroom to survive
one epic works out at ~160–175, i.e. it would have to legitimise the exact 169 everyone agreed
needed pruning. Meanwhile the only remaining moves DOWN make the register less findable, not more
(see clause 7). **The bar and the only way to satisfy it point in opposite directions.**

**The real question is filed as a charter, not solved here**:
`docs/backlog/infrastructure/docs-registers-findability.md` — how a growing body of deferred-work
markdown stays *findable*, so an entry is read when its trigger fires rather than re-derived by
someone who never found it. It is explicitly **not** a task for a polish tranche: it wants its own
brainstorm plus a precedent search (large-codebase deferred-work practice, ADR/decision-record
practice, PKM), and its trigger is the next prune — *do the design pass instead of a fourth
consolidation round*. It is the entry that takes `infrastructure/` from 4 to 5 and the register
from 101 to 102.

**The T5 branch review added a second, independent argument to that charter** (2026-08-11):
citation integrity. The prune moved 84 entries under a keep-it-verbatim rule behind a reference
gate that validated **filenames only** — so no `file:line`, no source path and no factual claim in
the moved prose was checked against source. The review found a false bug claim standing as
"evidence" for two weeks, a table that failed its own stated regenerating command, a citation to a
module that has never existed, and — by a five-line sweep over all 251 cited package paths in the
register — **34 dead-path hits**, of which five were re-pointed at the review and **21 name
architecture that was deleted entirely** (Epic 2's procgen substrate, the pre-T3 chrome) and so
need a per-entry disposition rather than a new path. That
class is invisible to a file count, is *propagated* rather than fixed by consolidation, and gets
worse precisely as the register does its job. Any design for this register has to say how a
citation stays true, or how it is made cheap to re-derive.
