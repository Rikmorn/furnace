---
summary: The Node-portable HTTP server — loopback bind, the Origin refusal, the route ladder, the trust boundary, and project config.
verified: 2026-08-18
---

# The daemon

A **Node-portable** HTTP server. No `Bun.*` or `bun:*` anywhere in `packages/editor/src/` —
enforced by the static scan in `packages/editor/tests/no-bun-leakage.test.ts`, which
regex-scans `src/` for Bun-API usage. It builds on `node:http`, `node:fs`, `node:path`,
`node:crypto`, `node:os` and `node:url`; it runs under plain Node ≥20 and under Bun.

## Binding and lifecycle

`startServer(opts)` (`packages/editor/src/daemon/server.ts`) creates a `node:http` server and
listens on **`127.0.0.1`** only — one local single-user session. Port defaults to `4500`
(`packages/editor/src/daemon/main.ts`) and is overridable with `--port`; tests pass `port: 0`
to let the OS pick. `close()` tears down the server, the extensions-directory
watch, the SSE hub and the esbuild bundler context.

`main.ts` prints the chrome's address and the agent door's, the latter composed from
`MCP_PATH` rather than a literal — an MCP client is configured with a URL, and this daemon's
port is the OS's choice under `--port 0` and a default otherwise.

## Resident state — two tables of one kind, and no other

The **session claim** (`packages/editor/src/daemon/claims.ts`) records which SSE connection
is authoring which world. The **backchannel's pending asks**
(`packages/editor/src/daemon/backchannel.ts`) record which questions are out to that
connection awaiting a `session.answer`.

Both reconcile with "the daemon stays stateless" rather than excusing it, and on the same
argument: **there is no DURABLE state here — each is the same class of thing as the
subscriber set beside them in `packages/editor/src/daemon/events.ts`.** A claim is born when
a live connection asks for one and dies when that connection departs; an ask is born when a
command relays a question and dies when it is answered, times out, or its connection goes.
Nothing is written to disk, nothing is read back at boot, and a restart begins with both
empty because a restart begins with an empty hub. The daemon holds no document, no schema
and no generator. The claim's mechanics and the connection token are in
[change-feed](change-feed.md).

## One check runs ahead of every route — the `Origin` refusal

`route`'s first statement is `assertLoopbackOrigin(req.headers.origin)`
(`packages/editor/src/daemon/origin.ts`): a request that DECLARES a browser origin which is
not this machine's loopback is refused `403 forbidden-origin`
([error-contract](error-contract.md)) before any branch runs — and before the request target
is even parsed, so the claim in this heading is literal rather than approximate.

It is **DNS-rebinding defence, and nothing else.** The loopback bind stops a remote host
reaching the port, but it does not stop a page the user merely visited: `evil.example` can
answer its own DNS with `127.0.0.1`, and the browser then issues requests here believing them
same-origin. The `Origin` header it attaches is the one thing that page's JavaScript cannot
forge. The MCP specification makes exactly this pair — validate `Origin`, keep the loopback
bind — a MUST for local HTTP servers
(`docs/research/2026-08-08-t4-agent-editor-mcp-precedent.md`, ruling 9).

It lives in its own module rather than in `server.ts`, and the decisive reason is testing
cost: extracted, the spelling table is a **pure unit test**
(`packages/editor/tests/origin.test.ts`, the way `errors.ts` is tested) instead of one live
HTTP server per row. `server.ts` keeps the WIRING question and answers it end-to-end, one
case per route branch. Three clauses decide the admission, each argued at
`assertLoopbackOrigin` / `isLoopbackOrigin`:

- **ABSENT passes.** curl, the CLI and an MCP client over `node:http` send no `Origin` at
  all. **This is therefore not client authentication and must never be read as any** —
  anything that can omit a header could also have omitted a wrong one. It closes one class (a
  browser tricked into speaking for a stranger) and no other.
- **PRESENT-but-opaque refuses.** `Origin: null` — a sandboxed iframe, a `data:` or `file://`
  page — carries no provenance, and a `sandbox` attribute is one keystroke on the attacker's
  own page, so reading it as "absent" would hand back the bypass. Anything that fails to parse
  refuses on the same fail-closed rule.
- **Loopback is decided by PARSING, never substring-matching.** `http://127.0.0.1.evil.com`
  and `http://localhost.evil.com` are ordinary public hostnames that merely start with a
  loopback spelling. Parsing also buys canonicalization a table could not enumerate:
  `new URL(...)` case-folds the host, collapses IPv6 (`http://[0:0:0:0:0:0:0:1]` → `[::1]`)
  and normalizes the integer spellings of an IPv4 address, so `http://2130706433`,
  `http://0177.0.0.1` and `http://0x7f.0.0.1` all arrive as `127.0.0.1` and are admitted —
  correctly, since they ARE loopback.

