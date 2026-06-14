# Editor Architecture

The as-built `@furnace/editor` package, milestones **M3** (editor shell) + **M4** (command layer) + **M5A** (inspector) + **M5B** (viewport interaction), plus the **M1-slices** registration batch (the full built-in set + physics-from-data in the core loader). This is the reference — "how the editor IS today." The decision history that produced it lives in `docs/backlog/editor-and-tooling/editor-backend-architecture.md`; this doc describes the running system.

> **Epic status (2026-06-14): the editor epic is complete and paused.** M1→M5B + M1-slices landed and sealed. The originally-planned **M6** (behaviour runtime) and **M7** (porting + docs) are **dropped** — the project retargeted from the bowling demo to its actual application (a first-person dungeon crawler), so future editor work is driven by that app's **procedural-authoring** needs rather than the old milestone ladder. The known gaps a future editor pass must address are captured in `docs/backlog/editor-and-tooling/editor-interaction-model-redesign.md`.

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

**`ViewportHost` protocol** — `src/viewport-host/index.ts`. The narrow chrome↔engine interface: `{ init(canvas, gpuOptions?), loadScene(doc), render(), introspect(), destroy() }` plus the M5A live-preview seam (`previewEntity`, `previewSettings`, `revertEntity`, `syncCommitted` — §10). The host owns the GPU context and the loaded scene; the chrome drives it through this interface and never enters the render loop. It is **render-on-demand** (no rAF loop): a render is issued on load, on canvas resize, and via `render()` for any other redraw.

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
- **Remaining viewport/hierarchy work deferred from M5B** — resource live-preview (`rebuildResource` cascade), editor fly-camera (WASD), and hierarchy tree (requires scene-format parent decision). See `docs/backlog/editor-and-tooling/editor-M5B-viewport-interaction.md`.
- **Session concurrent-open race hardening** — two await-point races in `session.ts` (`onFileChanged` / `apply` capturing stale `state` across an await) are benign under the single-user serialized-command model and deferred with a staleness-guard fix: `docs/backlog/editor-and-tooling/session-concurrent-open-race-hardening.md`. Becomes load-bearing when M5 adds continuous interactions or a second concurrent writer.

## 10. M5A — inspector, selection, live preview

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

**JSON Schema contract (`types.ts`).** The inspector's `JsonSchemaNode` is a plain frontend-local type (structurally equivalent to what `scene.introspect()` returns, cast at the boundary in `InspectPanel.tsx`). The module must not value-import `@furnace/core` — enforced by `packages/editor/tests/frontend-no-engine-leakage.test.ts`.

**Kind resolution (`kind.ts`).** `resolveKind(schema)` maps a schema node to a `FieldKind` in priority order: `schema.furnace.kind` (for furnace-specific kinds) → `enum` presence → JSON type string → `"unknown"`. The furnace kinds handled: `vec2`, `vec3`, `vec4`, `quat`, `color`, `resource`, `ref`. **Note:** `furnace` sits at the schema-node ROOT, not nested under `meta` — `z.toJSONSchema` hoists zod's `.meta({ furnace })` to the node root. (Reading it from `meta` was the M5A holistic-review CRITICAL bug.)

**Kind→renderer registry (`registry.tsx`).** A `Partial<Record<FieldKind, FieldRenderer>>` maps each kind to its React component. Current registry (verified against source):

| Kind | Renderer |
| --- | --- |
| `number` | `NumberField` — numeric input with drag-scrub |
| `string` | `StringField` — text input |
| `boolean` | `BooleanField` — checkbox |
| `enum` | `EnumField` — `<select>` |
| `vec2` / `vec3` / `vec4` | `makeVecField(n)` — N-component number row |
| `color` | `ColorField` — RGBA color picker |
| `quat` | `QuatField` — Euler XYZ degree inputs (converted via `lib/euler.ts`) |
| `resource` | `ResourceRefField` — `<select>` over available resource ids |
| `ref` | `EntityRefField` — `<select>` over entity ids |
| `object` | `ObjectField` — nested properties |

`fallbackRenderer` is `DefaultField` — displays the value as JSON read-only.

**`<SchemaForm>` (`SchemaForm.tsx`).** Iterates `schema.properties`, resolves each field's kind, looks up (or falls back to) the renderer, and renders it wrapped in a **`RowErrorBoundary`** — a React class error boundary that catches per-row render errors and displays them inline without crashing the whole form. Manages N working drafts (`useState`); re-seeds them when the committed `values` reference changes (the `seed` ref guard). Props: `{ schema, values: unknown[], onPreview, onCommit, onCancel }` — a pure callback contract, no internal fetch or mutation.

