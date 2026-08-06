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
slices that made the chrome what it is. §19 lists what is deferred, and **§20 is foundations
T3a** — the framework primitives the field host's decomposition is being built on. §20 sits
after Deferred rather than before it because section numbers here are append-only.

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

The editor contains **no engine**. This is the load-bearing invariant (called "project-first resolution"): every engine import — `@furnace/core`, the consumer's extensions, the viewport-host — is resolved and bundled *from the consumer's own `node_modules`*, never from the editor package's. The editor ships UI chrome and a daemon; the engine code is always the consumer's. (Verified: `packages/editor/package.json` declares `@furnace/core` only as a `devDependency`, used for types and the workspace symlink; the runtime engine bundle is built from the project root — see §3.)

**Dogfood / run command.** In `packages/hello-world`, `bun run edit` runs the `"edit"` script:

```
bun run --cwd ../editor build:frontend && bun ../editor/src/daemon/main.ts
```

It prebuilds the chrome (§7), then starts the daemon with the consumer's directory as the project root (`main.ts` uses `process.cwd()`). Source: `packages/hello-world/package.json` `"edit"`, `packages/editor/src/daemon/main.ts`.

## 2. The daemon

A **Node-portable** HTTP server. No `Bun.*` or `bun:*` anywhere in `src/` — enforced by the static scan in `packages/editor/tests/no-bun-leakage.test.ts` (regex-scans `src/` for Bun-API usage). It builds on `node:http`, `node:fs`, `node:path`, `node:crypto`, `node:os`, `node:url`; it runs under plain Node ≥20 and under Bun.

**Binding & lifecycle.** `startServer(opts)` (`src/daemon/server.ts`) creates a `node:http` server and listens on **`127.0.0.1`** only — one local single-user session. Port defaults to `4500` (`main.ts`), overridable with `--port`; tests pass `port: 0` to let the OS pick. `close()` tears down the server, the SSE hub, the extensions-directory watch, and the esbuild bundler context.