**ONE AXIS DECIDES THE ADMITTED SET, and both of its clauses must hold: could a real local
caller PRESENT this spelling, and is it unmintable by the attack?** The second clause is the
security floor and it is absolute — an `Origin` derives from the NAME a page was loaded from,
never from the address that name resolved to, so a rebinding attacker (who controls DNS and
nothing else) can never mint *any* loopback name; holding one requires already running code
on this machine, which is strictly more than the attack being defended. Clause 2 therefore
admits every loopback spelling, and **clause 1 alone decides which are written down**:
`LOOPBACK_HOSTS` is `localhost`, `127.0.0.1` and `[::1]` over `http:` or `https:`.
`localhost` and `127.0.0.1` are the daemon's own two, `[::1]` is what a v6-bound local dev
server presents, and `https:` is what a TLS one presents. The rest of `127.0.0.0/8` fails
clause 1 — servers bind `127.0.0.1`, `localhost`, `::1` or `0.0.0.0`, not `127.0.0.2` — and
so does a non-web scheme that parses (`chrome-extension:`, `file:`), being an origin no local
server serves.

Nothing a human sees moved: the chrome is served BY this daemon, so it was reached over
loopback by construction and its `fetch` POSTs carry a loopback origin, while its
`<script>`/`EventSource` GETs carry none. Coverage splits by question:
`packages/editor/tests/origin.test.ts` holds the spelling table — every row carrying why it
is admitted or refused, derived from `ACCEPTED` and `REFUSED` there, plus a row asserting that
the predicate and the assert agree — and `packages/editor/tests/server.test.ts` holds the
wiring, the refusal on every route branch below (the agent door needs its own row precisely
because it sits first on the ladder), plus the loopback and absent cases. A check that had
drifted into the POST branch would satisfy a POST-only suite, and the SSE case additionally
asserts JSON, since that branch hijacks the response and a late check would leak an open feed.

**The ORDER is pinned too, because both refusals are typed and both are correct.** A malformed
cross-origin target must answer `403`, not the `400` the next section is about — the security
refusal is the one that decides it, and a `400` there would falsify the claim this heading
makes.

## Then the request target is parsed, and that can fail

