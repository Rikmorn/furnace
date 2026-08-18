---
summary: Two builds — the project-resolved engine bundle the daemon serves, and the prebuilt React chrome — plus the layer arrow both obey.
verified: 2026-08-18
---

# Bundling

Two builds sit behind the running editor. The **engine bundle** is built by the daemon from
the *consumer's* `node_modules` and served at `GET /engine.js`. The **chrome** is prebuilt
from the editor's own sources and served as static files. They meet at exactly one seam: a
dynamic `import("/engine.js")`.

## The browser engine bundle — one target

The daemon builds the consumer's engine code in **one** esbuild bundle, resolving every
import from the project root's `node_modules` so there is exactly **one** core / registry /
zod instance.

`packages/editor/src/daemon/bundle.ts` composes a virtual stdin entry that imports the
consumer's extensions (for their registration side-effects), re-exports the **one** engine
host, and re-exports the consumer's extension module as a **namespace**:

```
import "<root>/<extensionsEntry>";                          // registration side-effects, when configured
export { createFieldHost } from "@furnace/editor/field-host";
export { getService } from "@furnace/core/registry";        // the consumer's service seam
export * as extensions from "<root>/<extensionsEntry>";     // the consumer's public surface, when configured
```

esbuild bundles this `format: "esm"`, `write: false`, `sourcemap: "inline"`, with
`resolveDir: root`. The bundler context is **incremental**: each `GET /engine.js` calls
`ctx.rebuild()`. Build failure returns `{ ok: false, error }` carrying esbuild's formatted
diagnostics, which the route serves as `500` plain text.

`createFieldHost` is the editor's only host. The `export * as extensions` is the
**consumer-code seam**: it re-exports the same extension module the bare side-effect import
already runs — so registration still fires exactly once — this time as a value namespace
worker code can call the consumer's own functions through. When no extensions entry is
configured the bundle emits `export const extensions = {}`. `EngineModule`
(`packages/editor/src/frontend/lib/engine.ts`, the `loadEngine()` return type) is
correspondingly `{ createFieldHost, extensions }` with
`extensions: Record<string, unknown>`.

**The analyzer does not read the namespace.** The virtual entry re-exports `getService` from
the CONSUMER's `@furnace/core/registry`, and
`packages/editor/src/frontend/analyzer-worker.ts` resolves its stage-2 verify via
`mod.getService("analyzerVerify")` — a validated lookup that throws a nameable
`FurnaceError` when the project registered nothing. The looked-up function is narrowed ONCE
to `AnalyzerEngine["analyzerVerify"]` at the worker's boundary cast; the type stays
structurally declared in `packages/editor/src/field-host/analyzer-protocol.ts` (the wire-twin
rule). Nothing on the main thread reads `extensions` at all — a consumer's
`editor-extensions.ts` may export far more than the editor consumes, and the engine bundle
may tree-shake whatever nothing imports.

**The daemon holds no schema knowledge.** Every schema decision happens in the browser,
inside the field host and the generator registry it drives. The daemon writes bytes
(`generation.bake`) and reads them back (`field.load`); it does not know what a generator is.

**Staleness model.** The browser bundle rebuilds on every browser refresh (each
`GET /engine.js`). The browser has no way to *know* an extension's TypeScript changed, so
`server.ts` watches the extensions entry's directory and emits `bundle-outdated` over SSE
([change-feed](change-feed.md)); the frontend hard-reloads on it unless a world write is in
flight. The watch is the whole mechanism.

## Serving the chrome — the build

The browser frontend is **React 19**, Tailwind-styled. It is **prebuilt** to `dist/frontend`
by `packages/editor/scripts/build-frontend.ts`
(`bun run --cwd packages/editor build:frontend`) and served same-origin by the daemon's
static route ([daemon](daemon.md)). The outdir is overridable via the
`FURNACE_FRONTEND_OUTDIR` env var, which exists so that
`packages/editor/tests/build-frontend.test.ts` can build into a temp dir instead of
clobbering the real `dist/frontend` that a concurrently-running daemon test is serving —
under the parallel gate the two would otherwise race. `bun run edit` rebuilds it before
starting the daemon.

The build is production-mode React on purpose, and it takes **two** levers rather than one:
`process.env.NODE_ENV = "production"` on the build process picks react-dom's `production`
package export (which file is bundled), and `define` inlines the same value for residual
runtime `process.env` checks. `Bun.build` sets neither by default, so without both react-dom
ships in dev mode.

**Three entrypoints, because a worker is reached by URL and not by an import graph.**
`packages/editor/src/frontend/index.html` is the chrome;
`packages/editor/src/frontend/field-worker.ts` and
`packages/editor/src/frontend/analyzer-worker.ts` each ship as their own module bundle, since
the chrome spawns them with `new Worker("/<name>.js", { type: "module" })` and neither can
ride the html entry's graph. Both run engine code (`@furnace/core/field`) **directly**, not
through `/engine.js` — the analyzer worker additionally loads `/engine.js` at runtime for its
stage-2 verify, which drives the project's own mover.

## Zero engine value-imports

The chrome must never `import` `@furnace/core` at value level — doing so would create a
*second* core instance alongside the engine bundle's, the exact bug project-first resolution
prevents. `packages/editor/tests/frontend-no-engine-leakage.test.ts` scans
`packages/editor/src/frontend` **and `packages/editor/src/shared`** and forbids value
imports, side-effect imports and value re-exports of `@furnace/core`, `field-host` and
`field-protocol` (`import type` / `export type` are erased and allowed).

