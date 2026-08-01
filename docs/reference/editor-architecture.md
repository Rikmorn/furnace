# Editor Architecture

The as-built `@furnace/editor` package, milestones **M3** (editor shell) + **M4** (command layer) + **M5A** (inspector) + **M5B** (viewport interaction), plus the **M1-slices** registration batch (the full built-in set + physics-from-data in the core loader), plus the **Epic 3 cockpit slices** — **3.0** (editor-openable dungeon, extensions-dir watch) and **3.1** (the generation loop: a preview host, the `generation.bake` command, and an ephemeral generation session; §13), **3.2** (the editor foundation pass — design-system tokens, menu bar + global keybindings, UI persistence, viewport reference layer + dolly navigation, inspector IA + humanized labels; §14), and **3.2.3** (cockpit hardening — generation moved onto a worker, with instant mid-run cancel; §13.6), plus the **One Field phase** — **F1+F2a** (the Field panel + `FieldHost` over `@furnace/core/field`; §15), **F2b** (the palette — brush chassis, selection, stamp generators, layers + slice; §16), **F3a** (smart objects — reconfigure/freeze/bake; §17), **F3b** (scatter authoring, placed props, the void cast, the segment brush; §18), **F4** (the walkability advisor; §19) and **F4.5a** (the overlay shell — full-window canvas, floating palettes, the world drawer, the notify system, studio shading; **§20**). This is the reference — "how the editor IS today." The decision history that produced it lives in `docs/backlog/editor-and-tooling/editor-backend-architecture.md`; this doc describes the running system.

> **Epic status (2026-06-14): the editor epic is complete and paused.** M1→M5B + M1-slices landed and sealed. The originally-planned **M6** (behaviour runtime) and **M7** (porting + docs) are **dropped** — the project retargeted from the bowling demo to its actual application (a first-person dungeon crawler), so future editor work is driven by that app's **procedural-authoring** needs rather than the old milestone ladder. The known gaps a future editor pass must address are captured in `docs/backlog/editor-and-tooling/editor-interaction-model-redesign.md`.
>
> **Update (Epic 3, 2026-07-06):** the cockpit slices reopened editor work along exactly that procedural-authoring axis — the editor now generates, previews, curates, and bakes procedural world content (§13) — while keeping the editor engine-free (the consumer's generator arrives through the engine bundle's `extensions` namespace).
>
> **⚠ Update (F4.5a, 2026-07-30) — READ §20 FIRST for anything about the chrome.** The
> overlay-shell slice retired the dock, the field toolbar, the World panel and the whole
> scene-document chrome. **§20 is the authority on the frontend as it stands**; §7 and
> §10–§14 are kept as the history that produced it and are stale wherever they describe a
> panel, a layout, a keybinding or a component. Each carries its own marker below. The
> daemon sections (§2–§6, §8) are unaffected and still current. A full merge of the
> superseded sections into §20 is scheduled for the F4.5 seal — this section landed at
> F4.5a so the doc stops asserting a chrome that no longer exists.

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
| `GET <anything else>` | Chrome first: serves a static file from the prebuilt chrome dir (§7), with a path-traversal guard. On a chrome miss, falls back to **project asset serving**: the path is mapped onto the project root (root-contained; dotfile segments and `node_modules` refused) so root-absolute sidecar URLs in scene documents — e.g. the dungeon's `/regions/*.fmesh`, fetched same-origin by the browser-side `loadScene` — resolve exactly as on the consumer's own dev server (added at the 3.0 gate, where region-cavern's `.fmesh` 404'd). Neither hit: missing chrome dir → `503` with a "run build:frontend" hint; otherwise `404`. |
| any other method | `404 not-found`. |

**Error handling.** The `route` body is wrapped in a try/catch: a thrown `EditorError` becomes `{ error: { code, message } }` at the code's HTTP status (`httpStatus`, §6); any other thrown value becomes `500 internal` with the error's message. There is **no request body-size cap** — by design, since the daemon binds localhost and serves a single user (`readBody` documents this; revisit if it ever accepts non-localhost connections).

## 3. Project-first bundling — two targets

The daemon builds the consumer's engine code in **two** esbuild bundles, both resolving every import from the project root's `node_modules` so there is exactly **one** core / registry / zod instance (Branch A's instance-identity requirement).

**(a) Browser engine bundle** — `src/daemon/bundle.ts`, served at `GET /engine.js`. A virtual stdin entry imports the consumer's extensions (for their registration side-effects), re-exports the two engine hosts, and re-exports the consumer's extension module as a **namespace**:

```
import "<root>/<extensionsEntry>";                          // registration side-effects, when configured
export { createViewportHost, createPreviewHost } from "@furnace/editor/viewport-host";
export * as extensions from "<root>/<extensionsEntry>";     // the consumer's public surface, when configured
```

esbuild bundles this `format: "esm"`, `write: false`, `sourcemap: "inline"`, with `resolveDir: root`. The bundler context is **incremental**: each `GET /engine.js` calls `ctx.rebuild()`. Build failure returns `{ ok: false, error }` carrying esbuild's formatted diagnostics.

`createPreviewHost` is the Slice 3.1 cockpit preview surface (§13.1). The `export * as extensions` is the **cockpit generator seam** (§13.2): it re-exports the same extension module the bare side-effect import already runs — so registration still fires exactly once — this time as a value namespace the World panel and the generation worker call the consumer's generator through (`runWorld` / `bakeWorldFiles` / `realizeRegion` / `MaterialCache` / `worldDir` — §13.2). When no extensions entry is configured the bundle emits `export const extensions = {}`. `EngineModule` (`frontend/lib/engine.ts`, the `loadEngine()` return type) is correspondingly `{ createViewportHost, createPreviewHost, extensions }` with `extensions: Record<string, unknown>`.

**(b) Node-platform registry bundle** — `src/daemon/registry-bundle.ts`. The daemon needs the *same* registry the engine bundle has, but on the Node side for validation. Its virtual entry imports the consumer's extensions then re-exports exactly three names from the consumer's `@furnace/core/scene`:

```
import "<root>/<extensionsEntry>";          // when configured
export { validateDocument, introspect, CURRENT_SCENE_VERSION } from "@furnace/core/scene";
```

esbuild builds this `platform: "node"` to a **uniquely-named** temp `.mjs` (`furnace-editor-registry-<uuid>.mjs` in `os.tmpdir()`), which is then dynamically `import()`ed and immediately `rm`'d. The unique filename **is** the cache invalidation — Node caches module specifiers forever, so a fresh name forces a fresh import. (The temp path is canonicalized via `realpathSync` first: on macOS `os.tmpdir()` is a symlink and Bun's loader rejects a second `import()` of a fresh-UUID symlink path.) This is "the registry's third reader" — the editor reflects it, core's loader reads it at runtime, and now the daemon validates against it. Build or import failure throws `EditorError("extension-build-failed", …)`.

The registry loader exposes `reload()` (fresh build + import, used by `scene.open`), `current()` (cached, building on first use — used by `scene.validate` / `scene.introspect` before any open), and `invalidate()` (drops the cached module so the next `current()` rebuilds — fired by the extensions-dir watch, §5).

**Staleness model.** The browser bundle rebuilds on every browser refresh (each `GET /engine.js`); the registry rebuilds per `scene.open` (`reload()`), and on demand (`invalidate()`, below). Historically the browser had no way to *know* an extension's TypeScript had changed, so a refresh had to be manual. Slice 3.0 closed that half (§5, "Directory watching"): `server.ts` watches the extensions entry's directory and emits `bundle-outdated` over SSE, and the frontend reloads the page when the session isn't dirty — so `GET /engine.js` picks up the change automatically instead of waiting for a manual refresh. **Slice 3.1 closed the registry half**: the same extensions-dir watch now also calls `registry.invalidate()` (drops the cached module) *before* emitting `bundle-outdated`, so the next `current()` rebuilds. Editing an extension's TypeScript under the watched directory is therefore reflected in `scene.validate` / `scene.introspect` and in a running mutation's validation (`session.apply`) without waiting for an explicit `scene.open`.

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
| `project.get` | `{}` | `{ root }` — the absolute project root; the chrome scopes its persistence store by it (§14.3). |
| `generation.bake` | `{ files: WireFile[], cleanDir?: string }` (each file `{ path, encoding: "utf8"\|"base64", contents }`) | `{ files: <count written> }` — writes a browser-uploaded, root-contained file set and emits `generation-baked`; when `cleanDir` is given, `rm -rf`s that (validated: root-contained, no dotfile segments, every payload file under it) BEFORE writing (§13.3, Slice 3.1/3.2.1). |

`SessionView` = `{ document, path, revision, dirty, conflict, canUndo, canRedo }` (the last two drive the Edit-menu + toolbar undo/redo enabled state; §14.2).

All input schemas are `z.strictObject(...)` (extra keys rejected). `scene.validate` additionally `.refine`s that **exactly one** of `path`/`document` is provided.

### Document session

`src/daemon/session.ts` owns the single mutable open document. The mutation commands never edit the document directly; they go through the transactional core, `session.apply(command, edit)`:

1. **clone** — `structuredClone(s.document)` (the live document is never mutated in place);
2. **edit** — run the pure structural edit (`src/daemon/mutations.ts`) on the clone; missing targets throw `EditorError("validation-failed")`;
3. **validate** — `registry.validateDocument(next)` (whole-document, against the daemon-side registry); failure throws `validation-failed` and the live document is untouched;
4. **commit** — swap the document reference, push undo, clear redo, bump `revision`, emit `document-changed`.

The mutation functions in `mutations.ts` (`addEntity`, `removeEntity`, `setComponent`, `removeComponent`, `setResource`, `removeResource`, `setSettings`) are **pure structural edits** that mutate the clone they are handed and enforce only target-existence preconditions; whole-document schema validation is the registry's job in step 3.

