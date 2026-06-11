# Editor Architecture

The as-built `@furnace/editor` package, milestones **M3** (editor shell) + **M4** (command layer). This is the reference — "how the editor IS today." The decision history that produced it lives in `docs/backlog/editor-and-tooling/editor-backend-architecture.md`; this doc describes the running system.

## 1. What the editor is

`@furnace/editor` is a **devDependency** of the consumer plus a long-running local daemon and a browser-served chrome. It is not a binary and not vendored into anything: the consumer adds it to `devDependencies` and runs it with a command, the Storybook/Vite model.

The editor contains **no engine**. This is the load-bearing invariant (called "project-first resolution"): every engine import — `@furnace/core`, the consumer's extensions, the viewport-host — is resolved and bundled *from the consumer's own `node_modules`*, never from the editor package's. The editor ships UI chrome and a daemon; the engine code is always the consumer's. (Verified: `packages/editor/package.json` declares `@furnace/core` only as a `devDependency`, used for types and the workspace symlink; the runtime engine bundle is built from the project root — see §3.)

**Dogfood / run command.** In `packages/hello-world`, `bun run edit` runs the `"edit"` script:

```
bun run --cwd ../editor build:frontend && bun ../editor/src/daemon/main.ts
```

It prebuilds the chrome (§7), then starts the daemon with the consumer's directory as the project root (`main.ts` uses `process.cwd()`). Source: `packages/hello-world/package.json` `"edit"`, `packages/editor/src/daemon/main.ts`.

## 2. The daemon

A **Node-portable** HTTP server. No `Bun.*` or `bun:*` anywhere in `src/` — enforced by the static scan in `packages/editor/tests/no-bun-leakage.test.ts` (regex-scans `src/` for Bun-API usage). It builds on `node:http`, `node:fs`, `node:path`, `node:crypto`, `node:os`, `node:url`; it runs under plain Node ≥20 and under Bun.

**Binding & lifecycle.** `startServer(opts)` (`src/daemon/server.ts`) creates a `node:http` server and listens on **`127.0.0.1`** only — one local single-user session. Port defaults to `4500` (`main.ts`), overridable with `--port`; tests pass `port: 0` to let the OS pick. `close()` tears down the server, the document session, the SSE hub, and the esbuild bundler context.