`new URL(target, "http://localhost")` THROWS on targets the HTTP parser accepts — `//`,
`///////` and `/\` are each a protocol-relative reference with an empty host. `requestUrl`
parses **inside** `route`'s try and answers `400 invalid-input`. Outside it, the throw would
escape an `async` function nobody awaits: Bun leaves the socket open with no response and
Node 22 takes the unhandled rejection as fatal and KILLS THE PROCESS — a remote,
unauthenticated daemon kill, one `fetch("//")` from the very rebinding page the check above
models. Node's behaviour is the one that governs, since the daemon must run on plain Node
≥20. The pin asserts the server is still serving afterwards, which is the half that matters.

## Routes

Matched in this order in `server.ts`'s `route`, all of them behind the `Origin` check:

| Method + path | Behaviour |
| --- | --- |
| `<any> /mcp` | The **agent door** (`packages/editor/src/daemon/mcp.ts`). A `POST` is handed to a freshly built MCP `Server` + streamable-HTTP transport, which reads the body itself and writes the whole response; **every other method gets `405` + `Allow: POST`** in plain text, since this endpoint opens no server→client stream. It matches on **path alone**, which is why it is FIRST: the `GET <anything else>` branch below is greedy, and a `/mcp` mounted after it would have its GET answered as a missing static file. |
| `GET /engine.js` | Builds and returns the browser engine bundle ([bundling](bundling.md)) as `text/javascript`. esbuild build failure → `500` with the diagnostics as plain text. |
| `GET /api/events` | Subscribes the response to the SSE change feed ([change-feed](change-feed.md)). Stays open. |
| `POST /api/<command>` | Reads the request body, JSON-parses it (`{}` if empty body; invalid JSON → `400 invalid-json`), and `dispatch()`es the command ([commands](commands.md)). Always `200` with the handler result, or the error envelope on an `EditorError`. |
| `GET <anything else>` | Chrome first: serves a static file from the prebuilt chrome dir ([bundling](bundling.md)), with a path-traversal guard. On a chrome miss, falls back to **project asset serving**: the path is mapped onto the project root (root-contained; dotfile segments and `node_modules` refused) so a project's root-absolute asset URLs resolve exactly as on the consumer's own dev server. This is how the chrome reaches the three project→editor catalogs (`/catalog/materials.json`, `/catalog/entities.json`, `/catalog/agent.json`) and the archetype `/catalog/*.fmesh` meshes. Neither hit: missing chrome dir → `503` with a "run build:frontend" hint; otherwise `404`. |
| any other method | `404 not-found`. |

## Error handling at the route boundary

The `route` body is wrapped in a try/catch: a thrown `EditorError` becomes
`{ error: { code, message } }` at the code's HTTP status
([error-contract](error-contract.md)); any other thrown value becomes `500 internal` with the
error's message.

**Ahead of both sits the committed-response guard —
`if (res.headersSent) { res.destroy(); return; }`.** The `/mcp` branch returns with the
response already written (`res.headersSent` is true after every `handleRequest`, measured).
Without the guard a throw in that window makes `sendJson`'s `writeHead` throw a SECOND time
from inside the one typed-envelope edge, and that throw escapes an `async` function nobody
awaits — the same shape `requestUrl`'s move inside the try closed. `destroy()` rather than
`end()`: the response is mid-body and there is no honest way to append a refusal to a payload
a client is already parsing. Nothing in the branch throws there today, so the guard is
unpinnable by a black-box test and is kept on that argument rather than on a red test.

The `Origin` check sits INSIDE that try for exactly this reason — the catch is the daemon's
one typed-envelope edge, and a second emitter beside it would be a parallel path to keep in
step.

There is **no request body-size cap** — by design, since the daemon binds localhost and
serves a single user (`readBody` documents this; revisit if it ever accepts non-localhost
connections). **Authentication is out of scope** and stays so: `forbidden-origin` is a
rebinding refusal, not a credential check.

## What the daemon trusts, and where the untrusted bytes are actually checked

Three things are enforced HERE, and they are the whole list: the `Origin` (above), each
command's zod input schema at the one `dispatch()` choke point
([commands](commands.md)), and root containment on every path a command resolves
(`outside-root` in [error-contract](error-contract.md)).

Everything else the daemon touches, it does not interpret — **it reads and writes bytes.**
`field.load` base64s a world's chunks, `.mat` siblings and `oplog.json` off disk and hands
them to the browser without parsing any of it; the daemon holds no schema, no document and no
generator, so it has no predicate to apply.

That makes the daemon the **untrusted edge** and puts the real validation boundary one layer
on: **`parseOps` in `packages/core/src/field/artifact.ts` is where an oplog stops being bytes
and becomes typed engine objects, and nothing downstream re-examines them** — loaded ops go
straight into `log.ops` and never pass through `logApply`, whose appliers trust their input by
contract. `docs/reference/core-modules.md` § *the oplog wire format* carries the
checked/unchecked list and the measured failure modes. The editor's own authoring path is
validated separately and more strictly, at commit time (`assertOpValid` in
`packages/core/src/field/ops.ts`) — `parseOps` runs `assertOpStructure`, defined as that
predicate's table-independent half, so **an op the editor could commit can never fail to
load**.

Two things make that subset relation hold rather than merely describe it. `assertOpStructure`
and `assertOpValid` reach the shape check through **ONE definition** rather than two agreeing
copies: `assertShapeValid` covers sphere, box and capsule alike — finite centres and endpoints,
finite POSITIVE radii and half-extents, zero rejected with the negatives — behind an
exhaustiveness guard, so a fourth shape fails to compile rather than silently validating as a
box. And `parseOps` runs it on **both** of its brush decode paths, the native decode and the
legacy upgrade, so an early-format bake gets the same pass a current one does.

## `furnace.config.json` namespacing

`packages/editor/src/daemon/config.ts` reads the consumer's `furnace.config.json` from the
project root. The file is **shared with the `furnace` CLI** (Rust), so namespacing is
explicit:

- **Top level** belongs to the CLI (`identity`, `source`, `window`, …) — parsed **loosely**
  (`z.object`, unknown keys ignored). Not the editor's to validate.
- **The `"editor"` block** is the editor's namespace — parsed **strictly**
  (`z.strictObject`), so a typo'd key inside it fails loud (setup-loud policy). It has
  exactly one field: `extensions`, an optional path to the consumer's extension entry,
  relative to root. Because the block is strict, a project declaring a key the editor no
  longer reads fails setup-loud on `bun run edit` rather than being silently ignored.

If the file is absent, all editor settings fall back to defaults. Malformed JSON throws loud,
naming the file.