The chrome reaches the engine **only** through `loadEngine()` (a dynamic
`import("/engine.js")`) and type-only imports of
`packages/editor/src/field-host/index.ts` — which is why a host constant the chrome needs is
normally restated as a local literal beside a comment saying so
(`packages/editor/src/frontend/lib/field-host-mirrors.ts`). The exceptions are the constants
that moved to the neutral floor: `MAX_SEGMENT_M` and `SELECTION_UI_BUDGET`
(`packages/editor/src/shared/field-limits.ts`) and the `LATTICE` step
(`packages/editor/src/shared/field-brush.ts`), where BOTH layers value-import the same number
instead of agreeing by review.

The specifier rule ends the segment (`field-host/`, or the end of the specifier) so it does
not also catch `frontend/lib/field-host-mirrors.ts`, a chrome-internal helper that shares the
prefix and nothing else.

## The layer arrow

**The import arrow runs one way — `frontend/ → { field-host/, action-registry/ } → shared/`,
and the two middle nodes are themselves a chain: `field-host/ → action-registry/`.**

`packages/editor/src/frontend/` is the React half, `packages/editor/src/field-host/` the
engine-facing half, `packages/editor/src/action-registry/` the editor's verbs as rows, and
`packages/editor/src/shared/` the neutral floor. Each layer may import DOWN the chain and
never up; `shared/` imports nothing ABOVE it, though it holds intra-layer edges that point
sideways within the floor, which the guard is written to allow.

`packages/editor/tests/no-chrome-leakage.test.ts` pins both directions of the
host↔registry edge, and each for its own reason:

- **Upward is forbidden outright.** The registry taking a `FieldHost` type would put a host
  dependency in the one module the daemon is meant to be able to hold.
- **Downward is permitted for EXACTLY ONE module**,
  `packages/editor/src/action-registry/result.ts`, and asserted as a membership rather than
  merely left unguarded. `packages/editor/src/field-host/field-mutation.ts` answers a caller
  instead of the room, and `result.ts` puts the refusal vocabulary below the chrome precisely
  so non-chrome callers can hold it — *there is ONE vocabulary of refusal in this editor.*
  It is the FILE and not the barrel, so `schemas.ts`'s zod never becomes reachable from
  anything the host pulls in.

**Both directions are machine-enforced.** The same suite scans `field-host/` for React
imports and for any specifier reaching back into `frontend/`, and scans `shared/` for React
imports — the React-free half of the `shared/` rule. It is stricter than the engine guard in
one respect: `import type` counts, because the question is which layer a module belongs to
rather than what reaches a bundle.

### The floor's membership

`packages/editor/src/shared/` holds protocol-shaped types and pure derivations:
**React-free and engine-free**, where engine-free means no VALUE import of `@furnace/core`
(type-only is erased and allowed). Its roster is
`ls packages/editor/src/shared/`.

**A fourth reader is not on the arrow at all: the daemon.**
`packages/editor/src/shared/wire.ts` holds the backchannel's frame types, and
`packages/editor/src/daemon/events.ts` and
`packages/editor/src/daemon/session-handlers.ts` `import type` them exactly as the chrome
does. It changes no rule — the daemon sits above the floor like everything else and the floor
still imports nothing above itself — and the two leakage suites turn out to enforce precisely
what a daemon-facing module needs from the other direction: React-free, engine-free and
zod-free is also Node-portable.

Three floor modules are daemon-facing:

- **`wire.ts`** — the daemon's two edges are `import type` and therefore erased. The module
  is not empty at run time: `AGENT_ORIGIN` is a `const`. The daemon still value-imports
  nothing from it; the chrome's answerer registry does.
- **`capture.ts`** — `CAPTURE_VIEWS` and the capture size bounds, read by the host (which
  derives and clamps), by `wire.ts` (type only) and by the daemon's zod schema (which
  validates); the MCP door joins them when the tool is advertised. It is on the floor for
  exactly the reason the rule exists — the daemon may not touch anything that imports
  `@furnace/core`, and every file in `field-host/` does.
- **`field-op.ts`** — the field mutation vocabulary as it crosses the agent door. The daemon
  must VALIDATE the shape and the host must ACCEPT it, so the shape sits under both. Its
  `import type` of core is erased, and that is what buys the property a hand-mirrored copy
  could not: `BrushOpInput` is DERIVED from core's own `BrushOp`, so a new effect, shape kind
  or mask arrives here by construction rather than by somebody remembering.

## The host owns the canvas's resize response, and the chrome must not

The canvas is bound to the engine's resize signal **host-side**:
`packages/editor/src/field-host/field-camera-rig.ts`'s `bind` calls
`camera.bindToCanvas(ctx, cam)`, which applies the current size once and then subscribes
`gpu.onResize` (`packages/core/src/camera/bind.ts`). The host draws every frame from its own
`requestAnimationFrame` loop, so nothing needs a resize-driven re-render on top of that.

**No `ResizeObserver` over the canvas exists anywhere in the chrome**, and that is the
invariant. The engine's `onResize` sets the canvas backing store *before* emitting
(`packages/core/src/gpu/resize.ts`), so anything reacting host-side is already at the new
size; a chrome-side `ResizeObserver` fires before the backing-store resize and blanks the
surface. This was a real bug caught only by a manual visual gate.