**Routes** (matched in this order in `server.ts`'s `route`):

| Method + path | Behaviour |
| --- | --- |
| `GET /engine.js` | Builds and returns the browser engine bundle (§3) as `text/javascript`. esbuild build failure → `500` with the diagnostics as plain text. |
| `GET /api/events` | Subscribes the response to the SSE change feed (§5). Stays open. |
| `POST /api/<command>` | Reads the request body, JSON-parses it (`{}` if empty body; invalid JSON → `400 invalid-json`), and `dispatch()`es the command (§4). Always `200` with the handler result, or the error envelope on an `EditorError`. |
| `GET <anything else>` | Serves a static file from the prebuilt chrome dir (§7), with a path-traversal guard. Missing dir → `503` with a "run build:frontend" hint; missing file → `404`. |
| any other method | `404 not-found`. |

**Error handling.** The `route` body is wrapped in a try/catch: a thrown `EditorError` becomes `{ error: { code, message } }` at the code's HTTP status (`httpStatus`, §6); any other thrown value becomes `500 internal` with the error's message. There is **no request body-size cap** — by design, since the daemon binds localhost and serves a single user (`readBody` documents this; revisit if it ever accepts non-localhost connections).

## 3. Project-first bundling — two targets

The daemon builds the consumer's engine code in **two** esbuild bundles, both resolving every import from the project root's `node_modules` so there is exactly **one** core / registry / zod instance (Branch A's instance-identity requirement).

**(a) Browser engine bundle** — `src/daemon/bundle.ts`, served at `GET /engine.js`. A virtual stdin entry imports the consumer's extensions (for their registration side-effects) then re-exports the viewport host:

```
import "<root>/<extensionsEntry>";          // when configured
export { createViewportHost } from "@furnace/editor/viewport-host";
```

esbuild bundles this `format: "esm"`, `write: false`, `sourcemap: "inline"`, with `resolveDir: root`. The bundler context is **incremental**: each `GET /engine.js` calls `ctx.rebuild()`. Build failure returns `{ ok: false, error }` carrying esbuild's formatted diagnostics.

**(b) Node-platform registry bundle** — `src/daemon/registry-bundle.ts`. The daemon needs the *same* registry the engine bundle has, but on the Node side for validation. Its virtual entry imports the consumer's extensions then re-exports exactly three names from the consumer's `@furnace/core/scene`:

```
import "<root>/<extensionsEntry>";          // when configured
export { validateDocument, introspect, CURRENT_SCENE_VERSION } from "@furnace/core/scene";
```

esbuild builds this `platform: "node"` to a **uniquely-named** temp `.mjs` (`furnace-editor-registry-<uuid>.mjs` in `os.tmpdir()`), which is then dynamically `import()`ed and immediately `rm`'d. The unique filename **is** the cache invalidation — Node caches module specifiers forever, so a fresh name forces a fresh import. (The temp path is canonicalized via `realpathSync` first: on macOS `os.tmpdir()` is a symlink and Bun's loader rejects a second `import()` of a fresh-UUID symlink path.) This is "the registry's third reader" — the editor reflects it, core's loader reads it at runtime, and now the daemon validates against it. Build or import failure throws `EditorError("extension-build-failed", …)`.

The registry loader exposes `reload()` (fresh build + import, used by `scene.open`) and `current()` (cached, building on first use — used by `scene.validate` / `scene.introspect` before any open).

**Staleness model.** The browser bundle rebuilds on every browser refresh (each `GET /engine.js`). The registry rebuilds per `scene.open` (`reload()`). There is **no extension-file watching**: editing an extension's TypeScript does not auto-rebuild — re-opening the scene (registry) or refreshing the browser (engine bundle) picks up the change. This is a known gap carried from M3 (§9).

## 4. Command registry + document session

### Command registry

`src/daemon/handlers.ts` builds a `Map<string, Handler>` where each `Handler` is `{ input: ZodType, run(input): Promise<unknown> }`. `dispatch(handlers, command, input)`:

1. unknown command → `EditorError("unknown-command")`;
2. `handler.input.safeParse(input)` fails → `EditorError("invalid-input", …)` naming the first failing path;
3. otherwise runs the handler with the parsed input.

Every client — the chrome, a curl, a future AI binding — funnels through `dispatch()`, so input validation lives in exactly one place. The command table (verified against `handlers.ts`):

| Command | Input schema | Returns |
| --- | --- | --- |
| `scene.list` | `{}` | `{ scenes: string[] }` — project-relative scene paths matching the config pattern, sorted. |
| `scene.read` | `{ path: string }` | `{ document }` — stateless read+parse (no session). |
| `scene.open` | `{ path: string, force?: boolean }` | `SessionView` — opens into the session. Dirty unsaved session + no `force` → `unsaved-changes`. |
| `scene.get` | `{}` | `SessionView` of the open document (`no-session` if none open). |
| `scene.save` | `{}` | `{ revision, dirty }` — writes the canonical document to disk. |
| `scene.validate` | exactly one of `{ path }` or `{ document }` | `{ valid: boolean, message? }` — registry validation, non-throwing result. |
| `scene.introspect` | `{}` | the registry's `introspect()` reflection (what is authorable). |
| `scene.addEntity` | `{ id?: string, components?: Record<string,unknown> }` | `{ id, revision, dirty }` — `id` may be generated. |
| `scene.removeEntity` | `{ id: string }` | `{ revision, dirty }` |
| `scene.setComponent` | `{ entity: string, component: string, params: Record<string,unknown> }` | `{ revision, dirty }` — add-or-replace the whole component value. |
| `scene.removeComponent` | `{ entity: string, component: string }` | `{ revision, dirty }` |
| `scene.setResource` | `{ table: "geometries"\|"shaders"\|"materials", id: string, entry: Record<string,unknown> }` | `{ revision, dirty }` |
| `scene.removeResource` | `{ table: …, id: string }` | `{ revision, dirty }` |
| `scene.setSettings` | `{ settings: unknown }` | `{ revision, dirty }` — whole-object settings replace. |
| `scene.undo` | `{}` | `{ revision, dirty }` |
| `scene.redo` | `{}` | `{ revision, dirty }` |

`SessionView` = `{ document, path, revision, dirty, conflict }`.

All input schemas are `z.strictObject(...)` (extra keys rejected). `scene.validate` additionally `.refine`s that **exactly one** of `path`/`document` is provided.

### Document session

`src/daemon/session.ts` owns the single mutable open document. The mutation commands never edit the document directly; they go through the transactional core, `session.apply(command, edit)`:

1. **clone** — `structuredClone(s.document)` (the live document is never mutated in place);
2. **edit** — run the pure structural edit (`src/daemon/mutations.ts`) on the clone; missing targets throw `EditorError("validation-failed")`;
3. **validate** — `registry.validateDocument(next)` (whole-document, against the daemon-side registry); failure throws `validation-failed` and the live document is untouched;
4. **commit** — swap the document reference, push undo, clear redo, bump `revision`, emit `document-changed`.

The mutation functions in `mutations.ts` (`addEntity`, `removeEntity`, `setComponent`, `removeComponent`, `setResource`, `removeResource`, `setSettings`) are **pure structural edits** that mutate the clone they are handed and enforce only target-existence preconditions; whole-document schema validation is the registry's job in step 3.

**Snapshot undo/redo.** The committed document object itself is the snapshot — because commits *swap* the reference and never mutate in place, no extra clone is needed for the undo stack. `undoStack` is capped at `UNDO_CAP = 100` (oldest dropped via `shift()`). A new mutation clears the redo stack. `undo`/`redo` swap between the stacks and bump `revision`, emitting `document-changed`. Empty stacks throw `nothing-to-undo` / `nothing-to-redo`.

**Dirty semantics — canonical `savedText`.** Dirtiness is defined as `serialize(document) !== savedText`, where `serialize` is the canonical form (`JSON.stringify(doc, null, 2)` + trailing newline) — *exactly the bytes `scene.save` writes*. `savedText` is reset on open, save, and clean reload. This single canonical-form comparison is what makes save-echo suppression (§5) and dirty detection share one definition; `scene.save` deliberately sets `savedText` **before** the write so a fast watcher echo already matches.

## 5. Change feed + file watching

### SSE change feed

`src/daemon/events.ts` is the SSE broadcaster. Events are **notification-only dirty-bits** — there is no payload protocol beyond the event itself; consumers refetch `scene.get`, so a slow consumer naturally coalesces N changes into one refetch. Each subscriber gets a 15 s heartbeat comment (`: ping`); the heartbeat interval is `unref`'d so it never holds the process open.

The event types are the `SessionEvent` union in `session.ts` (verified against the source):

| Event `type` | Payload fields | Emitted when |
| --- | --- | --- |
| `scene-opened` | `path`, `revision` | `scene.open` succeeds. |
| `document-changed` | `revision`, `command` | any commit — a mutation, `scene.undo` (`command: "scene.undo"`), `scene.redo`, or a clean disk reload (`command: "file-reload"`). |
| `saved` | `revision` | `scene.save` writes the file. |
| `file-conflict` | `path` | a disk change arrived while the session was dirty, or the watched file was deleted/became unreadable. |
| `file-invalid` | `path`, `message` | a disk change left the file as invalid JSON or failed registry validation. |

The SSE wire frame is `event: <type>\ndata: <json>\n\n`.

### File watching

`src/daemon/watch.ts` defines the `WatchFile` capability — `(path, onChange) => unwatch` — and its production adapter `chokidarWatchFile`, built on **chokidar v4** (pure JS over `node:fs`; v4 dropped the optional `fsevents` native dep). It watches one file with `ignoreInitial: true` and `awaitWriteFinish` (stability threshold 100 ms) so atomic-rename / burst saves settle before firing. Both `change` and `unlink` call `onChange`; the session re-reads and distinguishes by the read result. `WatchFile` is **injected** into the session as a capability so tests drive file-change semantics deterministically with a fake (the real chokidar is wired in only by `server.ts`).

`session.onFileChanged` is the reload logic, and it encodes the conflict matrix:

- **Echo suppression** — the on-disk content is parsed and compared by **canonical form** to `savedText`; if equal, nothing happened (covers both the daemon's own save echoing back through the watcher and genuine no-op rewrites) → no event.
- **Deleted / unreadable** — the read failed → `conflict = true`, emit `file-conflict`.
- **Invalid** — content is not JSON, or fails `registry.validateDocument` → emit `file-invalid` (with the message). The session keeps the in-memory document.
- **Dirty conflict** — the file genuinely changed *and* the session has unsaved edits → `conflict = true`, emit `file-conflict` (the user decides; no silent clobber).
- **Clean reload as an undoable mutation** — the file changed, the session was clean, and the new content validates → the reload is pushed onto the undo stack like any mutation, the document swaps, `revision` bumps, and `document-changed` (`command: "file-reload"`) is emitted. A disk edit by an external tool is thus a first-class, undoable session change.

## 6. Error contract

`src/daemon/errors.ts` defines a **closed string-code union** `EditorErrorCode`. Codes are the contract — clients branch on `code`; the human-readable `message` is for display only. Each transport edge owns its own mapping; the HTTP edge's table is `httpStatus(code)` (copied verbatim from `errors.ts`):

| `EditorErrorCode` | HTTP status | Meaning |
| --- | --- | --- |
| `invalid-input` | 400 | zod validation of a command's input failed. |
| `invalid-json` | 400 | request body or a scene file is not valid JSON. |
| `validation-failed` | 400 | a mutation's edit or post-edit `validateDocument` failed (missing target, schema violation). |
| `unknown-command` | 404 | no handler for the command name. |
| `not-found` | 404 | scene file does not exist (`ENOENT`). |
| `outside-root` | 404 | the resolved scene path escapes the project root. *(404, not 400 — don't reveal what exists outside root.)* |
| `no-session` | 409 | a session command ran with no scene open. |
| `unsaved-changes` | 409 | `scene.open` would discard unsaved edits without `force`. |
| `nothing-to-undo` | 409 | undo stack empty. |
| `nothing-to-redo` | 409 | redo stack empty. |
| `unreadable` | 500 | scene file exists but could not be read (EISDIR/EACCES/…). |
| `extension-build-failed` | 500 | the registry bundle failed to build or import. |
| `internal` | 500 | any other uncaught error at the route boundary. |

Wire shape on every error: `{ "error": { "code": "<EditorErrorCode>", "message": "<human text>" } }`.

## 7. Chrome

The browser frontend is **React 19 + dockview** (docking panel layout), Tailwind-styled. It is **prebuilt** to `dist/frontend` by `packages/editor/scripts/build-frontend.ts` (`bun run --cwd packages/editor build:frontend`) and served same-origin by the daemon's static route (§2). `bun run edit` rebuilds it before starting the daemon.

**Zero engine value-imports.** The chrome must never `import` `@furnace/core` at value level — doing so would create a *second* core instance alongside the engine bundle's, the exact bug project-first resolution prevents. This is enforced by `packages/editor/tests/frontend-no-engine-leakage.test.ts`, which scans `src/frontend` and forbids value imports / side-effect imports / value re-exports of `@furnace/core` (`import type` / `export type` are erased and allowed). The chrome reaches the engine **only** through `loadEngine()` (a dynamic `import("/engine.js")`) and the `ViewportHost` type (imported type-only, §below).

**`ViewportHost` protocol** — `src/viewport-host/index.ts`. The narrow chrome↔engine interface: `{ init(canvas, gpuOptions?), loadScene(doc), render(), introspect(), destroy() }`. The host owns the GPU context and the loaded scene; the chrome drives it through this interface and never enters the render loop. It is **render-on-demand** (no rAF loop): a render is issued on load, on canvas resize, and via `render()` for any other redraw.

- **Host owns resize-rendering.** On `loadScene`, the host calls `camera.bindToCanvas` (aspect tracks canvas size) and subscribes its own re-render via `gpu.onResize`. Because the engine's `onResize` sets the canvas backing store *before* emitting, the host's render runs at the new size. The chrome must **not** drive resize-rendering from its own `ResizeObserver` — that fires before the backing-store resize and blanks the surface. (This was a real bug caught only by the manual visual gate; the protocol TSDoc documents the constraint.)

**Module-level components + context-through-portals.** dockview reads its panel-component factory map only at panel construction, so a fresh map per render would freeze panels on their first render. `App.tsx` therefore keeps `COMPONENTS` (`entities` / `viewport` / `inspect`) at **module level** (stable identity), and the panels take no props — they read live state through `EditorContext` (a React Context threaded through dockview's portals). A fresh context value each render is what re-renders the portaled panels.

**Single `refreshSession` path.** `App.tsx` has exactly one document-refresh function: it pulls `scene.get`, reloads the viewport only when `(path, revision)` actually advanced, and dispatches the read model into the reducer. Every SSE event and every locally initiated change funnels through `refreshSession` — one code path for every client. The scene picker's `scene.open` does *not* load the viewport directly; it relies on the `scene-opened` SSE event driving `refreshSession`, so the chrome rides the same change feed as every other client. (`file-invalid` is the one event handled specially — it surfaces the message rather than refetching.)

## 8. `furnace.config.json` namespacing

`src/daemon/config.ts` reads the consumer's `furnace.config.json` from the project root. The file is **shared with the `furnace` CLI** (Rust), so namespacing is explicit:

- **Top level** belongs to the CLI (`identity`, `source`, `window`, …) — parsed **loosely** (`z.object`, unknown keys ignored). Not the editor's to validate.
- **The `"editor"` block** is the editor's namespace — parsed **strictly** (`z.strictObject`), so a typo'd key inside it fails loud (setup-loud policy). Fields: `scenes` (glob, default `"**/*.scene.json"`) and `extensions` (optional path to the consumer's extension entry, relative to root).

If the file is absent, all editor settings fall back to defaults. Malformed JSON throws loud, naming the file.

## 9. Deferred

- **AI bindings** — MCP mount, `viewport.capture`, embedded agent, and outbound editor→LLM were **descoped from M4** into a dedicated milestone: `docs/backlog/editor-and-tooling/editor-ai-integration-milestone.md`. Rationale: for an FS-capable agent, direct file editing beats mutation tools, so M4 made disk edits first-class (watch + reload + validate + introspect over plain HTTP) and shipped the transport-agnostic substrate; the bindings get designed together when appetite is there (slot after M5). The error contract and the `MCP/agent bindings` notes in `errors.ts` / `handlers.ts` are the forward-looking seam for that work.
- **Extension-file watching** — editing an extension's TypeScript does not auto-rebuild the engine bundle or registry; re-open the scene / refresh the browser to pick up changes (§3). Known gap carried from M3.
- **Mutation UI in the chrome** — M4's chrome only *reflects* the session (display-only). Inspector / hierarchy / gizmo authoring surfaces are M5 (`docs/backlog/editor-and-tooling/svelte-editor-inspector-surfaces.md`).
- **Session concurrent-open race hardening** — two await-point races in `session.ts` (`onFileChanged` / `apply` capturing stale `state` across an await) are benign under the single-user serialized-command model and deferred with a staleness-guard fix: `docs/backlog/editor-and-tooling/session-concurrent-open-race-hardening.md`. Becomes load-bearing when M5 adds continuous interactions or a second concurrent writer.