**Routes** (matched in this order in `server.ts`'s `route`):

| Method + path | Behaviour |
| --- | --- |
| `GET /engine.js` | Builds and returns the browser engine bundle (§3) as `text/javascript`. esbuild build failure → `500` with the diagnostics as plain text. |
| `GET /api/events` | Subscribes the response to the SSE change feed (§5). Stays open. |
| `POST /api/<command>` | Reads the request body, JSON-parses it (`{}` if empty body; invalid JSON → `400 invalid-json`), and `dispatch()`es the command (§4). Always `200` with the handler result, or the error envelope on an `EditorError`. |
| `GET <anything else>` | Chrome first: serves a static file from the prebuilt chrome dir (§7), with a path-traversal guard. On a chrome miss, falls back to **project asset serving**: the path is mapped onto the project root (root-contained; dotfile segments and `node_modules` refused) so a project's root-absolute asset URLs resolve exactly as on the consumer's own dev server. This is how the chrome reaches the three project→editor catalogs (`/catalog/materials.json`, `/catalog/entities.json`, `/catalog/agent.json` — §11, §14, §15) and the archetype `/catalog/*.fmesh` meshes. Neither hit: missing chrome dir → `503` with a "run build:frontend" hint; otherwise `404`. |
| any other method | `404 not-found`. |

**Error handling.** The `route` body is wrapped in a try/catch: a thrown `EditorError` becomes `{ error: { code, message } }` at the code's HTTP status (`httpStatus`, §6); any other thrown value becomes `500 internal` with the error's message. There is **no request body-size cap** — by design, since the daemon binds localhost and serves a single user (`readBody` documents this; revisit if it ever accepts non-localhost connections).

## 3. Project-first bundling — one target

The daemon builds the consumer's engine code in **one** esbuild bundle, resolving every import from the project root's `node_modules` so there is exactly **one** core / registry / zod instance (Branch A's instance-identity requirement). It was two until foundations T2: a second, node-platform *registry bundle* existed only to give the daemon `@furnace/core/scene`'s `validateDocument` for server-side mutation validation, and it went with the scene surface (below).

**The browser engine bundle** — `src/daemon/bundle.ts`, served at `GET /engine.js`. A virtual stdin entry imports the consumer's extensions (for their registration side-effects), re-exports the **one** engine host, and re-exports the consumer's extension module as a **namespace**:

```
import "<root>/<extensionsEntry>";                          // registration side-effects, when configured
export { createFieldHost } from "@furnace/editor/viewport-host";
export { getService } from "@furnace/core/registry";        // the consumer's service seam (T1b)
export * as extensions from "<root>/<extensionsEntry>";     // the consumer's public surface, when configured
```

esbuild bundles this `format: "esm"`, `write: false`, `sourcemap: "inline"`, with `resolveDir: root`. The bundler context is **incremental**: each `GET /engine.js` calls `ctx.rebuild()`. Build failure returns `{ ok: false, error }` carrying esbuild's formatted diagnostics.

`createFieldHost` is the editor's only host (§11); the scene viewport host and the Slice 3.1 preview host that used to ride beside it were deleted at F4.5a, and `viewport-host/index.ts`'s own header records that the directory name is what is left of them. The `export * as extensions` is the **consumer-code seam**: it re-exports the same extension module the bare side-effect import already runs — so registration still fires exactly once — this time as a value namespace worker code can call the consumer's own functions through. When no extensions entry is configured the bundle emits `export const extensions = {}`. `EngineModule` (`frontend/lib/engine.ts`, the `loadEngine()` return type) is correspondingly `{ createFieldHost, extensions }` with `extensions: Record<string, unknown>`.

**The analyzer no longer reads the namespace** (T1b): the virtual entry re-exports `getService` from the CONSUMER's `@furnace/core/registry`, and `frontend/analyzer-worker.ts` resolves stage 2 via `mod.getService("analyzerVerify")` — a validated lookup that throws a nameable `FurnaceError` when the project registered nothing (the dungeon's `editor-extensions.ts` registers the service with `defineService` at import time, Branch A). The looked-up fn is still narrowed ONCE to `AnalyzerEngine["analyzerVerify"]` at the worker's boundary cast; the type stays structurally declared in `lib/analyzer-protocol.ts` (the wire-twin rule survives unchanged). Nothing on the main thread reads `extensions` at all. The generation-era members (`runWorld` / `bakeWorldFiles` / `realizeRegion` / `MaterialCache` / `worldDir`) went with the World panel; the dungeon's `editor-extensions.ts` still exports far more than the editor consumes, and the engine bundle may tree-shake whatever nothing imports.

**The daemon holds no schema knowledge.** The second bundle (`src/daemon/registry-bundle.ts`) existed for exactly one job: import the consumer's extensions on the *Node* side so `session.apply` could run `validateDocument` against the project's own registry before committing a scene mutation. With the mutations gone there is nothing server-side to validate — every schema decision now happens in the browser, inside the field host and the generator registry it drives. The daemon writes bytes (`generation.bake`) and reads them back (`field.load`); it does not know what a generator is. Deleted with it: the `extension-build-failed` error code, whose only throwers were that bundle's build and import paths.

**Staleness model.** The browser bundle rebuilds on every browser refresh (each `GET /engine.js`). Historically the browser had no way to *know* an extension's TypeScript had changed, so a refresh had to be manual. Slice 3.0 closed that (§5, "Directory watching"): `server.ts` watches the extensions entry's directory and emits `bundle-outdated` over SSE, and the frontend hard-reloads on it (unless a world write is in flight — §16.8), so `GET /engine.js` picks up the change automatically. Slice 3.1's second half of this — invalidating the daemon-side registry cache on the same watch — went with the registry bundle; the watch itself is unchanged and still the whole mechanism.

## 4. Commands

`src/daemon/handlers.ts` builds a `Map<string, Handler>` where each `Handler` is `{ input: ZodType, run(input): Promise<unknown> }`. `dispatch(handlers, command, input)`:

1. unknown command → `EditorError("unknown-command")`;
2. `handler.input.safeParse(input)` fails → `EditorError("invalid-input", …)` naming the first failing path;
3. otherwise runs the handler with the parsed input.

Every client — the chrome, a curl, a future AI binding — funnels through `dispatch()`, so input validation lives in exactly one place. All input schemas are `z.strictObject(...)` (extra keys rejected).

There are **8 commands in four families**, and **the chrome speaks all 8** (`frontend/lib/api.ts` has one method per command). It was 25 until foundations T2 deleted the 17-command `scene.*` family with the document session it drove. The remaining surface is deliberately thin: **the daemon owns bytes and the filesystem, the browser owns the world.** Nothing here holds a document, a schema or a generator.

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

The feed carries **three** events — `DaemonEvent = { type: "bundle-outdated" } | { type: "generation-baked"; files: number } | { type: "worlds-changed" }` (`src/daemon/events.ts`, verified against the source). It carried five more until foundations T2: the document session's own `SessionEvent` union (`scene-opened`, `document-changed`, `saved`, `file-conflict`, `file-invalid`) died with the session.

| Event `type` | Payload fields | Emitted when |
| --- | --- | --- |
| `bundle-outdated` | none beyond `type` | a source file under the extensions entry's directory changed ("Directory watching", below) — the browser should reload to pick up the freshly-rebuilt `/engine.js`. |
| `generation-baked` | `files` (count written) | `generation.bake` wrote the browser-uploaded file set to the project root (§4). |
| `worlds-changed` | none beyond `type` | the worlds directory or its index changed — `world.delete` / `rename` / `duplicate` / `makeDefault` each raise it AFTER their FS mutation succeeds. Consumers refetch `world.list` (§16.4). |

The SSE wire frame is `event: <type>\ndata: <json>\n\n` — every event rides it generically. The frontend `ServerEvent` union + `EVENT_TYPES` subscription list (`frontend/lib/events.ts`) mirror this daemon union and are kept in lockstep.

**There is no file watching any more.** `WatchFile` / `chokidarWatchFile` — the single-file watcher with the scene session's conflict matrix behind it (echo suppression by canonical form, dirty-conflict, clean-reload-as-undoable-mutation) — was deleted with the session in foundations T2. The daemon watches exactly one thing now, a directory:

### Directory watching

`src/daemon/watch.ts` also defines the `WatchDir` capability — `(dir, onChange) => unwatch` — and its production adapter `chokidarWatchDir`: a **chokidar v4 recursive watch** over `dir` (`node_modules` and `dist` paths ignored), firing `onChange` on any `add`/`change`/`unlink` beneath the tree (chokidar's `"all"` event, debounced by the same `awaitWriteFinish` settling as `WatchFile`). Like `WatchFile`, it is **injected** — `server.ts` takes an optional `watchDir` in `ServerOptions` for tests to fake, defaulting to the real `chokidarWatchDir` in production.

`server.ts` wires this to close the inner-loop staleness gap (§3): when `config.extensions` is set, it watches `dirname(resolve(root, config.extensions))` — the consumer's extensions-entry directory — and on any change calls `registry.invalidate()` (Slice 3.1 — so the daemon-side registry rebuilds on the next command; §3, Staleness model) *then* emits `hub.emit({ type: "bundle-outdated" })`. The frontend (`App.tsx`) reloads the page on that event when the session isn't dirty; if dirty, it leaves the reload to the user rather than risk losing unsaved edits.

## 6. Error contract

`src/daemon/errors.ts` defines a **closed string-code union** `EditorErrorCode`. Codes are the contract — clients branch on `code`; the human-readable `message` is for display only. Each transport edge owns its own mapping; the HTTP edge's table is `httpStatus(code)` (copied verbatim from `errors.ts`):

| `EditorErrorCode` | HTTP status | Meaning |
| --- | --- | --- |
| `invalid-input` | 400 | zod validation of a command's input failed. |
| `invalid-json` | 400 | the request body is not valid JSON (`server.ts`, at the route boundary). |
| `unknown-command` | 404 | no handler for the command name. |
| `not-found` | 404 | the named world does not exist or has no manifest; also `server.ts`'s no-route fallback for an unsupported method/path. |
| `outside-root` | 404 | a resolved path escapes the project root. *(404, not 400 — don't reveal what exists outside root.)* |
| `already-exists` | 409 | the write would clobber something that is already there (`world.duplicate` / `world.rename` onto a taken name). |
| `internal` | 500 | any other uncaught error at the route boundary. |

Wire shape on every error: `{ "error": { "code": "<EditorErrorCode>", "message": "<human text>" } }`.

**Seven codes went with the scene half in foundations T2** — `validation-failed`, `no-session`, `unsaved-changes`, `nothing-to-undo`, `nothing-to-redo` and `unreadable` (all thrown only by the session, the mutations or the scene reader), plus `extension-build-failed`, whose only throwers were in the deleted registry bundle (§3). `invalid-json` survives on its own merit: `server.ts` still throws it for an unparseable request body. Deleting a code is a wire-contract change, which is why they went in the same commit as their throwers rather than being left as unreachable rows.

## 7. Serving the chrome — the build, and the zero-engine rule

The browser frontend is **React 19**, Tailwind-styled. It is **prebuilt** to `dist/frontend` by `packages/editor/scripts/build-frontend.ts` (`bun run --cwd packages/editor build:frontend`) and served same-origin by the daemon's static route (§2). `bun run edit` rebuilds it before starting the daemon. The build is production-mode React on purpose, and it takes **two** levers rather than one: `process.env.NODE_ENV = "production"` on the build process picks react-dom's `production` package export (which file is bundled), and `define` inlines the same value for residual runtime `process.env` checks. `Bun.build` sets neither by default, so without both react-dom ships in dev mode.

**Three entrypoints, because a worker is reached by URL and not by an import graph.** `src/frontend/index.html` is the chrome; `src/frontend/field-worker.ts` (§11) and `src/frontend/analyzer-worker.ts` (§15) each ship as their own module bundle, since the chrome spawns them with `new Worker("/<name>.js", { type: "module" })` and neither can ride the html entry's graph. Both run engine code (`@furnace/core/field`) **directly**, not through `/engine.js` — the analyzer worker additionally loads `/engine.js` at runtime for its stage-2 verify, which drives the project's own mover (§3a).

**Zero engine value-imports.** The chrome must never `import` `@furnace/core` at value level — doing so would create a *second* core instance alongside the engine bundle's, the exact bug project-first resolution prevents. `packages/editor/tests/frontend-no-engine-leakage.test.ts` scans `src/frontend` and forbids value imports / side-effect imports / value re-exports of `@furnace/core`, **`viewport-host` and `field-protocol`** (`import type` / `export type` are erased and allowed). The chrome reaches the engine **only** through `loadEngine()` (a dynamic `import("/engine.js")`) and type-only imports of `viewport-host/index.ts` — which is why every host constant the chrome needs is restated as a local literal beside a comment saying so (`lib/field-host-mirrors.ts`, §16.7), and why deriving a fact host-side and pushing it is often cheaper than the chrome computing it (§13's drift `entityIds`, §17.1's pick tiers).

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

The bounded control's STEP comes from `multipleOf` when the schema declares one, from `type: "integer"`, or otherwise from the span (a 1-2-5 value near span/100). It is never inferred from how the bounds happen to look: `cave.chamberRadius` has integer bounds `[3, 8]` and `numParam` admits 5.5 m. Core's generator schemas carry `multipleOf: 1` on exactly the params `intParam` narrows, and `furnace.unit` on the params whose unit is not already in their name (`"m"` on `cave.chamberRadius` / `scatter.minSpacing`, `"cells"` on the hall's dimensions — a hall of width 8 is 4 m across). Both annotations are declarative: nothing in core reads either, and `packages/core/tests/field-generators.test.ts` asserts the `multipleOf` half BEHAVIOURALLY (a fractional value must be refused iff the schema claims it).

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

- **`FieldHost`** (`viewport-host/field-host.ts`) — a PreviewHost-class host (own
  canvas/context/camera/rAF loop) owning the field authoring loop: a
  `@furnace/core/field` store + op log (undo/redo = chunk-keyed two-channel inverse
  deltas, ⌘Z/⇧⌘Z), LMB tool strokes, RMB fly-look + WASD/QE (camera-control reuse), a
  **flat-shaded** (`shader.normalColor`, unlit normal-distinct — material classes
  deliberately indistinct here) vs LIT (per-class colors visible) toggle — F4.5a renamed
  the pair `normals`/`studio` and made `studio` the default (§16.5), ground grid + origin marker (blank-canvas bootstrap).
  Threaded to the chrome through the `/engine.js` runtime channel (the same channel the
  now-deleted PreviewHost used) — the chrome never value-imports engine code;
  `tests/frontend-no-engine-leakage.test.ts` machine-enforces the ban against
  `@furnace/core`, `field-protocol`, AND `viewport-host` value-imports.
  What is actually IN that closure — all 293 bindings assigned to 23 clusters, with every
  cross-cluster read and mutation listed — is mapped in
  `docs/reference/field-host-clusters.md`, which is what any further extraction out of it
  should be planned against.
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
  the filled kit ghost (§12). The F2b gate's deferred remainder was consumed into the F4.5
  stage and is discharged except for one item, now its own entry:
  `docs/backlog/editor-and-tooling/box-select-is-two-clicks-not-a-drag.md`.
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
  (eyedropper, momentary enter/leave) and is no longer only that: a chrome `setTool` landing
  under a held modifier re-derives the effective tool and fires carrying the DERIVED value —
  which is why the chrome's mirror value-compares before re-pushing — and since the F4.5
  gate's W-2 the seam also carries the brush RADIUS, which the chrome's own writes move
  (§18). The kit-fill ghost renders as a
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
- **Layers + slice** — `FieldLayers { field, kit, props, ghost, selection, grid,
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
  `create-session-ghost-cannot-be-dragged.md` and `box-select-is-two-clicks-not-a-drag.md`.

## 14. One Field F3b — scatter authoring, placed props, and two tools of its own (sealed 2026-07-25)

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
  `viewport-host/field-voidcast.ts` since foundations T3b1, not in the host; behaviour
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
  cannot value-import anything under `viewport-host/`, the same rule that keeps `flagKey`
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
seam multicast, so that hazard is gone — the placement stands on the rule it always also
served: ONE subscription point per seam, §16.7.)

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
listener to answer the "⏎ drop" the status bar advertises. `commitSession()` is the
narrower "end by mode" a panel button means.

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
| shading, layer gates, slice plane, AA | `hooks/useView.tsx` + `shell/ViewPopover.tsx` |
| the catalog fetch | `hooks/useCatalogs.tsx` (mounted once by the shell) |
| the committed-entity list + drift report | `shell/EntitiesPalette.tsx` — the first organ out, the layers panel since Task 4 |
| the status line | `lib/notify-store.ts` (toasts + the log) |
| the armed GESTURE (which of pointer / box / wand / room / segment holds LMB), F4.5b Task 7 | `hooks/useFieldHostState.tsx`'s tool context — the registry's `V`/`B`/`M` family keys arm the same slot the palette's buttons do, and a panel-local copy would disagree with them on the first keypress |

What **remains** is the dig loop's control stack: the tool palette, the material
swatches, the brush inspector, the stamp inspector and the advisor's flags — rendered
entirely from the provider's contexts, with **no host subscription of its own**.

**`hooks/useFieldHostState.tsx` is the ONE subscription point for the seams the chrome
reads.** The reason it was written was a real failure mode: every `FieldHost.subscribe*`
seam was a **single slot**, so a second subscriber silently stole the first's — the earlier
consumer just stopped updating, with nothing thrown and nothing logged. **Foundations T3a
retired that hazard** (§20): the seams are multicast now, and a second subscriber costs
nothing but a second delivery. The rule outlived its enforcement and is kept on its own
merits — one mirror per seam rather than N copies of the same state drifting apart, one
place where a comparator decides whether a push re-renders anything, and one place to look
when a surface stops updating. What changed is that the rule no longer holds itself up:
`tests/chrome/host-seams-and-catalogs.test.tsx` is now the only thing that detects a
violation, where before the bug reported itself as a dead surface. All
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

### 16.8 The daemon feed

`hooks/useDaemonFeed.ts` reduces the SSE feed to the two things the chrome does with it:

- a **`worldsVersion` counter** bumped on `worlds-changed` / `generation-baked` — a
  version rather than a payload, because those events are notification-only dirty bits.
  Anything rendering the world list refetches on it.
- the **hard reload** a stale engine bundle needs (`bundle-outdated`), **refused while a
  world write is in flight** — the subscription re-binds only when the engine becomes
  ready, so it reads `bakeBusyRef` (a ref, not state) to see the current value without
  re-subscribing. A reload mid-upload would kill the write.

Those two reductions now cover the feed **exhaustively**: since foundations T2 the daemon's
whole `DaemonEvent` union is the three events these two branches consume (§5), so there is
no feed member the chrome quietly ignores. It was a subset when this hook was written — the
five `SessionEvent` members rode the same feed and the chrome dropped every one of them.

It is a hook rather than App-local state for Shell's reason: a feed wired inside App is a
feed no test can drive, because App owns the WebGPU probe and the `/engine.js` import.
There is **nothing to catch up on** at `onOpen` — the editor mirrors no daemon-owned
document; the field world lives in the host until the user saves it.

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
the cell selection's AABB, else reports "nothing selected to frame" — a FIXED priority rather
than a recency rule, because an object selection names one thing and a cell selection names a
volume. The two keys deliberately disagree about ordering, and that is the reason: `F` asks
"which of these is the subject?", Esc asks "what did you just do?".

### 17.3 Move, delete, duplicate — and a move IS a reconfigure session

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
  discarded (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *A `G` grab moved by the ARROW keys reads as idle, and ⏎ discards it*`).
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
reads "1 ops" for a scatter that takes every prop it placed with it; the row's delete and the menu
item raise the same App-owned prompt, though the sentence is spelled in both
`shell/EntitiesPalette.tsx` and `lib/actions.ts`.

### 17.4 The action registry, the window dispatcher, and the RMB-gated fly

**`frontend/lib/actions.ts` is the editor's one action registry** (D-10/D-11/D-12): per action
an id, a group, a contextual `label`, an `enabled` predicate, the display chord, a one-sentence
`hint`, a `match` predicate, a `gate`, the `armsTool` / `flyLetter` flags and a `menuTitle` for
a reason that will not fit in a label. The module is pure and DOM-free (`KeyboardEvent` appears
as a type only), and it type-imports the host like every other chrome module.

Six surfaces render from it, which is what stops a binding from being live and undocumented or
documented and dead: the window key dispatcher (`hooks/useGlobalKeybindings.ts`), the burger's
World/Edit/View groups (`shell/BurgerMenu.tsx`), the shortcuts overlay
(`shell/ShortcutsDialog.tsx`), the tool rail through `TOOL_FAMILIES` (§17.8), the top bar's
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

**Esc cancels ONE thing per press, and the thing it picks is the most recent.** Both entry
points — the canvas keydown branch and the public `FieldHost.escape()` verb — still share one
implementation so they cannot disagree, but that implementation is a **capture stack**
(`viewport-host/input-router.ts`) rather than the five fixed rungs it was at the seal. Six
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

**`subscribeHistory` is the twelfth host seam and `useFieldHistory` the ninth context** — §16.7's
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

The status bar's `armedKeymap` (`shell/status-keymap.ts` — pure and React-free, so its strings
are tested directly rather than through the DOM) is the fourth channel and is **hand-enumerated
rather than derived
from the registry**, deliberately: the registry knows what a key RUNS, not which four of two dozen
bindings matter in a given mode, and half of what belongs on that line is canvas-owned keys the
table does not carry at all. Its modifier clause is derived (`modifierParts`) rather than static,
because `deriveMomentary` swaps dig↔fill symmetrically and passes ⌃ through under paint and smooth
— a static clause named three keys the host does not bind.

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

`hooks/useFieldHostState.tsx` remains the ONE subscription point — **thirteen seams through
ten contexts** at the seal (§18.6 adds the thirteenth): no surface below the provider may
re-subscribe to anything it owns. At the seal the rule was self-enforcing — every
`FieldHost.subscribe*` seam was a single slot, so a second subscriber silently stole the
first's — and foundations T3a made the seams multicast, which retired the hazard and left
the rule standing on cost and single-source-of-truth instead (§16.7, §20). That rule is a
claim about the SET rather than about any one surface, which is why its test outlived the
panel it used to live in (`tests/chrome/host-seams-and-catalogs.test.tsx`) — and why that
test is now the rule's only detector.

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

**`components/tips.tsx` is the chrome's tooltip vocabulary**, and it moved out of
`components/field/` at this stage because `field/` is the address of a panel that no longer
exists — it is now the chrome's most widely imported UI primitive (the rail, both bars, four
palettes, the session card's two sections and both list rows). The wrappers are a PAIR and
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

- **AI bindings** — MCP mount, `viewport.capture`, embedded agent, and outbound editor→LLM
  were descoped from M4 into a dedicated milestone,
  `docs/backlog/editor-and-tooling/editor-ai-integration-milestone.md`. The transport-agnostic
  substrate the milestone mounts over is still here: one zod-validated `dispatch()` choke
  point (§4), a closed error-code union (§6), and the `MCP/agent bindings` notes in
  `errors.ts` / `handlers.ts`. What T2 changed is the *verb set* an agent would be handed —
  8 field/world commands rather than 17 document mutations, and the "disk edits beat mutation
  tools" rationale now points at the field artifact rather than at a scene JSON.
- **A scene-authoring surface is NOT deferred — it is gone.** The chrome half went at F4.5a,
  the daemon half and `@furnace/core/scene` at foundations T2, and the backlog entry that
  parked the capability was resolved by that deletion rather than by building it. There is no
  scene document to author. `packages/hello-world` is the named casualty and accepts the
  loss: it remains the reference CONSUMER of the engine and simply has no editing surface —
  `bun run edit` there now opens a field editor on a project with no field. Anything that
  wants document-shaped authoring back is new work against the field artifact (or a new
  format), not a revival.
- **Everything else** lives in `docs/backlog/editor-and-tooling/`, one file per entry, each
  with the trigger that would make it actionable. The F4.5 seal filed the charter's whole
  capability-sweep backlog column there.

## 20. Foundations T3a — the host's framework primitives (2026-08-05)

Three mechanisms the field host had hand-rolled became named modules beside it, and two
core additions landed as their enablers. The slice is a **substrate** slice: it changes how
the host says things, not what it can do, and two of the three modules have no consumer in
this slice at all — T3b and T3c are the readers. It is documented here rather than left to
the seal because two of the changes are observable, and one of them changes a behaviour a
user can feel.

`view-channel.ts`, `input-router.ts` and `substrate.ts` are all **package-internal**:
deliberately not re-exported from `viewport-host/index.ts`. They are seams between the host
and the clusters being lifted out of it, not surface the chrome may reach for. The map of
what is being lifted, and what is left, is `docs/reference/field-host-clusters.md`.

### 20.1 The view channel — thirteen seams, N subscribers each

`viewport-host/view-channel.ts` is the multicast push seam behind every
`FieldHost.subscribe*` member. It is the push-direction sibling of
`frontend/lib/notify-store.ts` and framework-free for the same reason: subscribe returns an
unsubscribe and nothing more, so who hears a publish, what a late mount sees, and what a
throwing subscriber costs its siblings are all decided in one place a bare test drives
without a DOM or a React tree. **All thirteen seams moved in one commit and every signature
is unchanged** — `subscribeSegmentHud` delegates to `field-segment.ts`'s own channel, the
other twelve are channels the host holds.

Ten of the thirteen **push the current value on subscribe** — the (re)mount rule: a surface
that mounts mid-state must not render empty beside an overlay already showing that state.
The snapshot is a closure re-read **per subscribe**, not captured once, so a late mount is
pushed the state as it is then. Three seams deliberately have no snapshot, because their
payload is an EVENT rather than a state: `subscribeTool` (a change the chrome did not make;
a subscriber wanting the current tool has `setTool`'s own funnel), `subscribeToolError`
(re-pushing the last refusal to a remounting toast stack would resurrect one the user
dismissed) and `subscribeStats` — pushed every rAF, so the longest a subscriber waits is a
frame, and a snapshot would be the only place that payload was assembled off the tick.

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

**`subscribeHistory` is the one seam that is not a bare delegate**, and the reason is worth
keeping. Its body used to CLEAR the shared echo signature (`historySig`) to force an
unconditional push to its one subscriber; it now RECORDS it (`historySig = historySignature()`)
and lets the channel's snapshot do the arriving subscriber's initial push. Clearing was
correct for one subscriber and wrong for N — it would re-broadcast the current history to
everybody on the next notify that moved nothing. Recording says something true of every live
subscriber instead: the arrival was just handed this history, and the ones already here were
pushed it when it landed. It is written BEFORE the subscribe so a callback that reads the
host back synchronously cannot provoke a duplicate of its own first push. `notifyHistory`
still asks "is anybody listening" first, as `historyChannel.size() === 0`, and still leaves
the signature alone when the answer is no.

### 20.2 The input router — Esc becomes a capture stack

`viewport-host/input-router.ts` replaces the five-rung `escapeLadder()` with a stack of
captures. **A gesture or a selection ACQUIRES a capture when its state goes live and
RELEASES it in the same canonical setter that clears the state**, so membership IS liveness:
the stack cannot hold an entry for a state that is gone, and Esc cannot miss one that is
standing. Esc cancels the TOP and returns whether it acted — the claimed-event contract the
canvas branch reads to decide whether to `stopPropagation`, and the reason a press with
nothing captured still travels on to the app-level registry.

That is the whole law, and it is why **every mutation of a captured state must go through
its setter**: a bare assignment that skips the reconcile leaves a capture behind, and the
next Esc spends itself cancelling something that already ended. A shared `escRung` helper
owns the discipline rather than five copies of it — acquire on the first live read, release
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

### 20.3 The substrate record

`viewport-host/substrate.ts` declares `HostSubstrate`, the record an extracted cluster is
handed, plus `createHostSubstrate` — an identity function whose entire value is being a
single named place where the host states the split and the compiler checks it. Declared at
T3a with no consumer on purpose, and **constructed in `createFieldHost` since T3b1
(2026-08-06)**, when the void-cast extraction became the first thing to hand it to
(`viewport-host/field-voidcast.ts`).

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