**Concurrent-open await guards.** Both `session.apply` (across step 3's `registry.current()` await) and the watch-driven `onFileChanged` reload (across its `readFile` and `registry.current()` awaits) capture the open `state` into a local `s` and re-check `s !== state` after each await — a concurrent `scene.open` / `dispose` may have swapped the open document while the promise was pending. They diverge on what they owe the caller: `onFileChanged` **silently drops** the reload on a swap (file-reload events are notification-only dirty-bits — nothing is owed), while `apply` **throws `no-session`** ("session was replaced while the edit was validating") because it owes its caller an answer — the reroll-era client refetches via `scene.get` and retries if still relevant. Covered by `tests/session-race.test.ts`.

**Snapshot undo/redo.** The committed document object itself is the snapshot — because commits *swap* the reference and never mutate in place, no extra clone is needed for the undo stack. `undoStack` is capped at `UNDO_CAP = 100` (oldest dropped via `shift()`). A new mutation clears the redo stack. `undo`/`redo` swap between the stacks and bump `revision`, emitting `document-changed`. Empty stacks throw `nothing-to-undo` / `nothing-to-redo`.

**Dirty semantics — canonical `savedText`.** Dirtiness is defined as `serialize(document) !== savedText`, where `serialize` is the canonical form (`JSON.stringify(doc, null, 2)` + trailing newline) — *exactly the bytes `scene.save` writes*. `savedText` is reset on open, save, and clean reload. This single canonical-form comparison is what makes save-echo suppression (§5) and dirty detection share one definition; `scene.save` deliberately sets `savedText` **before** the write so a fast watcher echo already matches.

## 5. Change feed + file watching

### SSE change feed

`src/daemon/events.ts` is the SSE broadcaster. Events are **notification-only dirty-bits** — there is no payload protocol beyond the event itself; consumers refetch `scene.get`, so a slow consumer naturally coalesces N changes into one refetch. Each subscriber gets a 15 s heartbeat comment (`: ping`); the heartbeat interval is `unref`'d so it never holds the process open.

The feed carries `DaemonEvent = SessionEvent | { type: "bundle-outdated" } | { type: "generation-baked"; files: number }` (`src/daemon/events.ts`, verified against the source) — daemon-level events ride the same feed as the document-session's own `SessionEvent` union (`session.ts`):

| Event `type` | Payload fields | Emitted when |
| --- | --- | --- |
| `scene-opened` | `path`, `revision` | `scene.open` succeeds. |
| `document-changed` | `revision`, `command` | any commit — a mutation, `scene.undo` (`command: "scene.undo"`), `scene.redo`, or a clean disk reload (`command: "file-reload"`). |
| `saved` | `revision` | `scene.save` writes the file. |
| `file-conflict` | `path` | a disk change arrived while the session was dirty, or the watched file was deleted/became unreadable. |
| `file-invalid` | `path`, `message` | a disk change left the file as invalid JSON or failed registry validation. |
| `bundle-outdated` | none beyond `type` | a source file under the extensions entry's directory changed (§5, "Directory watching") — the browser should reload to pick up the freshly-rebuilt `/engine.js`. |
| `generation-baked` | `files` (count written) | `generation.bake` wrote the browser-uploaded file set to the project root (§13.3, Slice 3.1). |

The SSE wire frame is `event: <type>\ndata: <json>\n\n` — `bundle-outdated` and `generation-baked` ride it generically, same as every other event. The frontend `ServerEvent` union + `EVENT_TYPES` subscription list (`frontend/lib/events.ts`) mirror this daemon union and are kept in lockstep.

### File watching

`src/daemon/watch.ts` defines the `WatchFile` capability — `(path, onChange) => unwatch` — and its production adapter `chokidarWatchFile`, built on **chokidar v4** (pure JS over `node:fs`; v4 dropped the optional `fsevents` native dep). It watches one file with `ignoreInitial: true` and `awaitWriteFinish` (stability threshold 100 ms) so atomic-rename / burst saves settle before firing. Both `change` and `unlink` call `onChange`; the session re-reads and distinguishes by the read result. `WatchFile` is **injected** into the session as a capability so tests drive file-change semantics deterministically with a fake (the real chokidar is wired in only by `server.ts`).

### Directory watching

`src/daemon/watch.ts` also defines the `WatchDir` capability — `(dir, onChange) => unwatch` — and its production adapter `chokidarWatchDir`: a **chokidar v4 recursive watch** over `dir` (`node_modules` and `dist` paths ignored), firing `onChange` on any `add`/`change`/`unlink` beneath the tree (chokidar's `"all"` event, debounced by the same `awaitWriteFinish` settling as `WatchFile`). Like `WatchFile`, it is **injected** — `server.ts` takes an optional `watchDir` in `ServerOptions` for tests to fake, defaulting to the real `chokidarWatchDir` in production.

`server.ts` wires this to close the inner-loop staleness gap (§3): when `config.extensions` is set, it watches `dirname(resolve(root, config.extensions))` — the consumer's extensions-entry directory — and on any change calls `registry.invalidate()` (Slice 3.1 — so the daemon-side registry rebuilds on the next command; §3, Staleness model) *then* emits `hub.emit({ type: "bundle-outdated" })`. The frontend (`App.tsx`) reloads the page on that event when the session isn't dirty; if dirty, it leaves the reload to the user rather than risk losing unsaved edits.

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

> **Superseded by §20 for the chrome (F4.5a).** The dock, the `ViewportHost` protocol,
> the portaled panels and `refreshSession` are all gone; what stands is the build/serve
> path (first paragraph) and the zero-engine-value-imports rule, which §20 restates.

The browser frontend is **React 19**, Tailwind-styled (the **dockview** docking layout it
used through F4 is retired — §20). It is **prebuilt** to `dist/frontend` by `packages/editor/scripts/build-frontend.ts` (`bun run --cwd packages/editor build:frontend`) and served same-origin by the daemon's static route (§2). `bun run edit` rebuilds it before starting the daemon.

**Zero engine value-imports.** The chrome must never `import` `@furnace/core` at value level — doing so would create a *second* core instance alongside the engine bundle's, the exact bug project-first resolution prevents. This is enforced by `packages/editor/tests/frontend-no-engine-leakage.test.ts`, which scans `src/frontend` and forbids value imports / side-effect imports / value re-exports of `@furnace/core` (`import type` / `export type` are erased and allowed). The chrome reaches the engine **only** through `loadEngine()` (a dynamic `import("/engine.js")`) and the `ViewportHost` type (imported type-only, §below).

**`ViewportHost` protocol** — `src/viewport-host/index.ts`. The narrow chrome↔engine interface: `{ init(canvas, gpuOptions?), loadScene(doc), render(), introspect(), destroy() }` plus the M5A live-preview seam (`previewEntity`, `previewSettings`, `revertEntity`, `syncCommitted` — §10). The host owns the GPU context and the loaded scene; the chrome drives it through this interface and never enters the render loop. It is **render-on-demand** (no rAF loop): a render is issued on load, on canvas resize, and via `render()` for any other redraw.

- **Host owns resize-rendering.** On `loadScene`, the host calls `camera.bindToCanvas` (aspect tracks canvas size) and subscribes its own re-render via `gpu.onResize`. Because the engine's `onResize` sets the canvas backing store *before* emitting, the host's render runs at the new size. The chrome must **not** drive resize-rendering from its own `ResizeObserver` — that fires before the backing-store resize and blanks the surface. (This was a real bug caught only by the manual visual gate; the protocol TSDoc documents the constraint.)

**Module-level components + context-through-portals** *(historical — the dock is gone; §20)*. dockview read its panel-component factory map only at panel construction, so a fresh map per render would freeze panels on their first render. `App.tsx` therefore kept `COMPONENTS` (`entities` / `viewport` / `inspect`) at **module level** (stable identity), and the panels took no props — they read live state through `EditorContext` (a React Context threaded through dockview's portals). A fresh context value each render is what re-rendered the portaled panels. Today the shell is a plain subtree and the context is read directly.

**Single `refreshSession` path.** `App.tsx` has exactly one document-refresh function: it pulls `scene.get`, reloads the viewport only when `(path, revision)` actually advanced, and dispatches the read model into the reducer. Every SSE event and every locally initiated change funnels through `refreshSession` — one code path for every client. The scene picker's `scene.open` does *not* load the viewport directly; it relies on the `scene-opened` SSE event driving `refreshSession`, so the chrome rides the same change feed as every other client. (`file-invalid` is the one event handled specially — it surfaces the message rather than refetching.)

## 8. `furnace.config.json` namespacing

`src/daemon/config.ts` reads the consumer's `furnace.config.json` from the project root. The file is **shared with the `furnace` CLI** (Rust), so namespacing is explicit:

- **Top level** belongs to the CLI (`identity`, `source`, `window`, …) — parsed **loosely** (`z.object`, unknown keys ignored). Not the editor's to validate.
- **The `"editor"` block** is the editor's namespace — parsed **strictly** (`z.strictObject`), so a typo'd key inside it fails loud (setup-loud policy). Fields: `scenes` (glob, default `"**/*.scene.json"`) and `extensions` (optional path to the consumer's extension entry, relative to root).

If the file is absent, all editor settings fall back to defaults. Malformed JSON throws loud, naming the file.

## 9. Deferred

- **AI bindings** — MCP mount, `viewport.capture`, embedded agent, and outbound editor→LLM were **descoped from M4** into a dedicated milestone: `docs/backlog/editor-and-tooling/editor-ai-integration-milestone.md`. Rationale: for an FS-capable agent, direct file editing beats mutation tools, so M4 made disk edits first-class (watch + reload + validate + introspect over plain HTTP) and shipped the transport-agnostic substrate; the bindings get designed together when appetite is there (slot after M5). The error contract and the `MCP/agent bindings` notes in `errors.ts` / `handlers.ts` are the forward-looking seam for that work.
- **Remaining viewport/hierarchy work deferred from M5B** — resource live-preview (`rebuildResource` cascade), editor fly-camera (WASD), and hierarchy tree (requires scene-format parent decision). See `docs/backlog/editor-and-tooling/editor-M5B-viewport-interaction.md`.

*(Two gaps this section previously listed as deferred were resolved in Slice 3.1 and are now documented inline as current behaviour: registry staleness on extension edits — §3, Staleness model + §5, Directory watching; and the session concurrent-open await races — §4, Concurrent-open await guards.)*

## 10. M5A — inspector, selection, live preview

> **Superseded by §20 (F4.5a): the scene-document half is deleted code.** No
> `InspectPanel.tsx`, no `EntitiesPanel.tsx`, no entity selection in the reducer, no
> live-preview/echo-suppression path — the chrome no longer speaks `scene.*` at all
> (the daemon still implements the family; nothing calls it). **What survives is
> `frontend/inspector/`** — `SchemaForm`, the kind→renderer registry, the scrub
> affordance — reused wholesale by `field/StampInspector.tsx` for stamp and
> reconfigure params. Read §10.2–§10.5 for the inspector module; treat §10.1, §10.6,
> §10.7 and §10.8 as history.


M5A landed an **editable, reflection-driven inspector** with multi-entity selection and live-preview. This section documents the as-built additions to the M3+M4 substrate.

### 10.1 `scene.batch` command

A single command that atomically applies N component edits (one `SceneDocument` snapshot, one undo entry, one `document-changed` event). Used when the inspector commits a field change across multiple selected entities at once. The whole batch is rejected if any single `setComponent` call fails validation — the session document is untouched (same transactional guarantee as any other `session.apply` call). Input: `{ edits: [{ entity, component, params }]+ }` (at least one edit). Returns `{ revision, dirty }`.

### 10.2 `t.color()` kind

`packages/core/src/scene/t.ts` exports `color()`: a `z.tuple([number × 4])` with `meta({ furnace: { kind: "color" } })` — same wire shape as `vec4()` but a distinct `furnace.kind` so the editor inspector renders a color picker instead of four raw number inputs. The load boundary treats it exactly as a vec4. Channels are in the engine's working color space (linear RGBA — see `docs/reference/engine-conventions.md §color`). Scene settings `clearColor` uses this kind.

### 10.3 Core live-preview seam — `rebuildEntity` + `setSettings`

`LoadedScene` (returned by `scene.loadScene`) carries two new methods (both verified in `packages/core/src/scene/types.ts` and `loader.ts`):

- **`rebuildEntity(entityId, doc)`** — tears down the named entity's built instances/meshes, then rebuilds it from `doc` using the same internal `buildEntity` path that `loadScene` uses. **Transactional**: the replacement is built *before* the old entity is torn down — if `buildEntity` throws (invalid params, bad resource ref), the existing entity is left intact and the throw propagates to the caller. The resource `lookup` is frozen at `loadScene` time; a `doc` whose `resources` differ from the loaded document is not supported (lookup would throw). In M5A the caller always passes the committed doc with one component's fields overridden, so resources never change.
- **`setSettings(next)`** — replaces `loaded.settings` in place (no rebuild); the next `frame.render` call picks up the new settings. No-op complexity; purely a field swap.

Both are editor live-preview seams. They are not safe to call after `loaded.destroy()`.

### 10.4 Viewport-host live-preview methods

`src/viewport-host/index.ts` extends `ViewportHost` with four methods that close the loop between the inspector and the engine (verified in source):

| Method | What it does |
| --- | --- |
| `previewEntity(entityId, component, params)` | Clones the committed doc, overrides `entity.components[component]`, calls `loaded.rebuildEntity`, re-renders. Invalid params are swallowed (last good render kept) — the daemon commit path reports the real validation error. No-op before init or before a scene is loaded. |
| `previewSettings(settings)` | Calls `loaded.setSettings(settings)`, re-renders. No daemon op. No-op before init. |
| `revertEntity(entityId)` | Calls `loaded.rebuildEntity(entityId, committedDoc)`, re-renders — discards the preview and restores from the committed baseline. |
| `syncCommitted(doc)` | Adopts `doc` as the new committed baseline without any rebuild or render — used when an SSE echo is deduplicated (the viewport already shows the result via the local preview). |

**`committedDoc`** is the `SceneDocument` the viewport last successfully loaded; it is the revert target for `revertEntity`. It is set on every `loadScene` call and updated (without reload) by `syncCommitted`.

### 10.5 Inspector module — `frontend/inspector/`

The inspector is a **self-contained, swappable boundary**: the chrome consumes it only through `<SchemaForm>` and the types in `index.tsx`. Input is standard JSON Schema (with a root-level `furnace` field-semantics key) plus N target values plus change callbacks; output is rendered controls. Swapping the inspector library touches only this directory.

**JSON Schema contract (`types.ts`).** The inspector's `JsonSchemaNode` is a plain frontend-local type. It was structurally equivalent to what `scene.introspect()` returned, cast at the boundary in `InspectPanel.tsx`; both died with the scene surface, and the only cast today is in `SessionCard.tsx`, where a generator's `paramSchema` (typed `Record<string, unknown>` in core, because the chrome cannot value-import it) becomes a `JsonSchemaNode`. The module must not value-import `@furnace/core` — enforced by `packages/editor/tests/frontend-no-engine-leakage.test.ts`.

**Kind resolution (`kind.ts`).** `resolveKind(schema)` maps a schema node to a `FieldKind` in priority order: `schema.furnace.kind` (for furnace-specific kinds) → `enum` (by CARDINALITY) → numeric SHAPE → JSON type string → `"unknown"`. The furnace kinds handled: `vec2`, `vec3`, `vec4`, `quat`, `color`, `resource`, `ref`. **Note:** `furnace` sits at the schema-node ROOT, not nested under `meta` — `z.toJSONSchema` hoists zod's `.meta({ furnace })` to the node root. (Reading it from `meta` was the M5A holistic-review CRITICAL bug.) Every member of `furnace` is optional, `kind` included, so a node can carry only a `unit`.

**Shape rules (D-25, F4.5b Task 11).** Two kinds are chosen from the schema's SHAPE rather than from a `furnace.kind`, and both decisions live in `resolveKind` so the registry keeps its single lookup:

- an `enum` of **≤ 4** members → `segmented`; above that → `enum` (the Select).
- a **bounded** number (`minimum` and `maximum` both finite, `lib/numeric-schema.ts`) → `stepper` when every reachable value is a whole number AND the step spans ≤ 12 intervals, else `slider`. An unbounded number keeps `number`.

The bounded control's STEP comes from `multipleOf` when the schema declares one, from `type: "integer"`, or otherwise from the span (a 1-2-5 value near span/100). It is never inferred from how the bounds happen to look: `cave.chamberRadius` has integer bounds `[3, 8]` and `numParam` admits 5.5 m. Core's generator schemas carry `multipleOf: 1` on exactly the params `intParam` narrows, and `furnace.unit` on the params whose unit is not already in their name (`"m"` on `cave.chamberRadius` / `scatter.minSpacing`, `"cells"` on the hall's dimensions — a hall of width 8 is 4 m across). Both annotations are declarative: nothing in core reads either, and `packages/core/tests/field-generators.test.ts` asserts the `multipleOf` half BEHAVIOURALLY (a fractional value must be refused iff the schema claims it).

**Kind→renderer registry (`registry.tsx`).** A `Partial<Record<FieldKind, FieldRenderer>>` maps each kind to its React component. Current registry (verified against source):

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
| `resource` / `ref` | `DefaultField` — READ-ONLY JSON. The pickers were deleted in F4.5b Task 11: their option lists came from an `InspectorOptions` context that had had no provider since the scene surface was removed, so they always offered an empty list. The kinds stay in the union because a schema can still name them. |
| `object` | `ObjectField` — nested properties |

`fallbackRenderer` is `DefaultField` — displays the value as JSON read-only.

**`<SchemaForm>` (`SchemaForm.tsx`).** Iterates `schema.properties`, resolves each field's kind, looks up (or falls back to) the renderer, and renders it wrapped in a **`RowErrorBoundary`** — a React class error boundary that catches per-row render errors and displays them inline without crashing the whole form. Manages N working drafts (`useState`); re-seeds them when the committed `values` reference changes (the `seed` ref guard). Props: `{ schema, values: unknown[], onPreview, onCommit, onCancel, onInvalid? }` — a pure callback contract, no internal fetch or mutation.

**Field-level validation (D-25).** Before fanning a draft, the form runs `validateNumber(fieldSchema, value)` (`lib/validate.ts`: bounds + `multipleOf`) over all N targets. A refused draft is **not written and not previewed** — the worker never evaluates a ghost the generator would throw on — and the reason renders in that row with `role="alert"`. Refusals are held per-path (an unrelated row's edit must not clear one whose bad text is still on screen), but only the FIRST offending field in schema order leaves the component, through `onInvalid`. One slot, not a bag: a consumer holding a list is one render away from printing a bottom-of-form dump, which is the pattern D-25 exists to retire. `SessionCard` turns that slot into the commit verb's disabled reason (`"Chamber Radius must be at most 8"`) and retracts it on unmount.

**Row wrappers (`fields/common.tsx`).** `FieldRow` wraps its control in a `<label>`; `FieldGroupRow` uses a `<div>` and is what a row with SEVERAL controls (stepper, segmented) uses. A `<label>` labels exactly one control, so wrapping a group makes every member answer to the row caption instead of its own name, and a `<label>` with no `for` activates its first labelable descendant — clicking the "Chambers" caption steps the value down. (A third symptom, one press dispatching two commits, is a happy-dom artifact rather than a browser defect — WHATWG says a label does nothing for events targeted at interactive content descendants — but it is what made the wrapper visible, through a call-count assertion.)

**Euler / quat duplication (`lib/euler.ts`).** The `quatToEulerDeg` / `eulerDegToQuat` math is hand-rolled in the inspector because the frontend cannot value-import `@furnace/core`. The conversion matches `core/transform quat.fromEuler` (intrinsic XYZ) and is pinned to core's convention by a test. It is the only remaining frontend duplication of core logic in this module — the material `"default"`-kind detection that used to sit beside it (`lib/resource-kind.ts`) travelled out with the resource/ref pickers in F4.5b Task 11.

**Swap escape hatch.** The `frontend/inspector/` boundary is the swap seam: replacing the rendering library means rewriting only `SchemaForm.tsx` + the field renderers in `fields/`, keeping the module's CONSUMER untouched — `<InspectPanel>` when this was written, `SessionCard.tsx` today, and it is the only one. The `JsonSchemaNode` type and the `onPreview`/`onCommit`/`onCancel`/`onInvalid` callback contract are the stable interface.

### 10.6 Multi-entity selection

`EditorState.selectedEntities` (`src/frontend/lib/state.ts`) is a `string[]` of entity ids. The `select-entity` reducer event supports three modes (verified in `reduce()`):

| Mode | Behaviour |
| --- | --- |
| `replace` | Replace selection with this entity; set anchor. |
| `toggle` | Add if not in selection, remove if already present; set anchor. |
| `range` | Select the document-order range from `selectionAnchor` to this entity (inclusive). Anchor is not updated. |

`EntitiesPanel` triggers `replace` on a plain click, `toggle` on Cmd/Ctrl-click, `range` on Shift-click (modifier detection in `EntitiesPanel.tsx`). Selection is **not undoable** — it is UI ephemeral state and does not go through `session.apply`.

When a `session-updated` event arrives, any selected entity id that no longer exists in the new document is pruned from `selectedEntities` automatically (the reducer filters against `e.doc.entities`).

### 10.7 Echo suppression — own-commit dedup

`App.tsx` keeps `lastLoaded = useRef<{ path?, revision? }>({})`. When a commit action resolves, `suppressEcho(result)` records `{ path, revision }` so the next SSE `document-changed` event's `refreshSession` skips `loadScene` (the dedup check `path === lastLoaded.path && revision === lastLoaded.revision`). On the skip path, `syncCommitted(doc)` is still called to update the host's committed baseline (so `revertEntity` has the fresh doc). This is the as-built mechanism in `App.tsx`.

The guard applies to entity-component commits (`commitComponents`) and settings commits (`commitSettings`). Resource commits (`commitResource`) do **not** suppress the echo — a resource change requires a full scene reload (no resource live-preview in M5A), so the SSE echo driving `loadScene` is the intended mechanism.

The `scene-opened` event clears `lastLoaded` entirely (`lastLoaded.current = {}`) to force a reload even if `(path, revision)` collide with a previous load.

### 10.8 Settings-revert gap (M5A known limitation)

M5A has `revertEntity` (rebuilds from committed doc) but **no `revertSettings`**. When the user previews a settings field (e.g. `clearColor`) and then presses Escape, the `onCancel` path in `InspectPanel.tsx` is a no-op: the preview value stays in the engine until the next SSE `document-changed` event drives a `loadScene` reload. Entity edits revert cleanly; settings edits do not. This gap is noted inline in `InspectPanel.tsx` and tracked in `docs/backlog/editor-and-tooling/editor-M5B-viewport-interaction.md`.

## 11. M5B — viewport interaction (picking, gizmos, orbit camera, drag-scrub)

> **Superseded by §20 (F4.5a): this whole section describes deleted code.** GPU-id
> picking, the AABB selection highlight, the translate gizmo, `setSelection` /
> `setCallbacks` / `onTransformCommit` and the scene orbit camera are gone with the
> scene viewport host.
>
> Of the two pure-math modules they left behind with no caller (the backlog entry that
> tracked them retired with F4.5b, which closed the register both ways),
> **`viewport-host/gizmo.ts` was PROMOTED by F4.5b Task 5** and is live again —
> the FIELD host's translate gizmo calls `pickAxis`, `closestPointParamOnAxis` and
> `isViewParallel`. Read its own TSDoc, not §11.4 below, for the current contract:
> `pickAxis` gained an `innerLen` dead zone at the gizmo origin. **`camera-control.ts`
> was resolved by F4.5b Task 6**, and the split went the other way from the plan's
> guess: `dolly` is live (the wheel under the `pointer` tool), `orbit` was SUBSUMED by
> a new `orbitAbout(s, pivot, dYaw, dPitch)` that holds a pivot fixed on screen, and
> `orbit`, `zoom`, `pan` and `fromEyeTarget` are DELETED. `frameBox` and `snapToAxis`
> joined it for `F` and the triad's snap views. Every export in that file now has a
> caller in `field-host.ts`; §11.2 below describes the module as M5B left it.


M5B landed the full manipulation loop: GPU-id picking, AABB selection highlight, translate gizmo, orbit/pan/zoom camera, NumberField drag-scrub, focused-input echo-guard, settings-revert, and three M5A inspector papercuts (⑩⑪⑫). This section documents the as-built additions to the M5A substrate.

### 11.1 Engine additions (`@furnace/core`)

**`camera.screenToRay(cam, ndcX, ndcY) → Ray`** — unprojects a normalized-device-coordinate position (`ndcX`/`ndcY` in `[-1, 1]`, Y-up) to a world-space ray `{ origin: Vec3, dir: Vec3 }`. `origin` is the near-plane point; `dir` is normalized. Returns a degenerate ray (`dir ≈ 0`) when the view-projection is singular. Reuses scratch buffers; allocates one fresh `Ray` per call. Source: `packages/core/src/camera/ray.ts`; exported from `@furnace/core/camera`.

**`LoadedScene.entityBoxCorners(entityId) → Float32Array | null`** — returns the 8 world-space AABB corners of the named entity (24-element `Float32Array`, 3 floats per corner, bit-index layout: bit0=x, bit1=y, bit2=z); null when the entity has no geometry. Computed from geometry local bounds baked at `geometry.create` time, transformed by each mesh's current model matrix. Source: `packages/core/src/scene/loader.ts`.

**`LoadedScene.setEntityTransform(entityId, { position?, rotation?, scale? })`** — direct GPU poke on all meshes owned by the named entity: per-field optional, no rebuild, no clone. The translate-gizmo preview fast path — avoids `rebuildEntity`'s clone+teardown+rebuild for the common "drag a transform" case. Source: `packages/core/src/scene/loader.ts`.

**`LoadedScene.pick(ctx, cam, ndcX, ndcY) → Promise<string | null>`** — GPU id-buffer pick. Renders all pickable meshes into an off-screen `r32uint` id target (1-based per-entity integer colors, no AA, depth write enabled), reads back the single texel under the cursor via `copyTextureToBuffer`, and maps the id back to an entity id string. Returns `null` for a background click. All transient GPU resources (id texture, depth texture, id uniform buffer, readback buffer) are allocated and freed per call; the render pipeline is lazily built and cached per context. Source: `packages/core/src/scene/pick.ts`.

**Geometry local AABB (internal)** — at `geometry.create` time, the engine now computes the AABB from vertex data and stores it on the `GeometrySlot` as `localMin`/`localMax`. Used by `entityBoxCorners` to produce world-space corners without re-scanning vertices at pick time. Internal; not part of the consumer-facing `@furnace/core/geometry` surface.

**`drawLines` `occlude` option** — `frame.drawLines` gained an `occlude?: boolean` option (default `true`). `occlude: true` → `depthCompare: "less-equal"` (depth-tested, occluded behind nearer meshes — AABB highlights, physics debug); `occlude: false` → `depthCompare: "always"` (always-on-top — gizmos). Two pipelines are kept per context (one per depth mode). `DrawLinesOptions` type updated. Source: `packages/core/src/frame/draw-lines.ts`.

### 11.2 Editor orbit camera

`viewport-host/camera-control.ts` implemented a **spherical orbit camera** as the pure-math state type `OrbitState { target, distance, yaw, pitch }` plus five pure functions: `orbit(s, dYaw, dPitch)`, `zoom(s, delta)`, `pan(s, dx, dy, right, up, speed)`, `toEyeTarget(s)`, `fromEyeTarget(eye, target)`. No engine imports; trivially unit-testable. (All but `toEyeTarget` are gone as of F4.5b Task 6 — see the banner above for the module as it stands.)

The host (`viewport-host/index.ts`) maintains a private `editorCam: Camera` and `orbitState: OrbitState`:

- **Initialized on a *new* scene load** with the **eye** at the scene camera entity's position, but the orbit **pivot** set to the scene-content centroid (`sceneContentCentroid()` — the mean of every renderable entity's AABB corners), *not* the scene camera's authored look-target. The camera builtin places that look-target only ~1 unit ahead of the eye, which made the whole scene swing wildly when orbiting; pivoting on the content centroid keeps the scene framed and lets orbit/F rotate around what you're looking at. Falls back to the authored target only for an empty scene. Then bound to the canvas via `camera.bindToCanvas` so the editor camera's aspect auto-tracks canvas size; `camera.bindToCanvas` is unsubscribed and re-subscribed on each `loadScene` call.
- **Preserved across same-scene reloads** — `loadScene(doc, { resetCamera })` only re-initializes the orbit state when `resetCamera` is true (a scene open/switch, keyed off a path change in `App.tsx`'s `refreshSession`). A same-scene revision bump — a resource/settings commit or external file edit — reloads the document and rebuilds meshes but keeps the existing `orbitState`, so the user's orbit/zoom does not jump. The `editorCam` object is recreated each reload (then rebound); applying the preserved `orbitState` to it reproduces the exact view. Resource commits reload via the SSE echo (they are not echo-suppressed), so without this the camera reset on every material/settings color edit.
- **Never serialized** — the editor camera is completely independent of the scene camera entity. Editing the scene camera entity in the inspector does not move the editor view; orbiting in the viewport does not touch the scene document.
- The `loaded.camera` (the scene camera entity) is kept but not used for rendering; `editorCam` is passed to `frame.render` and `frame.drawLines` instead.
- **Controls** (`classifyDrag`, deleted at F4.5a Task 13 — it had no production caller and disagreed with the field host's actual bindings): left-drag = select (no modifier) or orbit (Alt held), Alt+Shift-drag = pan, middle-drag = orbit, scroll = zoom (exponential, `exp(delta * 0.1)`), F key = frame-selected (sets orbit target to selection centroid). The `keydown` listener lives **on the canvas**, so `onPointerDown` calls `canvasEl.focus({ preventScroll: true })` to give it keyboard focus on every click — Safari does not focus a `tabindex` element on click (and blurs the prior focus), so without this F/Escape would only work until the first viewport click.

### 11.3 AABB selection highlight

`setSelection(ids)` stores the selection array and re-renders. On each `renderLoaded` call, for each selected id the host calls `loaded.entityBoxCorners(id)` and passes the result to `boxEdges(corners, HILITE)` (`viewport-host/box-edges.ts`) to build a `{ vertices, colors }` line-list for the 12 axis-aligned edges, then issues `frame.drawLines(ctx, { ..., occlude: true })` (depth-tested — highlight correctly occludes behind nearer meshes). Highlight color is `[1, 0.6, 0, 1]` (orange, alpha 1). Entities without geometry are silently skipped.

### 11.4 Translate gizmo

The gizmo is implemented across two files:

**`viewport-host/gizmo.ts`** — pure-math, no engine imports: `Ray`, `Axis`, `AXIS_DIR`, `pickAxis(ray, gizmoOrigin, axisLen, tol)`, `closestPointParamOnAxis(origin, axisDir, ray)`. `pickAxis` returns the nearest world axis (or `null`) whose handle segment `[0, axisLen]` the ray passes within `tol` world units of, after culling axes within ~8° of view-parallel (degenerate screen-space projection). `closestPointParamOnAxis` returns the standard closest-point parameter `t` on the axis line (in axis-direction units — world-space offset with unit axis), used for both hit-testing and anchor-relative drag.

**Host-side gizmo loop** (in `viewport-host/index.ts`):

- **Rendering** — `renderGizmo` calls `frame.drawLines` with `occlude: false` (always-on-top) for each of the three handles. Handle length is **screen-constant** (`GIZMO_PX = 90`): world length = `(2 × dist × tan(fovY/2)) / canvasHeight × GIZMO_PX` where `dist` is the eye-to-origin distance. Uses `EDITOR_FOV_Y` for this computation (the same `Math.PI / 3` constant used to create the editor camera, so the math is consistent). Colors: X = `[1, 0.2, 0.2, 1]`, Y = `[0.2, 1, 0.2, 1]`, Z = `[0.3, 0.4, 1, 1]`.

- **Grab (`tryStartGizmoDrag`)** — on left-pointerdown (no Alt), unprojects the cursor via `camera.screenToRay` → `pickAxis`; on a hit, stores `{ axis, startParam, startPos (centroid), lastPos: Map, pointerId }` and captures the pointer. Returns `true` to short-circuit the select/orbit dispatch.

- **Drag (`updateGizmoDrag`)** — on each pointermove while a gizmo drag is active: unprojects the cursor, computes the axis parameter `t`, derives `delta = t − startParam`, and for each selected entity computes `pos = committedPosition + axisDir * delta` (anchor-relative absolute, never integrated per-event — cannot drift). Calls `loaded.setEntityTransform(id, { position: pos })` (fast path, no rebuild) and stores `pos` in `lastPos`. Renders.

- **Commit (`commitGizmoDrag`)** — on pointerup: if `lastPos` is non-empty (at least one pointermove fired), reads `lastPos` to build the commit array (each entity's `currentTransform` = committed rotation/scale + stored `lastPos`), **synchronously folds the committed positions into `committedDoc`** (preventing a second drag from reading stale P0 before the async SSE `syncCommitted` arrives), then calls `callbacks.onTransformCommit(edits)`. If `lastPos` is empty (no-op drag), skips the commit entirely. Releases pointer capture.

- **Cancel (Escape)** — calls `revertEntityToCommitted` for each selected entity (rebuilds from committed doc via `loaded.rebuildEntity`) and releases capture.

- **Multi-select** — all selected entities are dragged simultaneously with the **same world delta** applied to each entity's own committed position, preserving relative offsets between entities. The commit array has one entry per selected entity; one `scene.batch` command is issued via `api.setComponentMany` — one undo entry.

### 11.5 Host↔frontend contract

The `ViewportHost` interface (`viewport-host/index.ts`) exposes two new methods:

| Method | Direction | What it does |
| --- | --- | --- |
| `setSelection(ids: string[])` | chrome → host | Push selection; host re-renders with AABB highlights + gizmo for centroid. |
| `setCallbacks(cb: ViewportCallbacks)` | chrome → host | Register `{ onSelect, onTransformCommit }`. May be called before `init`. |

`ViewportCallbacks`:
- `onSelect(entityId, mods)` — host emits on pick; chrome dispatches a `select-entity` reducer event. Modifier key flags (`metaKey`, `ctrlKey`, `shiftKey`) are forwarded. Viewport shift-click maps to `replace` mode (range-select is an `EntitiesPanel`-only affordance — no meaningful 3D ordering).
- `onTransformCommit(edits: { entityId, transform }[])` — host emits on gizmo release; chrome calls `api.setComponent` (single entity) or `api.setComponentMany` (multi) and suppresses the SSE echo via `suppressEcho` — same dedup mechanism as `commitComponents`. One undo entry for the whole gizmo drag.

**Chrome owns all daemon I/O.** The host never calls the daemon; it only emits callbacks. This keeps the engine bundle free of daemon protocol knowledge.

### 11.6 Transform fast-path preview and drag-commit seam

For `previewEntity` with `component === "transform"`, the host takes a fast path: it calls `loaded.setEntityTransform` directly (no clone, no rebuild) rather than the general `rebuildEntity` path. This is the hot path for both the gizmo drag and the inspector's transform field preview — no `structuredClone` overhead per event.

`revertSettings()` is now implemented (M5A gap closed): calls `loaded.setSettings(committedDoc.settings)` and re-renders. Wired to the `InspectPanel.tsx` `onCancel` handler for settings forms. Source: `viewport-host/index.ts`.

### 11.7 Echo-guard (focused-input reseed suppression)

`packages/editor/src/frontend/inspector/lib/echo-guard.ts` exports `shouldReseed(focusWithin: boolean): boolean`. `SchemaForm` tracks whether any input inside it is focused (via `onFocusCapture` / `onBlurCapture`) and gates `setDrafts` on `shouldReseed(focusWithin)`: while the user is editing a field, incoming `session-updated` events do not clobber the in-progress draft. The check is a pure predicate so it is independently unit-testable.

### 11.8 NumberField drag-scrub

`packages/editor/src/frontend/inspector/lib/scrub.ts` exports `scrubValue(start, dxPixels, sensitivity, fine)`. `NumberField` attaches `onPointerDown` / `onPointerMove` / `onPointerUp` handlers: on pointerdown it captures the pointer and records `startValue`; on each pointermove it calls `scrubValue` with accumulated `dx` and dispatches `onPreview`; on pointerup it dispatches `onCommit` with the final value and releases capture. Shift held during drag applies `FINE_FACTOR = 0.1` for sub-unit precision. Safari-safe (uses Pointer Events, not mouse events; avoids pointer-lock for broader browser support).

### 11.9 Inspector papercuts (⑩⑪⑫)

**⑩ Omitted fields seed from schema defaults** — `introspect()` now carries a `default` field for each schema node (from zod `.default()`) and `SchemaForm`'s draft seed falls back to it when the document value is absent. Before M5B, absent optional fields (e.g. `scale` on a `{}` transform) showed as `0` (misleading — `scale=0` would make the cube invisible). Now they show the engine default (`[1,1,1]`). Committing an edited field still sends only that field; other absent fields are not written.

**⑪ Per-component vector multi-edit fan** (`lib/vec-fan.ts`) — `fanComponent(targets, index, value, n)`: for a multi-selection, editing one component of a vector (e.g. `position.y`) now fans only that component to the value across all N targets, preserving each target's own other components. Before M5B, the whole vector from `values[0]` was sent to all targets, clobbering their x/z.

**⑫ ColorField commit trigger — moved from `blur` to the native `change` event.** M5B first shipped a `blur` commit with an `eq(next, rgba)` no-op guard. Two problems, both found in the Safari pass: (1) the guard compared the blur value against `rgba`, which is `SchemaForm`'s working draft already advanced to the pick by `onChange → onPreview`, so it suppressed **every** real commit (colors silently failed to stick); (2) `blur` itself is an unreliable commit trigger for a native color input — Safari only blurs `<input type=color>` when focus moves to a *focusable* element, so the commit only landed if you next clicked the (focusable) canvas, not the inspector panel. `ColorField` now commits on the input's native **`change`** event (fired once when the OS picker is dismissed) via a ref listener — it fires from the pick itself regardless of where focus goes next, and only when the value actually changed, so the no-op-revision concern the guard was chasing is moot. React's `onChange` (the native `input` event, continuous through the drag) still drives the live preview. The general "no-op suppression for *other* fields" question (NumberField etc.) remains a backlog item, but color no longer needs it.

## 12. Scene-loader coverage — full built-in set + physics-from-data

> **Partly superseded (F4.5a).** The CORE-side claims (the loader instantiates the full
> built-in set from data, physics included but unstepped) are unchanged and still
> current — that is `@furnace/core/scene`, not the editor. The **editor-side render
> path** at the end of this section (`renderLoaded` / `applyScene` in
> `viewport-host/index.ts`) is deleted: that barrel now re-exports `createFieldHost`
> and nothing else.


The editor renders whatever the consumer's `@furnace/core` scene loader produces; it has no engine of its own (§1). The core loader now reproduces the bowling demo's full **setup** from a data document, so the editor viewport can load lit, textured, and physics-bearing scenes — not just the unlit/cube scenes earlier milestones exercised. The built-in registry (`packages/core/src/scene/builtins.ts`, verified in source) covers:

- **Geometry kinds** — `cube`, `sphere`, `cylinder`, `plane`.
- **Shader kinds** — `unlit`, `lit`, `texturedLit`, `textured`, `normalColor`.
- **Texture kinds** — `checkerboard` (procedural) and `load` (decode bytes).
- **Material** — `standard`, now with optional `texture` + `sampler` slots (the loader resolves nested resource refs).
- **Effect kinds** — `bloom`, `tonemap` (the consumer's HDR post chain).
- **Components** — `transform`, `meshRenderer`, `light` (`directional` / `point` / `spot`, optional `shadow`), `rigidBody` (static / dynamic).
- **Settings** — full schema: `clearColor`, `ambient`, `post`, `gravity`, `lengthUnit`, `sim`, `msaa`, `hdr`.

**Physics-from-data.** A `rigidBody` component instantiates against a lazily-created physics world; when an entity has both `rigidBody` and `meshRenderer`, the `meshRenderer` **defers** (returns no mesh) and the `rigidBody` builds a **rigidMesh composite** that owns the mesh and binds its transform to the body. The world and bodies are fully **instantiated but NOT stepped** — there is no fixed-step loop in the loader. **Driving the simulation is the consumer's game-loop concern** (the loader instantiates the world + bodies; a consumer fixed-step loop would call `world.step`). So a loaded physics scene shows the bodies at their authored rest pose; it does not simulate.

**Viewport-host render path — lights + ambient on, post deferred.** `renderLoaded` (`packages/editor/src/viewport-host/index.ts`) passes the loaded scene's `lights` and `ambient` to `frame.render` — these don't depend on the context's HDR state, so the editor shows the real lit scene (the lit-viewport payoff). It passes **`effects: []`** — the post chain is deferred. The host's GPU context is **non-HDR** (`init()` requests the default `hdr: false`). The relevant `frame.render` contract (`packages/core/src/frame/render.ts`) throws **only** when `hdr === true` **and** the effect chain is **empty** (an `rgba16float` scene target with no pass to reach the LDR swap chain); a non-HDR context with effects does **not** throw. So the deferral is about **fidelity, not a crash**: a scene's post chain (`bloom → tonemap`) is authored for the consumer's HDR pipeline, where tonemap maps `rgba16float → LDR`; running that HDR-authored chain against the editor's LDR scene target would produce wrong output rather than the real preview. Post-preview lands when the editor viewport gains an HDR context (tracked in `docs/backlog/editor-and-tooling/editor-seams-and-preview-deferrals.md` § *Editor viewport HDR context + post-chain preview*). Note that authoring textures/effects resources via the editor's `scene.setResource` command is not yet wired — its `tableEnum` still covers only `geometries | shaders | materials` (§4); the new tables are loadable and validatable but not yet command-mutable.

## 13. Slice 3.1 — the generation cockpit (Epic 3)

> **Superseded by §20 (F4.5a): everything in §13 EXCEPT §13.3 is deleted code.** The
> preview host, the World panel, the world draft, the generation worker and its
> client/protocol were all removed in F4.5a Task 4; the world flow is now `field.load` +
> the `world.*` daemon family + the world drawer (§20.4). §13.3 (`generation.bake`) is
> **still live** — it is the bake upload the world verbs drive. Kept as the history that
> produced the current seam.

Slice 3.1 ("the Loop") made the editor **generate, preview, curate, and bake** procedural world content — while keeping the editor engine-free. The consumer's generator arrives through the engine bundle's `extensions` namespace (§3a) and was driven by a dockview **World panel** (§13.4); the daemon carries **zero** generator knowledge (the bake path uploads a browser-produced file set — the Decision in §13.3). The build is dungeon-first (the generator is `packages/dungeon/src/editor-extensions.ts`), but nothing in the editor knows that — the seam is generic (see `docs/backlog/editor-and-tooling/editor-seams-and-preview-deferrals.md` § *Generation session as a generic editor facility* for the plan to make the session a per-project editor facility).

### 13.1 Preview host — `src/viewport-host/preview-host.ts` *(DELETED — F4.5a Task 4)*

*The file, the `createPreviewHost` bundle export and the camera-eye headlamp described
below no longer exist. The one host today is `FieldHost`, lit by the studio key light
(§20.5).*

A **second** engine-bundle-side host, alongside the viewport host, created via `createPreviewHost()`. It is the generation session's render surface: an HDR preview world the panel realizes consumer `RegionData` into. It is **generic** — it owns no generator knowledge; the panel calls the consumer's realize code (`realizeRegion`, `MaterialCache`) against the host's `ctx()`/`world()` and hands the resulting engine handles to `adopt()`.

`init(canvas, gpuOptions?)` sets up a game-parity mood ("viewing policy, not generator knowledge"):
- an **HDR + MSAA** context (`{ sampleCount: 4, hdr: true }` by default; overridable — headless tests pass `surfaceFormat: "linear"`),
- a `bloom → tonemap` post chain (HDR requires a non-empty chain),
- exponential distance **fog** + low **hemisphere ambient** mirroring the dungeon's `main.ts`,
- an **orbit camera** reusing the same `viewport-host/camera-control.ts` pure-math state (orbit / pan / zoom + `frame(min, max)` to fit an AABB),
- an **unstepped** preview physics world (for realize's collider creation — there is no game loop here),
- a **camera-eye headlamp** (a point light carried at the eye, mirroring the torch) so lit content reads against the dark ambient.

Lifecycle: `ctx()` / `world()` throw before `init`. `adopt(content)` is **leak-safe** — it destroys any prior content first, so the reroll loop can re-adopt without an intervening `clear()`. `clear()` frees adopted content and recreates the physics world (cheaper than tracking every realize-created body). `destroy()` tears down content, physics, both post effects, and disposes the context **last** (a clean shutdown is the leak check). The host is **generation-session-only** — it lives while the panel is active, separate from the normal scene-editing viewport (§11). The panel↔host boundary keeps engine handles **opaque**: `PreviewContent` stores meshes/instanced as `unknown[]`; the host casts to the concrete engine mesh types only at the `frame.render` boundary, sound because the panel realized them against *this* host's `ctx()`.

### 13.2 Engine bundle widening — the `extensions` namespace

The browser engine bundle (§3a) now exports `createViewportHost`, `createPreviewHost` (§13.1), and `export * as extensions from "<root>/<extensionsEntry>"` — the consumer's extension entry re-exported as a **value namespace** (the same module the bare side-effect import already runs, so registration fires once; `{}` when no entry is configured). `loadEngine()`'s `EngineModule` type widened to match.

For the dungeon, that namespace is `packages/dungeon/src/editor-extensions.ts`. The cockpit consumes **five** members off it — a **de-facto protocol**, dungeon-owned for now (see the backlog note above):

| Member | Consumed by | What it does |
| --- | --- | --- |
| `runWorld(spec)` | worker (`generation-protocol.ts`) | Realize a world spec → one payload (regions + connectors as placed `{ id, data }`). |
| `bakeWorldFiles(spec, name)` | worker (`generation-protocol.ts`) | Bake a world spec → the file set the panel uploads. |
| `realizeRegion(ctx, world, cache, region)` | main thread (`WorldPanel.tsx`) | Realize one placed piece into the preview host's GPU context. |
| `MaterialCache` | main thread (`WorldPanel.tsx`) | The shared material cache a realize pass runs against. |
| `worldDir(name)` | main thread (`WorldPanel.tsx`) | The project-relative artifact dir (`worlds/<name>`) — the upload's `cleanDir`. |

The namespace crosses the project-first boundary **untyped** (`Record<string, unknown>`), so each side narrows it at exactly **one** boundary cast — `WorldPanel.tsx`'s `ext` for the main-thread three, the worker's `WorkerEngine` type for its two; the engine owns the real types. The module re-exports more than these five (bake-shape types, the cave theme functions, `DEFAULT_WORLD` / `validateWorldSpec`); the editor reads none of them, and the engine bundle may tree-shake what nothing imports.

### 13.3 `generation.bake` — browser-uploads-payload

**Decision — the browser produces the payload; the daemon only writes it.** A Pr-2 determinism probe found that regenerating the same seed under a *different JS engine* than the one that previewed it produces a **different world placement**: bun/JSC and node/V8 diverge on the transcendental `Math` (`cos` / `sin` / `atan2`) used to place pieces (root-cause detail in `docs/learnings/2026-07-06-cross-engine-placement-determinism.md`). So the plan's original "daemon regenerates from the seed" would bake a world that does **not** match what the user previewed. The slice adopted the spec §0.2 fallback: **the browser bakes the world in its own engine** — from the same spec, in the SAME engine that previewed it, reproducing the preview exactly — and **uploads the produced file set**; the daemon validates + writes. There is **no** blocking-bake / daemon-regeneration caveat: the daemon holds zero generator knowledge.

The command (`handlers.ts`): input `{ files: WireFile[], cleanDir?: string }`, `WireFile = { path: string (min 1), encoding: "utf8" | "base64", contents: string }`. The browser uploads the whole consolidated world — ONE merged `world.scene.json` + `manifest.json` + `.fmesh` sidecars, all under `worlds/<name>/` (`bakeWorld`, `packages/dungeon/src/bake.ts`). `run`:
1. resolves every `path` against the project root and rejects the **whole batch before any write** if any escapes the root or contains a dotfile segment (`outside-root`, 404 — the same posture and hidden-existence rationale as scene paths, §6);
2. when `cleanDir` is given, validates it (root-contained, never the root itself, no dotfile segment, and **every** payload file resolves under it) and `rm -rf`s it BEFORE any write — clean-previous-bake, so a smaller re-bake leaves no orphans from a larger earlier one; a mismatched payload throws and leaves the FS untouched;
3. writes each file — `mkdir -p` the parent, base64-decode when `encoding === "base64"` (binary `.fmesh` sidecars ride as base64 in the JSON POST);
4. emits `generation-baked` (`{ files: <count> }`) over SSE and returns `{ files: <count> }`.

The `path` `.min(1)` guard is load-bearing: an empty path resolves to the root dir and would hit `writeFileSync(rootDir, …)` → `EISDIR` mid-batch (a partial write). The browser marshals binary sidecars via `toWireFiles` (`frontend/lib/generation.ts`, chunked base64 so a large sidecar can't blow the `String.fromCharCode` argument stack). This is the **first handler that emits an SSE event**, so `HandlerContext` gained an `emit(event: DaemonEvent)` field and `server.ts` passes `hub.emit` to both the session and the handlers.

### 13.4 The World panel + ephemeral session

The dockview **World panel** (`frontend/components/WorldPanel.tsx` + `world-panel/` sub-components; panel id stays `generation` — it is baked into persisted dockview layouts — title "World") drives the loop; its state is an **ephemeral world session** (`frontend/lib/generation.ts`) held **App-owned** (lifted out of the panel in Slice 3.2 so the session survives the panel closing/reopening; §14.3), **beside** the daemon's document session. The only daemon/FS crossing is freeze (the `generation.bake` upload) — everything else in `generation.ts` / `world-draft.ts` is pure and unit-tested without a DOM.

**W3 — assembly (charter §2.4):** the panel assembles a **`WorldDraft`** (`frontend/lib/world-draft.ts`): attach-on-add — region 0 anchors at the origin and every later region enters WITH the connector tying it to an earlier region, so the world is a TREE by construction and grid regions' doors are ASSEMBLED from attachments (`draftToSpec` — portal indices cannot drift; connector `a` = parent, `b` = the derivable child; `legalKinds` filters the class-pair matrix, and a cave parent cannot take a grid child — the collar must ride the grid-side `a`-end while only `b`-ends derive). Region rows carry per-algorithm knobs, a seed field, per-region **Reroll** (bump that region's seed, re-realize the whole world on the worker — deterministic, instant cancel), and leaf-only **Remove**. `previewing` snapshots the FULL SPEC that produced the on-screen world; **Freeze & bake** bakes exactly that snapshot (`bakeWorld` on the worker → `generation.bake` upload with `cleanDir`), and the **"Make this the game's world"** checkbox (default on) retargets `worlds/index.json` via a second cleanDir-FREE `generation.bake` call (`bakeUploadCalls` — byte-parity with the committed index, so re-defaulting "default" is a no-op diff). The draft starts EMPTY (no spec→draft import until 3.5 needs one). Gate-observed assembly-UX findings were consolidated in a backlog set that F4.5a resolved with the panel; the one finding that outlived it (`realizeWorldSpec`'s unactionable "no portal 0" throw, which is dungeon-side and still live) is `docs/backlog/dungeon/world-spec-no-portal-error-is-unactionable.md`.

- **Generate / Reroll** run the consumer's `runWorld(spec)` on the **generation worker** (§13.6), so realize never blocks the main thread and Cancel kills it INSTANTLY, mid-run. Generation is **deterministic** — one call, one `world-run` payload. On that payload the panel realizes every placed piece (regions + connectors) into the preview host **main-thread** (`ext.realizeRegion` against the host's GPU context, sequentially — the shared `MaterialCache` is not concurrency-safe), frames the camera on the union AABB (`layoutBounds`), and snapshots the spec as a `previewing` status.
- **Freeze & bake** reads **only** the `previewing` snapshot's spec — never the live draft — re-bakes it on the SAME worker (`client.bakeWorld(spec, name)` → the consumer's `bakeWorldFiles`), and uploads via `api.generationBake` (a main-thread daemon call; the upload's `cleanDir` is `ext.worldDir(name)` = `worlds/<name>`, so the daemon clears the prior bake). That snapshot is what makes "freeze bakes exactly what you previewed" hold even after a draft edit: any draft write drops a `previewing` status back to `idle` (`invalidateWorldPreview`), so Freeze is only ever enabled for the world currently on screen.

Because the session lives in React state and never touches `session.apply`, generation curation is **not undoable** and does not appear in the document session's history — a separate, ephemeral concern that crosses into the document/FS world only at the bake.

### 13.5 Fragment-doc opening in the viewport host

A baked region document is **camera-less** (no entity carries a `camera` component). The viewport host's `applyScene` (`src/viewport-host/index.ts`) now detects this — mirroring the loader's own throw condition exactly (`doc.entities.some(e => "camera" in e.components)`) — and, when no scene camera is present, loads with `scene.loadScene(c, doc, { fragment: true })` (suppressing the loader's no-camera throw) then frames the editor orbit camera on the **content bounds** (centroid + floored content radius, seated back along fixed framing factors) instead of seeding from a scene-camera pose. This fixes the 3.0-gate "no entity carries a camera component" error — opening a baked region fragment is the cockpit's acceptance case one. Camera-carrying docs are **unchanged** (still seed the orbit from the scene camera's eye, pivoting on the content centroid — §11.2).

### 13.6 Generation worker host (Slice 3.2.3)

The generation search moved off the main thread onto a dedicated **module worker**:
`frontend/generation-worker.ts`, built as its OWN entry (`scripts/build-frontend.ts`
— a page-loaded worker is reached by URL, not by riding the html entry's import
graph) to `/generation-worker.js`. It imports the same same-origin `/engine.js` the
main-thread chrome loads — same browser, same JS engine — so worker-side placement
is identical to main-thread placement (the cross-engine determinism rule is
JSC-vs-V8, `docs/learnings/2026-07-06-cross-engine-placement-determinism.md`, not
thread-vs-thread).

- **Protocol (`frontend/lib/generation-protocol.ts`)**: runId-disciplined typed
  messages. Requests: `init` / `runWorld` / `bakeWorld`; responses: `ready` /
  `init-error` / `world-run` / `baked` / `done`. `done` is a **pure failure
  channel** (`outcome: "error"`) — success rides `world-run` (ONE payload per
  `runWorld`, carrying the whole realized world) or `baked` (the file set).
  `createWorkerHandler` is a **pure factory over injected deps** (`loadEngine` +
  `post`), unit-testable without a real `Worker` (`bun:test` spawns none);
  `generation-worker.ts` is a thin shell wiring it to the real dynamic `import()` +
  `self.postMessage`. Every failure path posts a typed message rather than throwing
  (a worker-side throw surfaces as a generic `ErrorEvent` with no runId). The
  realized world and the baked files transfer their typed-array buffers
  (`collectTransferables` dedupes views that alias one buffer — a duplicate
  transferable is a `DataCloneError`).
- **`GenerationWorkerClient` (`frontend/lib/generation-client.ts`)**: App-owned (one
  per App lifetime, alongside the generation session — §14.3), so it survives the
  World panel unmounting. `runWorld` / `bakeWorld` / `cancel`. **Cancel =
  `terminate()` + lazy respawn** — instant, mid-run, no cooperation needed from the
  work in flight. A bumped `runId` PLUS a worker-identity guard (`this.worker !== w`)
  drop late messages from a dead or superseded worker, including the no-runId
  `ready` / `init-error` / `onerror` (`terminate()` does not dequeue a worker's
  already-posted messages). A spawn or init failure is setup-loud through
  `onError` — no silent fallback path exists.
- **What stays main-thread**: `previewWorld` (realize into the preview host) needs
  the host's GPU context, so it runs once on the realized payload, main-thread; the
  daemon upload (`api.generationBake`) is a main-thread fetch. Everything else —
  running `runWorld` / `bakeWorldFiles` — moved into the worker.
- **`bundle-outdated` stance**: the client is App-owned via `useState`'s lazy
  initializer (one instance for the App's lifetime). A page reload refreshes the
  worker AND the main thread together — both then run the SAME engine bundle. The
  worker is **never respawned alone** on a `bundle-outdated` SSE event; doing so
  would version-split worker-side generation from main-thread realize/bake against
  two different bundle builds. When the page deliberately stays stale (a dirty
  document blocks the reload prompt), the worker stays stale WITH it.

### 13.7 World flow — which world the game loads

The panel's shipped path is the world flow end to end: `runWorld` / `bakeWorld` on
the worker (§13.6) against the consumer's `extensions` seam (§13.2), realize + upload
on the main thread (§13.4). Generation is **deterministic** — the same spec always
yields the same world — so there is no search and no retry machinery on either side
of the worker boundary.

The daemon's `generation.bake` is destination-agnostic (root-contained + `cleanDir`),
so `worlds/<name>/` destinations needed a test, not a change. Which world the game
loads is `worlds/index.json`; the panel's "make this the game's world" checkbox
retargets it at bake time via a second, `cleanDir`-free upload (§13.4).

## 14. Slice 3.2 — editor foundation pass (Epic 3)

> **Superseded by §20 for §14.1's theme mapping, §14.2's menu bar, §14.3's persistence,
> §14.4's navigation and §14.6's selection colour (F4.5a).** §14.5 (inspector IA,
> humanized labels, number formatting) still stands — the inspector survives as the
> stamp/reconfigure param form.

The foundation pass that turned the M3–3.1 prototype into a usable tool, driven by an `/impeccable` critique (20/40 → 31/40; the baseline's 1×P0 + 3×P1 all resolved). **Browser-chrome only — no `@furnace/core` change.** The daemon gained one read command (`project.get`, §4) and two `SessionView` fields (`canUndo`/`canRedo`).

### 14.1 Design system + tokens

`frontend/styles.css` carries a committed OKLCH token set (`@theme inline`; the `.dockview-theme-dark` mapping went with the dock): a single steel-blue `--primary` (`oklch(0.62 0.11 240)`), a hue-250 neutral ramp, a desaturated semantic set, self-hosted **Inter Variable** (UI) + **JetBrains Mono** (data — numbers/IDs/paths), `color-scheme: dark`, one tokenized focus ring, and a `@media (prefers-reduced-motion: reduce)` block. Controls are shadcn/ui (new-york) over Radix; `frontend/lib/cn.ts` is the class-merge (the shadcn CLI's bare alias is relativized on every generated component — a bare alias breaks repo-root typecheck). The committed design intent lives in `packages/editor/DESIGN.md`.

### 14.2 Menu bar + global keybindings + in-chrome confirm

*(Historical — the menu is now the single `shell/BurgerMenu.tsx` dropdown, Edit/World/View/Help, and Undo/Redo drive the field op log rather than a document session; §20.6.)* `frontend/components/MenuBar.tsx` was a Radix Menubar (File/Edit/View/Help) whose items dispatched through the App's document-control handlers; `frontend/lib/keybindings.ts` + `hooks/useGlobalKeybindings.ts` bind ⌘S / ⌘Z / ⇧⌘Z / F / ⌫ with focus-aware guards (bare keys ignored while typing in a field). Save/Undo/Redo call `scene.save`/`scene.undo`/`scene.redo`; their enabled state reads `SessionView.canUndo`/`canRedo`. Destructive actions route through an in-chrome `ConfirmDialog` (Radix), never `window.confirm`. **Radix Presence caveat (found at the 3.2 gate):** menu-family exit animations must NOT use a `forwards`-fill `data-[state=closed]` keyframe — it wedges Radix `Presence` so a menubar/dropdown sibling-switch closes the open menu but never opens the next; the fix keeps only the enter (open-state) animation on `menubar.tsx` + `dropdown-menu.tsx`.

### 14.3 UI persistence + generation-session lift

`frontend/lib/persist.ts` persists per-project UI state, scoped by the project root from `project.get`. *(Historical: it held the dockview layout + view flags + inspector section open-state, and closed panels reopened via **View ▸ Panels** from a `PANELS` registry. `panels.ts` is deleted; the blob is now `workspace` / `view` / `flagFilters` / `lastWorld` at **v2**, and a v1 blob is orphaned rather than migrated — §20.2. F4.5b deleted the write-only `recentWorlds` and made `lastWorld` READ at boot — §21.9.)* The **ephemeral generation session was lifted out of the panel (today `WorldPanel`) into App-owned state** so it survives the panel closing/reopening (correcting §13.4's original panel-local design); the bake destination is the draft's own `name` (§13.4).

### 14.4 Viewport reference layer + navigation

*(Historical — this describes the deleted scene viewport. What survives: `viewport-host/reference-grid.ts` (the field host still draws the depth-tested grid, gated by `layers.grid`) and `AxisTriad.tsx` (now mounted by `shell/AxisTriadMount.tsx` off the host's camera-pose seam). `ViewFlags` is gone — the field's visibility set is `FieldLayers` and the shading modes are `studio`/`normals` (§20.5); there is no `axes`, `headlamp` or `fog` flag. The navigation below is NOT the field host's: it binds right-drag look (or orbit about the selected entity) + WASD/QE fly, left-drag strokes the brush, the wheel trims brush radius (or dollies, under the `pointer` tool), `F` frames the selection and the corner triad's six tips snap the view. `camera-control.ts`'s `orbit`/`zoom`/`pan`/`fromEyeTarget` were deleted at F4.5b Task 6; what is left of that module all has a caller.)* `frontend/viewport-host/reference-grid.ts` adds a depth-tested grid; a corner axis triad (`AxisTriad.tsx`) and a neutral headlamp make an opened scene read as a scene, not a black void. `ViewFlags` (`grid`/`axes`/`headlamp`/`fog`) are a viewport concern (default grid/axes/headlamp **ON**, fog **OFF**), mirrored between a viewport overlay popover and View ▸ View-flags. **Navigation (`viewport-host/camera-control.ts`):** Alt+LMB orbit, **MMB pan**, RMB-hold + WASD/QE fly (wheel trims fly speed), and **scroll = `dolly` forward** — a scale-aware, floored forward `flyMove` that travels through the scene rather than orbit-zooming toward the pivot (distance-scaled orbit zoom asymptotes to a dead stop); `F` frames the selection. The prior `zoomToward` cursor-zoom was deleted.

### 14.5 Inspector IA, humanized labels, number formatting

Component sections are collapsible (`CollapsibleSection`); resources default collapsed and filter to the selection. Field/section labels are humanized (`frontend/lib/humanize.ts` — `castShadow` → "Cast Shadow"), applied in `FieldRow`, component headers, and object-group headers; the World panel matches (Title Case). Numeric display is rounded on the data surface: `inspector/lib/format.ts` `roundForDisplay` strips IEEE-754 noise (`1.2000000000000002` → `1.2`) in `NumberField` + `VecField` (`QuatField` already rounded euler degrees) — **full precision stays in the document**, and because the rounded value is ALSO the blur dirty-check baseline, a focus+blur with no edit never commits a truncation. Vec/Quat show x/y/z(/w) axis chips; numeric labels carry a drag-scrub affordance.

### 14.6 Selection color single-source + test harness

*(Historical — the scene viewport this served is deleted, and `frontend/lib/theme.ts` went with its last consumer at F4.5a Task 13. The field host's selection colour is a host-side constant.)* The viewport selection highlight derived from the `--primary` CSS variable at runtime via `frontend/lib/theme.ts` `resolveCssColor` — a 1×1 canvas-2D `getImageData` resolve, NOT `getComputedStyle().color` (which preserves `oklch()` under CSS Color 4 and returns garbage). A happy-dom + `@testing-library/react` harness (`tests/inspector/`) renders fields/panels and exercises the `onChange → onPreview → onCommit` chain — the field-render coverage the M5B ColorField regression exposed as missing. **DOM tests live in `tests/` SUBDIRS** (never bare `tests/`) so happy-dom's `navigator`/`fetch` mutation can't clobber the GPU + daemon-HTTP suites earlier in bun's single-process file walk (`docs/backlog/editor-and-tooling/editor-test-harness-fragility.md` § *bun test single-process fragility: DOM (happy-dom) vs GPU tests interleave badly*).

## 15. One Field F1+F2a — the Field panel + FieldHost (2026-07-16)

- **`FieldHost`** (`viewport-host/field-host.ts`) — a PreviewHost-class host (own
  canvas/context/camera/rAF loop) owning the field authoring loop: a
  `@furnace/core/field` store + op log (undo/redo = chunk-keyed two-channel inverse
  deltas, ⌘Z/⇧⌘Z), LMB tool strokes, RMB fly-look + WASD/QE (camera-control reuse), a
  **flat-shaded** (`shader.normalColor`, unlit normal-distinct — material classes
  deliberately indistinct here) vs LIT (per-class colors visible) toggle — F4.5a renamed
  the pair `normals`/`studio` and made `studio` the default (§20.5), ground grid + origin marker (blank-canvas bootstrap).
  Threaded to the chrome through the `/engine.js` runtime channel (the same channel the
  now-deleted PreviewHost used) — the chrome never value-imports engine code;
  `tests/frontend-no-engine-leakage.test.ts` machine-enforces the ban against
  `@furnace/core`, `field-protocol`, AND `viewport-host` value-imports.
- **Tools (F2a)** — `setTool({effect, materialId})` over dig/fill/paint;
  `setMaterialTable` (re-marks all chunks dirty — a table swap re-buckets the world).
  Targeting is the pure `lib/field-brush.ts`: surface hits bite 0.7·radius INTO rock,
  an embedded eye mines radius-deep ahead, kit fills snap to the 0.5 m lattice
  (`snappedKitBox` — the host constructs only valid kit ops by design). A
  hologram-blue **ghost marker** (ring for spheres, box edges for kit fills) shows the
  target every frame. Default radius 1.25 m (max 4). Rendering: per-class organic
  sub-meshes + kit backing (lit materials from the table) and ONE instanced kit draw
  per chunk (white litInstanced material; piece color × variant jitter rides the
  per-instance tint). F1's dig-feel backlog entry resolved here; the F2b feel register
  (`fill-tool-solid-volume-surprise.md`) was resolved in F2b — stamps + hollow fill +
  the filled kit ghost (§16); the deferred remainder is
  `docs/backlog/editor-and-tooling/field-f2b-gate-ux-findings.md`.
- **Remesh worker** (`frontend/field-worker.ts` + `lib/field-protocol.ts` /
  `lib/field-client.ts`) — a third frontend bundle entry that imports core's mesher +
  skinner DIRECTLY (engine code; the project `/engine.js` is not involved). v2
  protocol: 20³ density+material apron pair + the material table in, per-class mesh
  buckets + kit instance lists out, buffers transferable both ways; dirty-SET
  coalescing lives host-side. Measured 0.71 ms median per 16³ chunk WITH dispatch +
  skinning (M1, bun/JSC; 5 ms ceiling asserted in tests).
- **Catalog (F2a)** — the project→editor world-materials contract, DATA only: the
  panel fetches `/catalog/materials.json` off the daemon's project-root GET mapping
  (no new command), parses it with the setup-loud `lib/catalog.ts` hand validator
  (typed `CatalogError` naming the offending path; type-only core imports — leakage
  guard clean), and applies it via `setMaterialTable`. Absent file → builtin rock-only
  + status note. Catalog-wins semantics vs the artifact's embedded table (the
  embedded table is the GAME's snapshot); Load-until-catalog-settles hardening is an
  F2b carry-over (resolved in F2b — see §16's module extractions).
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
  wait for: init is EAGER and a zero measure THROWS (§20.1). Distinct from
  resize-RENDERING, which the host still owns via `gpu.onResize`.

## 16. One Field F2b — the palette (2026-07-21)

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
  mirrors host-initiated changes into the panel. The kit-fill ghost renders as a
  translucent solid cube (rebuilt per snapped-size change) plus edges; the brush ghost
  persists off-canvas so panel-slider size drags preview live.
- **Selection (a tool class, not an op)** — `setGesture("box"|"material"|"void")`
  arms LMB gestures (applyTool bypassed; F3b widened the setter to one armed-gesture
  slot that also holds the `segment` brush — §18; F4.5b added `pointer` to the same
  slot and made it the DEFAULT a host opens armed with, so the first click on a world
  selects rather than digs): box = two clicks with an anchor cross + a
  LIVE snapped-region preview following the cursor (fix round 1); material/void =
  one-click floods seeded from the raycast hit / its last-air `prev` voxel,
  `SELECTION_UI_BUDGET = 200_000` under core's ceiling, truncation surfaced in the
  panel. Amber AABB overlay (occlude:false), `reselect()` one-slot restore,
  `subscribeSelection` + `subscribeToolError` feed the panel footer. Cell-level
  display is deferred to F4 (`field-f2b-gate-ux-findings.md`).
- **Layers + slice** — `FieldLayers { field, kit, props, ghost, selection, grid,
  flags, voidCast }`; the first SEVEN gate the render lists per frame (display-only; a
  hidden selection keeps masking ops), and two of them arrived later: `props` with F3b's
  placed-prop layer (§18) and `flags` with F4's advisor markers (§19). The eighth,
  `voidCast`, is NOT a plain gate — it is F3b's X-ray view mode, default off, built by its
  own enabling edge and dropped by the next edit (§18); `LayersRow` renders it under a
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
  smart-object surface — Open/Freeze/Bake, §17), LayersRow + slice slider,
  FieldToolbar. *(F4.5a: `LayersRow` and `FieldToolbar` are deleted — the layer gates and
  the slice slider moved to the top bar's View popover, the world verbs to the shell, and
  the catalog fetch to `hooks/useCatalogs.tsx`; §20.)* The controls stack is bounded
  (scrollable) and the canvas cell floors at `min-h-24` — it can never reach zero
  (measured fix; the unclamped-resize core hop is
  `docs/backlog/engine-architecture/resize-unclamped-zero-size-canvas.md`).
- **Field-first default layout** — `DEFAULT_LAYOUT_PANELS = ["field", "inspect"]`
  (World + scene Viewport + Entities leave the DEFAULT only; `PANELS` still owns
  View▸Panels re-add). Persisted layouts unaffected; View▸Reset lands on the new
  default. *(F4.5a: deleted with the dock. The layout is now the fixed Shell contract
  plus a floating palette arrangement — §20.1–§20.2.)*
- **Load gating (F2a carry-over closed)** — Load stays disabled until the catalog
  settles (success or 404-fallback); catalog-wins semantics stand.
- **Host extractions (F2a carry-over closed)** — pure modules with tests:
  `field-kit-render.ts` (yawQuat/pieceColor/packKitMatrices — since folded back into
  `field-host.ts`/`catalog.ts`), `field-ghost.ts`
  (ring/box batch math), `field-stamp.ts`, `input-map.ts` additions; FieldHost keeps
  the GPU calls.
- **Core underneath (see `core-modules.md`)** — the FieldOp union + op-list undo,
  masks, smooth, hollow fill, selection, the generator registry (hall + maze; cave + scatter
  joined at F3b — §18) + `commitGenerator`, raycast `maxY`; and the two F2b frame fixes: drawLines
  MSAA-awareness and blend-partitioned draw order (translucent ghosts now draw over
  instanced kit).

## 17. One Field F3a — smart objects (2026-07-23)

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
  *(F4.5b Task 4 adopted D-14's glyph map — freeze ❄ / bake ⬇ / delete 🗑, with Open
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
- **Field undo/redo as host API** — `FieldHost.undo()/redo()` (the field log is a
  SEPARATE history from the scene document's); the canvas ⌘Z handler now
  `stopPropagation()` (it was ALSO stepping the scene undo — pre-existing, fixed;
  F/Delete still leak by design pending a semantics decision, noted at the fix site).
- **Deferred UX set** → `docs/backlog/editor-and-tooling/field-f3a-gate-ux-findings.md`
  (mouse-driven region move, in-viewport pointer/select tool, box/wand selection feel
  — slotted to the F4 recharter with the F2b set).

## 18. One Field F3b — scatter authoring, placed props, and two tools of its own (sealed 2026-07-25)

The editor became the third consumer of core's F3b placement work (after the generator
itself and the dungeon's field-world loader): it authors scatter stamps and renders the
props they commit. It also gained two tools of its own that owe nothing to placements —
the void cast (an X-ray view mode) and the segment brush (a two-click swept capsule).

- **Entity catalog** — the second project→editor catalog contract, DATA only, exactly
  parallel to the F2a materials one: the run-once catalog effect (FieldToolbar's then,
  `hooks/useCatalogs.tsx`'s since F4.5a) also fetches `/catalog/entities.json`, parses it with `lib/catalog.ts`'s setup-loud
  `parseEntityCatalog` (same `CatalogError`, path-naming, type-only core imports) and
  installs it via `FieldHost.setEntityCatalog`. Both fetches live in ONE effect so they
  cannot race onto the status line; only MATERIALS gates Load (props render from the op
  log whether or not the entity catalog resolves). *(F4.5a: the status line is gone —
  a catalog error is a toast plus a durable log entry, §20.3.)* The parser normalises the catalog's
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
  forever; `tests/chrome/field-panel.test.tsx` pins the ordering, which host-level tests
  structurally cannot (they install the catalog first).
- **Context-threaded preview** — `stamp-preview` now passes an `EvaluateContext { store }`
  (the scratch store the snapshot was installed into) for any `contextFree: false`
  generator, which is what lets scatter's ghost read the field at all. `stamp-previewed`'s
  `placements` reach the session as `placementCount` and the ghost as ONE merged
  hologram-blue wireframe batch of oriented proxy boxes (`placementGhostBatch`,
  `occlude:false`, under the `ghost` layer gate). No mesh loading in the ghost (v0).
- **Committed prop layer** — `rebuildProps` rebuilds one instanced draw per archetype from
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
  (`packages/editor/scripts/analyzer-pixel-check.md`, §19) — which leaves the void cast the
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
- **Void-cast refusals + lifetime** — four refusals, in the order a user meets them, all via
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
  same-phase budget; **F4 closed it** — `MAX_SEGMENT_M` (§19).
- **Segment preview + failure path** — the preview is the WHOLE preview: a hologram-blue anchor
  cross plus the wireframe capsule the second click would commit (`segmentGhostSegments` in
  `field-ghost.ts` — a 16-segment ring at each endpoint plus 4 rails, degenerating to the sphere
  ghost below a 1e-6 axis length), both under the `ghost` layer, since a pending capsule is a
  preview of a brush op rather than a selection. No worker ghost and no scratch mesh: a brush op is
  cheap and reversible, and the generator preview protocol exists for recipes whose output cannot
  be guessed from their inputs — a swept capsule can. It is rebuilt on pointer MOVE, so a radius
  change with a still cursor does not re-fatten the pending capsule until the next move (accepted,
  filed as item 9 of `field-f2b-gate-ux-findings.md`). Esc drops a pending anchor, but only when no
  stamp session owns the key — the box anchor's identical Esc is a separate UX change, filed rather
  than folded in. `commitToolOp(shape)` is the shared build→apply→report path the stroke and the
  segment both take, so both carry ONE failure contract: every setup-loud throw the apply raises —
  a kit fill off the lattice, a kit class under a non-box shape (reachable ONLY through this
  gesture), an unknown material class — is caught, reported to the panel, and the op DROPPED. (The
  op is built inside that try too; the reasoning for that placement, and its honest status, live at
  the source.) Core's half — the `capsule` `BrushShape` and the capsule leg of `assertOpValid`
  (finite endpoints, finite positive radius, kit-class rejection) — is in `core-modules.md`; the
  box cross-section variant is explicitly NOT shipped
  (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Segment brush: a BOX cross-section*).
- **Host extractions + the worker seam** — `viewport-host/field-placements.ts` (pure: proxy
  extents/scale, oriented corners, `groupPlacements`, `placementGhostBatch`,
  `placementsByEntity`, and the two catalog-seeding helpers) with
  `tests/field-placements.test.ts`, the `field-ghost.ts` precedent; `field-ghost.ts`
  itself gained `segmentGhostSegments`. `createFieldHost(deps?: { spawnWorker })` adds a
  DI seam for the worker: production omits it and gets the real `/field-worker.js`, while a test
  injects the protocol handler directly — the host's worker-backed paths are otherwise unreachable
  under `bun test`, where a job posted to a Worker spawned from that browser URL never settles
  in-process. Backlog status: `docs/backlog/editor-and-tooling/editor-test-harness-fragility.md` § *FieldHost's worker seam exists now*.

## 19. One Field F4 — the walkability advisor in the editor (tranche B, 2026-07-26)

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
> box is chunk-sized; direct-click-to-select is the wanted direction) — deferred to
> `docs/backlog/editor-and-tooling/field-f4-gate-ux-findings.md` with the sibling
> sets, per the standing features-now/polish-later sequencing decision.

The editor gained its THIRD worker: an advisor that runs core's stage-1 walkability passes
over a mirror of the field as the user digs, draws what it finds as severity-coloured
markers in the viewport, lists it in a Flags panel section, and — on demand — drives the
PROJECT'S OWN mover at one finding to see whether it really sticks.

**Advisory throughout (D-F4-1), and that is a design commitment, not a v0 limit.** Nothing
the advisor reports blocks a verb, mutates a field, or is auto-fixed. A filter HIDES a
finding and a reachability demotion tags one; neither deletes one. The only thing that
retires a finding is a re-analysis that no longer reports it — the analyzer changing its
mind.

- **The analyzer worker** (`frontend/analyzer-worker.ts` + `lib/analyzer-protocol.ts` /
  `lib/analyzer-client.ts`) — a FOURTH `build-frontend.ts` entrypoint beside the chrome, the
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
  `docs/backlog/editor-and-tooling/analyzer-reanalysis-halo-cellsize-coupling.md`.
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
- **Host wiring** (`viewport-host/field-host.ts`) — the mirror syncs at the SAME density
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
  queued; the latch admits no more) and stays 0 with no profile — off, not busy. The footer
  renders `· analyzing…` while it is above 0 and nothing at 0, because the count is PASSES
  owed, not chunks.
- **Flag presentation state — `viewport-host/field-flags.ts`**, pure and GPU-free (the
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
  shading mode meant for mood. Whole-layer teardown-and-rebuild, the `rebuildProps` rule. Colour is the stage-2
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
  (`tests/viewport-host/field-flags.test.ts` asserts all four constants and the `inconclusive`
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
  `/engine.js` (`ANALYZER_ENGINE_URL`) and calls `extensions.analyzerVerify` — the dungeon's
  own `walk-probe.ts`, driving the real `CharacterMover` down directed lanes in a locally
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
  still had a status line; F4.5a routes it to a toast + the log, §20.3). All-`inconclusive` would not have been a failure
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
  provider (`FieldFlagsContext`) rather than in a palette. `verifying` cannot live in the host
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
- **The `flags` layer** is the SEVENTH display gate (§16). Hiding it does NOT stop the
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
  collider derivation). That second one is a claim about EXECUTION, not bundle content — Rapier
  ships inside `analyzer-worker.js` and nothing in this realm calls it.
  `tests/frontend-no-engine-leakage.test.ts` widened its rule to `(field|analyzer)-protocol` and
  carries the full argument, the measurements, and the one value import that drags core's whole
  graph in (`field/artifact.ts` → `@furnace/core/scene`) in its exemption comment; the
  design question is
  `docs/backlog/engine-architecture/field-module-pulls-whole-engine.md`.
- **`catalog/agent.json` — the third project→editor catalog contract**, DATA only, exactly
  parallel to the F2a materials and F3b entities ones. The run-once catalog effect
  (`FieldToolbar`'s then, `hooks/useCatalogs.tsx`'s since F4.5a) fetches all three in ONE
  pass so they cannot race;
  `lib/catalog.ts`'s `parseAgentCatalog` validates it setup-loud with the same `CatalogError`
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
  sites: the editor-side empty-result refusal (§18) and `FieldGeneratorInfo.placesProps`, which
  the StampInspector's props count reads. **The other two prop-generator branches still sniff
  the schema key** — `withArchetypeOptions` (the `archetypeId` picker) and `seedArchetypeParams`
  both gate on `ARCHETYPE_PARAM in …` and never consulted the predicate, before or after. The
  deleted `placesArchetypes` TSDoc called itself "the one predicate behind" all four; it was
  not, and that claim should not be carried forward. **Consequence:** a generator that declares
  `emits: "placements"` (or `"both"`) but names its archetype param something else gets the
  refusal and the count, and silently gets NO picker and no seeding — the exact divergence class
  `placesProps`' own TSDoc warns about, one level up. Unifying the remaining two is unbuilt.
- **The segment brush gained its cap (D-F4-16), closing the asymmetry §18 recorded.**
  `MAX_SEGMENT_M = 2 · DIG_RANGE_M` = 60 m, checked in `segmentClick` before the anchor is
  cleared, so a refusal leaves the pending start armed and the fix is one nearer click; its
  TSDoc owns why twice the dig range is the geometry and not a round number. F3b shipped this
  gesture uncapped while the void cast shipped a budget in the same phase, and recorded the
  mismatch rather than resolving it — this is that debt paid. Pinned by a GPU test straddling
  the threshold (an over-length second click commits nothing and leaves the anchor ARMED), and
  restated in `ToolPalette`'s tooltip, which agrees by REVIEW rather than by import: the chrome
  cannot value-import anything under `viewport-host/`, the same rule that keeps `flagKey`
  private and puts `rowByKey` in the store.
- **Deliberately untouched: the void cast's worker scheduling.** F3b's X-ray still monopolises
  the one FIELD worker with no cancel and refuses where coalescing belongs (§18); F4 gave the
  advisor a worker of its OWN rather than touching that, so its passes never queue behind a
  cast and the cast's scheduling is exactly as F3b left it.
  The gap stands as filed —
  `docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *The void cast monopolises the one field worker*.
- **Panel-orchestrator slope.** *(F4.5a reversed it: 817 → 463 lines and 8 → 4
  subscriptions, by moving the stats/tool-error/entity/drift seams to a shell provider and
  the world, view and catalog concerns out entirely; F4.5b Task 2 finished it at 261 lines
  and 0 subscriptions — §20.7.)* Tranche B took
  `FieldPanel.tsx` from 15 `useState` slots and 7 subscriptions to 18 and 8 (711 → 817 lines): three new slots — the flags summary, the filter
  set, the in-flight verify key — plus `analyzerPending` on the existing stats mirror and its
  footer segment. The file was the dig loop's single orchestrator, and the backlog entry
  tracking that slope retired with it: F4.5a moved the entity list out, F4.5b took every
  remaining organ (§21), and Task 14 deleted the component and the `controls` palette id
  together. What the orchestration became is `hooks/useFieldHostState.tsx` plus the pure
  `lib/field-host-mirrors.ts` it was split against — see §21.

## 20. F4.5a — the overlay shell (2026-07-30)

**Read §21 beside this one:** F4.5b moved several figures here — the `controls` palette id retired with `FieldPanel`, three palettes joined the union, the seam and context counts went up, and the Esc ladder gained a rung — and §21 is the as-built for all of it.

**This section is the authority on the editor's chrome.** F4.5a rebuilt it as an *overlay
cockpit*: one full-window canvas with everything else floating over it. The dock, the
field toolbar, the World panel and the entire scene-document surface were deleted
(§7/§10–§14 are the history that produced this). The editor is now **field-only** — the
daemon still implements the `scene.*` family, but nothing in the chrome speaks it.

Scope note: this is the **as-built at the end of F4.5a**, not the end of F4.5. The
`MIGRATION (until F4.5b)` markers in `packages/editor/src` name the places that
know they are provisional — six left, the entities palette's row-delete marker having been
resolved by F4.5b Task 4; `grep -rn "MIGRATION (until" packages/editor/src` is the list.

### 20.1 The layout contract (D-1) and the canvas layer

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
- **`sampleCount` is a CONTEXT property**, so the View popover's AA switch cannot be a
  host setter — the only way to change it is dispose + init. The cost is a re-init, not a
  reset: the field, the op log, the tool and the camera are CPU state the host keeps
  across a dispose.
- **The re-init chain.** The host holds one context and throws on a second `init`, and
  its dispose is *deferred* (dispose only once `init` has SETTLED, because init awaits
  the GPU context and disposing mid-await pulls it out from under trailing creations). An
  AA change runs cleanup and effect in the **same** React commit, so the next init must
  wait for the previous teardown — a `teardown` ref carries that promise forward. It also
  makes a double-invoked mount safe, which the deferred dispose alone did not.
- The canvas is `tabIndex={0}` with a visible focus ring: the host attaches its WASD/QE
  fly, `[`/`]` radius and arrow-nudge keydowns to the CANVAS, so the ring is the only
  signal those keys will land anywhere.

### 20.2 The palette layer, the workspace store, and persistence v2

**`lib/palette-store.ts` is pure data** — no DOM, no persistence, no React. The cell's
size is the one fact it cannot know, so it arrives as an argument (`OriginBounds`); the
layer component measures it. That is what makes clamp/snap/what-survives-a-hide testable
without a browser.

- `PALETTE_IDS` is a **closed union** (`controls`, `entities`, `log`): a persisted record
  for an id not in it is dropped rather than restored, so a retired palette cannot come
  back as dead geometry.
- The defaults claim **two** of the cell's four corners: `controls` docks to the right
  edge from y=0 — which puts it in the **top-right** — while `entities` and `log` share
  the **top-left**, `log` starting **closed** because it is summoned rather than
  always-on. The axis triad is a third claimant of that same top-right corner, which is
  exactly why it mounts above the palette layer in DOM order (§20.5) — the controls dock
  covers it otherwise. `Toasts` takes the bottom-right (its own D-1 absolute layer), so
  the **bottom-left** is the one strip nothing defaults into, and that is where the
  collapsed-chip rail lives: it used to sit top-right, under exactly this dock, so
  collapsing any palette dropped its chip on top of another one (`PaletteLayer`'s own
  account of the move).
- `SNAP_PX = 24` — roughly a coarse pointer's slop.
- The ⌘\ hide-all is a **latch**: `hidden` does not touch the per-palette records, so
  restoring returns the exact prior arrangement.

**`hooks/useWorkspace.tsx`** adds the two things the store refuses to know: React state
and the disk (a `PERSIST_DEBOUNCE_MS = 200` write, so a drag writes once at the end of
the gesture rather than 60×/s). It is split into **state and actions contexts**, and the
load-bearing beneficiary is `ShellChrome` — the component that actually builds the
`content={{ controls: <FieldPanel/>, … }}` elements — which reads ACTIONS ONLY. That is
what keeps those elements referentially stable across a drag and therefore keeps
`FieldPanel` off the pointer-rate path. (`ShellFrame`, one level up, reads only
`useEditor`.)

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

### 20.3 What the editor SAYS — the notify store

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

### 20.4 The world — `world.*`, `useWorld`, and the drawer

The daemon gained a **`world.*` namespace** (`daemon/handlers.ts`) beside the existing
`field.load` and `generation.bake`:

| Verb | What it does |
| --- | --- |
| `world.list` | Enumerate `worlds/` read-only, with a **`tracked` tri-state** per row — `true`/`false` from `git check-ignore`, `null` when git cannot tell (no repo, or an ambiguous answer). |
| `world.makeDefault` | Point `worlds/index.json` at an existing world. Manifest-checked. |
| `world.delete` | Remove a world directory. **Refused for the current default.** |
| `world.rename` | Rename a world directory (case-insensitive-FS aware). |
| `world.duplicate` | Copy a world under a new name. |

**`hooks/useWorld.tsx` holds the world state, and it is SHELL state, not panel state** —
the world chip reads it, ⌘S drives it, the drawer lists against it. That placement is the
point: a control stack that owns the save verb cannot be dissolved into palettes, and
closing the palette holding it would take ⌘S with it. It sits *under*
`FieldHostStateProvider` because the dirty bit derives from the stats that provider
already owns (`subscribeStats` is a single slot — a second subscription here would
silently steal the status bar's).

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
  existing per-frame stats push rather than a thirteenth single-slot seam — every reader of
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
  `write` / `open` and `field-host.ts`'s `requestVoidCast`; nothing else restates them.
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

### 20.5 Seeing — studio shading, the View popover, the pose seam

**`FieldHostShading = "studio" | "normals"`**, and **`studio` is the default** (D-F4.5-17,
"the state of seeing"): per-class lit materials under a **camera-following key light plus
a hemisphere fill**. `normals` (unlit normal-colour, material classes deliberately
indistinct) is now a *debug flag*, not a peer. The advisor's flag markers stay
`shader.unlitInstanced` for exactly this reason — a marker that dims when the key light
looks away stops doing its job in the mode meant for mood.

**`hooks/useView.tsx`** owns what the field LOOKS like — shading, layer visibility, the
slice plane, viewport AA — and nothing about what is in it. It is shell state for the
world-state reason: the View popover drives it, the burger's View group drives the same
values, and the canvas layer reads the AA setting.

It is the **chrome→host direction**, which is why it is not part of `useFieldHostState`
(host→chrome). The host has no shading/layers/slice subscription to mirror, so this
provider is the source of truth and **pushes: one effect per seam, each keyed on its own
value**, so a shading change never re-sends the layer flags (`setLayers` is edge-sensitive
for `voidCast`) and a slider drag never re-sends the shading mode. Defaults:
`DEFAULT_LAYERS` all-true but `voidCast` (opt-in — ticking it runs a whole-world cast),
`SLICE_DEFAULT_Y = 8`, `DEFAULT_SAMPLE_COUNT = 4`. The layer set is restated here rather
than imported because the chrome cannot value-import the host (the project-first
invariant), and it is pushed at engine-ready so the two agree from the first frame.

**The camera-pose seam.** `FieldHost.subscribeCameraPose` pushes `{ yaw, pitch }` in
radians; `shell/AxisTriadMount.tsx` reads it through `useFieldHostState` and renders the
corner triad. Since **F4.5b Task 6 the triad is also a CONTROL**: its six axis ends are
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
the SVG behind them paints far-to-near. The triad mounts **above the palette layer in DOM order** — the default
arrangement docks `controls` to the right edge at top 0, which covers exactly the corner
the triad sits in, so mounted before the layer it would ship invisible out of the box.
`Toasts` sits there for the same reason with a softer case. Both are their own absolute
box inside the SAME cell: they take nothing from the canvas (D-1).

### 20.6 The menu, the shortcut overlay, and the ONE history

The menu is a **single burger dropdown** (`shell/BurgerMenu.tsx`) whose groups render in
the order **World / Edit / View / Help** — not a menubar.

**Since F4.5b Task 7 the bindings are DECLARED ONCE, in `frontend/lib/actions.ts`.** That
table is the editor's action registry: per action, an id, a group, a contextual `label`,
an `enabled` predicate, the display chord, a `match` predicate and a `gate`. Three
surfaces read it — the window key dispatcher (`hooks/useGlobalKeybindings.ts`), the
burger's World/Edit/View groups, and `shell/ShortcutsDialog.tsx` — so a binding cannot be
live and undocumented, or documented and dead. `hooks/useActionContext.tsx` assembles the
`ActionCtx` those predicates read (host, armed tool/gesture, session, selections, world,
view, workspace) and owns the listener. The overlay's one remaining hand-maintained group
is the canvas-owned keys.

**Who owns a key.** There are two keydown listeners. The canvas
(`viewport-host/field-host.ts`) keeps the keys that steer the viewport under the pointer —
the fly set, `[`/`]`, the arrow nudges, momentary ⇧/⌃ — plus first refusal on ⌘Z, ⏎, Esc,
R and F. Everything else is the registry's, on `window`, which is the only listener that
carries the gates and the only one that still works after a palette click takes the
canvas's focus. Where both bind one key the canvas branch that ACTS calls
`stopPropagation`, and that call is the whole licence for the second owner.

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

**Esc is a LADDER** (`FieldHost.escape()`), not a single verb: it cancels exactly one
thing, most recent intent first — a half-drawn box/segment anchor, then the live session
(a move included), then the selected entity, then the cell selection. The canvas's Esc and
the registry's run the same function, so they cannot disagree about the order.

**⏎ is `FieldHost.confirmSession()`**, which drops a live grab (the zero-step rule, the
pending-preview latch) and otherwise ends the session by mode. Both keys route through it.
It is public rather than canvas-only because `beginMove` does NOT focus the canvas: a grab
started from the Edit menu, or by `G` with a palette control focused, has no canvas
listener to answer the "⏎ drop" the status bar advertises. `commitSession()` is the
narrower "end by mode" a panel button means.

**WASD/QE fly ONLY while the right button is held** (D-10, the Unity mechanism). That gate
is what buys the bare-letter budget the registry spends: `S` is fly-backward *and* the
stamp family, and the button is what decides which.

### 20.7 What moved out of FieldPanel — and what remains

`FieldPanel.tsx` is now **261 lines** and rides in the `controls` palette (§19's
orchestrator-slope entry tracked it at 817). What left, and where it went:

| Left the panel | Now lives in |
| --- | --- |
| every host subscription — stats, tool-error, camera-pose, entities, drift, (F4.5b Task 2) tool, selection, stamp, flags, and (Task 4) entity-selection | `hooks/useFieldHostState.tsx` (the provider) |
| world verbs (Save / Open / Bake) | `hooks/useWorld.tsx` + the world chip + the drawer |
| shading, layer gates, slice plane, AA | `hooks/useView.tsx` + `shell/ViewPopover.tsx` |
| the catalog fetch | `hooks/useCatalogs.tsx` (mounted once by the shell) |
| the committed-entity list + drift report | `shell/EntitiesPalette.tsx` — the first organ out, the layers panel since Task 4 |
| the status line | `lib/notify-store.ts` (toasts + the log) |
| the armed GESTURE (which of pointer / box / wand / room / segment holds LMB), F4.5b Task 7 | `hooks/useFieldHostState.tsx`'s tool context — the registry's `V`/`B`/`M` family keys arm the same slot the palette's buttons do, and a panel-local copy would disagree with them on the first keypress |

What **remains** is the dig loop's control stack: the tool palette, the material
swatches, the brush inspector, the stamp inspector and the advisor's flags — rendered
entirely from the provider's contexts, with **no host subscription of its own**.

**`hooks/useFieldHostState.tsx` is the ONE subscription point for the seams the chrome
reads**, and the reason is a real failure mode: every `FieldHost.subscribe*` seam is a
**single slot** (`statsCb = cb`), so a second subscriber silently steals the first's —
the earlier consumer just stops updating, with nothing thrown and nothing logged. All
**eleven** seams live there (stats, tool-error, camera-pose, entities, drift,
entity-selection, tool, selection, stamp, pending-stamp, flags), published through
**eight** contexts split by CADENCE — a
frame-paced seam must not re-render a surface that only cares about an answer. Each
context makes its own throw-vs-default call at its docblock; `CameraPoseContext` is the
only defaulted one, because "no camera here" is the one default that is true outside the
provider. **No surface below the provider may re-subscribe to anything it owns.** The
stats push is guarded by a value-equality comparator with a
`satisfies Record<string, never>` backstop — a new
`FieldStats` field fails the never-check and forces the comparator to learn it, because a
missed field would silently *weaken* the guard.

### 20.8 The daemon feed

`hooks/useDaemonFeed.ts` reduces the SSE feed to the two things the chrome does with it:

- a **`worldsVersion` counter** bumped on `worlds-changed` / `generation-baked` — a
  version rather than a payload, because those events are notification-only dirty bits.
  Anything rendering the world list refetches on it.
- the **hard reload** a stale engine bundle needs (`bundle-outdated`), **refused while a
  world write is in flight** — the subscription re-binds only when the engine becomes
  ready, so it reads `bakeBusyRef` (a ref, not state) to see the current value without
  re-subscribing. A reload mid-upload would kill the write.

It is a hook rather than App-local state for Shell's reason: a feed wired inside App is a
feed no test can drive, because App owns the WebGPU probe and the `/engine.js` import.
There is **nothing to catch up on** at `onOpen` — the editor mirrors no daemon-owned
document; the field world lives in the host until the user saves it.

## 21. F4.5b — the hands (2026-08-01)

**This section is the authority on the editor's VERBS**, as §20 is on its surfaces. F4.5a
gave the cockpit a canvas with things floating over it; F4.5b gave the user hands to work
in it — a pointer that picks *in the viewport*, a move / delete / duplicate vocabulary for
committed stamps, one action registry behind every key and every menu item, and the
dissolution of the last control stack into palettes and bars of its own. **`FieldPanel.tsx`
no longer exists** (§21.9). The editor is still field-only; §20's opening stands.

One BEHAVIOUR CHANGE runs under all of it and is the bargain the rest is bought with:
**WASD/QE no longer fly unless the right button is held** (§21.4).

Scope note: this is the as-built at the end of F4.5b. The slice worked the
`MIGRATION (until F4.5b)` markers §20 counted down as it went, each one at the task that
made its provisional shape unnecessary; `grep -rn "MIGRATION (until" packages/editor/src`
remains the live list of anything still marked provisional.

### 21.1 The pointer, and the CPU ray pick

`ViewportGesture` gained a `"pointer"` member and **it is what a fresh host is armed with**
(D-F4.5-7; the chrome's mirror opens on the same value, `DEFAULT_GESTURE`, so the two
cannot disagree at boot). Under it LMB selects and drags rather
than strokes, and the wheel travels the camera instead of sizing the brush.

**`viewport-host/field-pick.ts` is the arbitration, and it is pure and GPU-free** — the
`field-ghost.ts` / `field-placements.ts` sibling. CPU rather than a GPU id pass, and that is a
decision with reasons rather than a fallback: the field host acquires its context at
`sampleCount: 4` and core's `frame.renderToTexture` throws on any context whose
`_internal.sampleCount !== 1`, so the id pass cannot even be RENDERED on the default editor
context; and the two things most worth picking — entity footprints and gizmo handles — have
no meshes at all (a `drawLines` batch and pure math respectively). The consequence is
written into the design rather than tolerated: **a CPU pick is affordable per CLICK, not per
pointermove, so there is no hover pre-highlight anywhere in the editor.** Selection is
click-driven.

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

### 21.2 One selection, two surfaces — the `subscribeEntitySelection` seam

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
`field/EntitiesList.tsx` carries the row verb set — Open, freeze ❄ / unfreeze 🔓, bake ⬇,
delete 🗑, each through one `RowVerb` component that owns the wrapper a disabled button needs
(a disabled button swallows the pointer events a `title` wants, so the reason rides the
`aria-label` too). **Duplicate is deliberately NOT a row verb** — D-14's glyph map puts ⬇ on
bake and the mock puts duplicate in the burger. The `Δ` drift badge appears on any row the
standing report touches; membership is the HOST's answer, pushed as
`FieldDriftReport.entityIds` and turned into a `ReadonlySet` by the provider, so a badge
cannot outlive the geometry it points at.

Esc's third rung clears the entity selection, and `F` (`view.frame` →
`FieldHost.frameSelection`) frames the selected entity's footprint, else the cell selection's
AABB, else reports "nothing selected to frame" — a FIXED priority rather than a recency
rule, because an object selection names one thing and a cell selection names a volume.

### 21.3 Move, delete, duplicate — and a move IS a reconfigure session

**`FieldHost.beginMove(entityId)` opens exactly the session `openEntity` opens** — the same
refusals (unknown id, frozen, baked, retired generator, all runtime-quiet through
`subscribeToolError`), the same ghost, the same terminal verb. What it adds is a MODE: the
session is flagged `StampSession.moving`, and the CURSOR drives the region. That is the
load-bearing decision of the whole verb — nothing is written to the log until the drop, so a
cancelled move costs nothing and leaves no history entry, and the drop is one ordinary
reconfigure splice.

`viewport-host/field-move.ts` owns the arithmetic and is pure, for `field-pick.ts`'s reason:

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
- `moveIsIdle` is the zero-step rule: a grab dropped where it started ends the session rather
  than spending a history entry. Known limit, filed rather than papered over — it reads the
  CURSOR's accumulated steps, so a grab moved only by the arrow keys reads as idle and is
  discarded (`docs/backlog/editor-and-tooling/grab-nudged-by-arrows-reads-as-idle.md`).
  Routing both ⏎s through one verb is what keeps that a single defect rather than a
  difference between two keys.

**`viewport-host/gizmo.ts`** is the translate handles' pure math — `gizmoSpan` derives the
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
reads "1 ops" for a scatter that takes every prop it placed with it; the row's 🗑 and the menu
item raise the same App-owned prompt, though the sentence is spelled in both
`shell/EntitiesPalette.tsx` and `lib/actions.ts`.

### 21.4 The action registry, the window dispatcher, and the RMB-gated fly

**`frontend/lib/actions.ts` is the editor's one action registry** (D-10/D-11/D-12): per action
an id, a group, a contextual `label`, an `enabled` predicate, the display chord, a one-sentence
`hint`, a `match` predicate, a `gate`, the `armsTool` / `flyLetter` flags and a `menuTitle` for
a reason that will not fit in a label. The module is pure and DOM-free (`KeyboardEvent` appears
as a type only), and it type-imports the host like every other chrome module.

Six surfaces render from it, which is what stops a binding from being live and undocumented or
documented and dead: the window key dispatcher (`hooks/useGlobalKeybindings.ts`), the burger's
World/Edit/View groups (`shell/BurgerMenu.tsx`), the shortcuts overlay
(`shell/ShortcutsDialog.tsx`), the tool rail through `TOOL_FAMILIES` (§21.8), the top bar's
Bake button, and the status bar's selection-chip popover. The `tool` and `session` groups are
deliberately absent from the menu — arming a brush and ending a session are the rail's and the
viewport's, and the overlay is where they are discovered.

**`hooks/useActionContext.tsx`** assembles the `ActionCtx` those predicates read (host, armed
tool/gesture, session, both selections, stats, world, view, workspace, the generator registry,
the ⇧S stamp cursor, the pending stamp arm, the two history labels) and owns the ONE window
keydown listener. It is a PROVIDER rather than a hook the shell calls, and that is load-bearing
for render cost: assembling the ctx reads values that move on every op and every drag frame, so
doing it inside `ShellChrome` would rebuild the palette body elements per pointermove. Here
`children` arrive already built. The listener binds ONCE and reads the ctx through a ref written
in an effect — a render React discards must not leave its ctx behind as the one the next
keypress acts on.

**Who owns a key.** Two keydown listeners. The canvas (`viewport-host/field-host.ts`) keeps the
keys that steer the viewport under the pointer — the fly set, `[`/`]`, the arrow nudges, the
momentary ⇧/⌃ — plus first refusal on ⌘Z, ⏎, Esc, R and F. Everything else is the registry's, on
`window`, which is the only listener that carries the gates and the only one that still works
after a palette click takes the canvas's focus. Where both bind one key the canvas branch that
ACTS calls `stopPropagation`, and that call is the whole licence for the second owner.
`preventDefault` fires as soon as the gate ALLOWS an action, *before* `enabled` is consulted:
at that point the key is claimed, and a disabled ⌘S must still suppress the browser's save-page
sheet. A REFUSED action prevents nothing, so the character the user is typing still reaches
their field.

**The gate** (`gateAction`, and `clickGate` for a pointer press on the same verb, so a button
and its key refuse for the same reason in the same words) has two classes plus two per-action
flags:

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

**Esc is a five-rung LADDER**, one shared `escapeLadder()` behind both entry points so they
cannot disagree about the order: a half-drawn box/segment anchor, then the pending stamp arm
(§21.8), then the live session (a move included), then the selected entity, then the cell
selection — which is PARKED in the Reselect slot, so an Esc that went one rung too far has the
same way back a Clear does. It returns whether it acted, which is how the canvas branch knows
whether it has claimed the event.

**Undo/redo go straight to the host: the field's op log IS the editor's history** (§21.6). ⏎ is
`FieldHost.confirmSession()`, public precisely because `beginMove` does not focus the canvas — a
grab started from the Edit menu, or by `G` with a palette control focused, has no canvas
listener to answer the "⏎ drop" the status bar advertises.

### 21.5 The session card — three states over one control set

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

### 21.6 ONE named history — the seam and the palette

**`viewport-host/field-history.ts` derives what each undo/redo step DID, in words**
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

**`subscribeHistory` is the twelfth host seam and `useFieldHistory` the ninth context** — §20.7's
figures of eleven and eight both moved here. The host publishes only when the log's two entry
stacks really moved (several paths tick the entity list without touching them), which is why the
provider's mirror needs no comparator, and the context DEFAULTS rather than throws because an
empty history means "nothing has been done yet", which is exactly true outside a provider.
`useActionContext` reads the top of each stack for `Undo ${label}` / `Redo ${label}`, off the
LABELS rather than off `stats.undoDepth`: the depth says whether there is a step, the label says
what it is.

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

### 21.7 The Flags palette, viewport flag selection, and cell-level selection display

**`shell/FlagsPalette.tsx`** is §19's `FlagsSection` promoted out of the dissolving control stack
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

**Cell-level selection display.** `viewport-host/field-selection-cells.ts` draws a flood
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

### 21.8 The tool rail, the top strip, the session strip

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
list, of which the strip renders a prefix — ONE list in `shell/tool-params.tsx`, two renderings, so
"the ⋯ holds everything the strip shows plus the rest" is structural rather than a promise. The two
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

**`viewport-host/viewport-cursor.ts`** is D-F4.5-8's third arming channel, and its two decisions
live together because they have to agree: the CSS keyword under the pointer (`grabbing` / `grab`
for a live move, `cell` for the two-click gestures, `crosshair` for the one-click commits,
`default` for the pointer and for anything a session has suspended) and the world-space mark drawn
before the first click (`ring` for the segment brush, whose sweep really is `digRadius` thick;
`cross` for a box corner and a pending stamp's region corner, neither of which has a radius).

The status bar's `armedKeymap` is the fourth channel and is **hand-enumerated rather than derived
from the registry**, deliberately: the registry knows what a key RUNS, not which four of two dozen
bindings matter in a given mode, and half of what belongs on that line is canvas-owned keys the
table does not carry at all. Its modifier clause is derived (`modifierParts`) rather than static,
because `deriveMomentary` swaps dig↔fill symmetrically and passes ⌃ through under paint and smooth
— a static clause named three keys the host does not bind.

### 21.9 What is left of FieldPanel — nothing

`FieldPanel.tsx` is **deleted**, and the `controls` palette id retired with it. The panel's organs
went to five places over the slice: the tool palette and brush inspector to the rail and the top
strip (§21.8), the stamp inspector to the session card (§21.5), the flags section to its own
palette (§21.7), the selection count and its verbs to the status bar's chip, and the entity list to
the entities palette back in F4.5a (§20.7).

`PALETTE_IDS` is now `entities`, `session`, `flags`, `history`, `log` — and `controls` is the first
id to actually exercise the closed union: a blob written by any earlier build still carries a
`controls` record, and `deserializeWorkspace` drops it on the floor exactly as it drops an id that
never existed. **Nothing migrates the stored shape**, which is the whole reason the union is closed
in `lib/palette-store.ts` rather than inferred from whatever the blob happens to contain. No default
claims an EDGE any more — `controls` was the only one that docked — so the open defaults live in a
left column (`entities` at the top, `flags` below it) with `session` and `history` in a second at
x = 420, leaving the top-right clear for the axis triad, the bottom-left clear for the
collapsed-chip rail, and the whole right half of the cell unclaimed until the user docks something
there.

`hooks/useFieldHostState.tsx` now carries **all twelve seams through nine contexts** and remains
the ONE subscription point: every `FieldHost.subscribe*` seam is a single slot, so a second
subscriber silently steals the first's, and no surface below the provider may re-subscribe to
anything it owns. That rule is a claim about the SET rather than about any one surface, which
is why its test outlived the panel it used to live in
(`tests/chrome/host-seams-and-catalogs.test.tsx`).