**Euler / quat duplication (`lib/euler.ts`).** The `quatToEulerDeg` / `eulerDegToQuat` math is hand-rolled in the inspector because the frontend cannot value-import `@furnace/core`. The conversion matches `core/transform quat.fromEuler` (intrinsic XYZ) and is pinned to core's convention by a test. Similarly, material `"default"` kind detection is duplicated frontend-side (see `lib/resource-kind.ts`). Both duplications are intentional and documented as such.

**Swap escape hatch.** The `frontend/inspector/` boundary is the swap seam: replacing the rendering library (e.g. moving to a richer form engine for M5B) means rewriting only `SchemaForm.tsx` + the field renderers in `fields/`, keeping `<InspectPanel>` and `SchemaFormProps` untouched. The `JsonSchemaNode` type and the `onPreview`/`onCommit`/`onCancel` callback contract are the stable interface.

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

M5B landed the full manipulation loop: GPU-id picking, AABB selection highlight, translate gizmo, orbit/pan/zoom camera, NumberField drag-scrub, focused-input echo-guard, settings-revert, and three M5A inspector papercuts (⑩⑪⑫). This section documents the as-built additions to the M5A substrate.

### 11.1 Engine additions (`@furnace/core`)

**`camera.screenToRay(cam, ndcX, ndcY) → Ray`** — unprojects a normalized-device-coordinate position (`ndcX`/`ndcY` in `[-1, 1]`, Y-up) to a world-space ray `{ origin: Vec3, dir: Vec3 }`. `origin` is the near-plane point; `dir` is normalized. Returns a degenerate ray (`dir ≈ 0`) when the view-projection is singular. Reuses scratch buffers; allocates one fresh `Ray` per call. Source: `packages/core/src/camera/ray.ts`; exported from `@furnace/core/camera`.

**`LoadedScene.entityBoxCorners(entityId) → Float32Array | null`** — returns the 8 world-space AABB corners of the named entity (24-element `Float32Array`, 3 floats per corner, bit-index layout: bit0=x, bit1=y, bit2=z); null when the entity has no geometry. Computed from geometry local bounds baked at `geometry.create` time, transformed by each mesh's current model matrix. Source: `packages/core/src/scene/loader.ts`.

**`LoadedScene.setEntityTransform(entityId, { position?, rotation?, scale? })`** — direct GPU poke on all meshes owned by the named entity: per-field optional, no rebuild, no clone. The translate-gizmo preview fast path — avoids `rebuildEntity`'s clone+teardown+rebuild for the common "drag a transform" case. Source: `packages/core/src/scene/loader.ts`.

**`LoadedScene.pick(ctx, cam, ndcX, ndcY) → Promise<string | null>`** — GPU id-buffer pick. Renders all pickable meshes into an off-screen `r32uint` id target (1-based per-entity integer colors, no AA, depth write enabled), reads back the single texel under the cursor via `copyTextureToBuffer`, and maps the id back to an entity id string. Returns `null` for a background click. All transient GPU resources (id texture, depth texture, id uniform buffer, readback buffer) are allocated and freed per call; the render pipeline is lazily built and cached per context. Source: `packages/core/src/scene/pick.ts`.

**Geometry local AABB (internal)** — at `geometry.create` time, the engine now computes the AABB from vertex data and stores it on the `GeometrySlot` as `localMin`/`localMax`. Used by `entityBoxCorners` to produce world-space corners without re-scanning vertices at pick time. Internal; not part of the consumer-facing `@furnace/core/geometry` surface.

**`drawLines` `occlude` option** — `frame.drawLines` gained an `occlude?: boolean` option (default `true`). `occlude: true` → `depthCompare: "less-equal"` (depth-tested, occluded behind nearer meshes — AABB highlights, physics debug); `occlude: false` → `depthCompare: "always"` (always-on-top — gizmos). Two pipelines are kept per context (one per depth mode). `DrawLinesOptions` type updated. Source: `packages/core/src/frame/draw-lines.ts`.

### 11.2 Editor orbit camera

`viewport-host/camera-control.ts` implements a **spherical orbit camera** as the pure-math state type `OrbitState { target, distance, yaw, pitch }` plus four pure functions: `orbit(s, dYaw, dPitch)`, `zoom(s, delta)`, `pan(s, dx, dy, right, up, speed)`, `toEyeTarget(s)`, `fromEyeTarget(eye, target)`. No engine imports; trivially unit-testable.

The host (`viewport-host/index.ts`) maintains a private `editorCam: Camera` and `orbitState: OrbitState`:

- **Initialized on a *new* scene load** with the **eye** at the scene camera entity's position, but the orbit **pivot** set to the scene-content centroid (`sceneContentCentroid()` — the mean of every renderable entity's AABB corners), *not* the scene camera's authored look-target. The camera builtin places that look-target only ~1 unit ahead of the eye, which made the whole scene swing wildly when orbiting; pivoting on the content centroid keeps the scene framed and lets orbit/F rotate around what you're looking at. Falls back to the authored target only for an empty scene. Then bound to the canvas via `camera.bindToCanvas` so the editor camera's aspect auto-tracks canvas size; `camera.bindToCanvas` is unsubscribed and re-subscribed on each `loadScene` call.
- **Preserved across same-scene reloads** — `loadScene(doc, { resetCamera })` only re-initializes the orbit state when `resetCamera` is true (a scene open/switch, keyed off a path change in `App.tsx`'s `refreshSession`). A same-scene revision bump — a resource/settings commit or external file edit — reloads the document and rebuilds meshes but keeps the existing `orbitState`, so the user's orbit/zoom does not jump. The `editorCam` object is recreated each reload (then rebound); applying the preserved `orbitState` to it reproduces the exact view. Resource commits reload via the SSE echo (they are not echo-suppressed), so without this the camera reset on every material/settings color edit.
- **Never serialized** — the editor camera is completely independent of the scene camera entity. Editing the scene camera entity in the inspector does not move the editor view; orbiting in the viewport does not touch the scene document.
- The `loaded.camera` (the scene camera entity) is kept but not used for rendering; `editorCam` is passed to `frame.render` and `frame.drawLines` instead.
- **Controls** (see `viewport-host/input-map.ts` `classifyDrag`): left-drag = select (no modifier) or orbit (Alt held), Alt+Shift-drag = pan, middle-drag = orbit, scroll = zoom (exponential, `exp(delta * 0.1)`), F key = frame-selected (sets orbit target to selection centroid). The `keydown` listener lives **on the canvas**, so `onPointerDown` calls `canvasEl.focus({ preventScroll: true })` to give it keyboard focus on every click — Safari does not focus a `tabindex` element on click (and blurs the prior focus), so without this F/Escape would only work until the first viewport click.

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

The editor renders whatever the consumer's `@furnace/core` scene loader produces; it has no engine of its own (§1). The core loader now reproduces the bowling demo's full **setup** from a data document, so the editor viewport can load lit, textured, and physics-bearing scenes — not just the unlit/cube scenes earlier milestones exercised. The built-in registry (`packages/core/src/scene/builtins.ts`, verified in source) covers:

- **Geometry kinds** — `cube`, `sphere`, `cylinder`, `plane`.
- **Shader kinds** — `unlit`, `lit`, `texturedLit`, `textured`, `normalColor`.
- **Texture kinds** — `checkerboard` (procedural) and `load` (decode bytes).
- **Material** — `standard`, now with optional `texture` + `sampler` slots (the loader resolves nested resource refs).
- **Effect kinds** — `bloom`, `tonemap` (the consumer's HDR post chain).
- **Components** — `transform`, `meshRenderer`, `light` (`directional` / `point` / `spot`, optional `shadow`), `rigidBody` (static / dynamic).
- **Settings** — full schema: `clearColor`, `ambient`, `post`, `gravity`, `lengthUnit`, `sim`, `msaa`, `hdr`.

**Physics-from-data.** A `rigidBody` component instantiates against a lazily-created physics world; when an entity has both `rigidBody` and `meshRenderer`, the `meshRenderer` **defers** (returns no mesh) and the `rigidBody` builds a **rigidMesh composite** that owns the mesh and binds its transform to the body. The world and bodies are fully **instantiated but NOT stepped** — there is no fixed-step loop in the loader. **Driving the simulation is the consumer's game-loop concern** (the loader instantiates the world + bodies; a consumer fixed-step loop would call `world.step`). So a loaded physics scene shows the bodies at their authored rest pose; it does not simulate.

**Viewport-host render path — lights + ambient on, post deferred.** `renderLoaded` (`packages/editor/src/viewport-host/index.ts`) passes the loaded scene's `lights` and `ambient` to `frame.render` — these don't depend on the context's HDR state, so the editor shows the real lit scene (the lit-viewport payoff). It passes **`effects: []`** — the post chain is deferred. The host's GPU context is **non-HDR** (`init()` requests the default `hdr: false`). The relevant `frame.render` contract (`packages/core/src/frame/render.ts`) throws **only** when `hdr === true` **and** the effect chain is **empty** (an `rgba16float` scene target with no pass to reach the LDR swap chain); a non-HDR context with effects does **not** throw. So the deferral is about **fidelity, not a crash**: a scene's post chain (`bloom → tonemap`) is authored for the consumer's HDR pipeline, where tonemap maps `rgba16float → LDR`; running that HDR-authored chain against the editor's LDR scene target would produce wrong output rather than the real preview. Post-preview lands when the editor viewport gains an HDR context (tracked in `docs/backlog/editor-and-tooling/editor-viewport-hdr-context-and-post-preview.md`). Note that authoring textures/effects resources via the editor's `scene.setResource` command is not yet wired — its `tableEnum` still covers only `geometries | shaders | materials` (§4); the new tables are loadable and validatable but not yet command-mutable.
