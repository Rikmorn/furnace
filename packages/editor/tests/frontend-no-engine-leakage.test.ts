import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FRONTEND = join(import.meta.dir, "..", "src", "frontend");

// Value-level references to engine code in the chrome would create a SECOND core
// instance next to the engine bundle's — the exact bug the project-first
// invariant exists to prevent. `import type` / `export type` are fine (erased).
const ENGINE = String.raw`["']@furnace\/core`;
// The two worker protocols value-import @furnace/core/field, so they CARRY core.
// A relative value-import of one (specifier not matched by the @furnace/core
// rule) into a chrome-graph file would pull core into the main bundle just as
// surely — so they are forbidden from non-exempt files too. Any specifier ending
// in `field-protocol` or `analyzer-protocol` (`./field-protocol.ts`,
// `./lib/analyzer-protocol.ts`).
const PROTOCOL = `["'][^"']*(field|analyzer)-protocol`;
// viewport-host/index.ts is the ENGINE BARREL — it value-imports @furnace/core/*
// (it re-exports the hosts). A value-import of it into any chrome file would
// transitively pull core into the main bundle just as surely as an @furnace/core
// import, and — before this rule — no test would fail: the two rules above match
// only `@furnace/core` and `field-protocol` specifiers, not `viewport-host`. The
// invariant held solely by manual discipline (every chrome import of the barrel is
// kept `import type`). Machine-enforce it. Any specifier ending in `viewport-host`
// (`../../viewport-host/index.ts`, `./viewport-host`).
const VIEWPORT_HOST = `["'][^"']*viewport-host`;

// All three rule-sets (@furnace/core, *-protocol, viewport-host) exempt the SAME
// files: each dedicated worker is its OWN bundle (/field-worker.js,
// /analyzer-worker.js), spawned by URL into an isolated Worker realm. They consume
// stock engine code (@furnace/core/field) directly. What must never happen is core
// entering the CHROME's bundle, which is what every rule below is about.
//
// Be precise about WHY each exemption is safe, because the two workers are safe for
// DIFFERENT reasons and only one of them is the easy case:
//   - The field worker's realm never loads /engine.js, so it holds exactly one core.
//   - The analyzer worker's realm holds TWO. Measured on the daemon-served bundle
//     (2026-07-26): /engine.js is ~8.7 MB, defines `createFieldStore` itself and has
//     ZERO external `@furnace/core` imports — esbuild INLINES core into it. So the
//     copy bundled into analyzer-worker.js (via analyzer-protocol.ts) sits beside the
//     engine bundle's own copy. The duplicate is real; do NOT cite this exemption as
//     evidence that a worker realm cannot have one.
// It is INERT here for two reasons, and both have to keep holding. (1) Everything
// crossing that seam is plain structural DATA — `FieldStore` is
// `{ cellSize, chunks: Map, materials: Map }` (core's types.ts), and `AgentProfile` /
// `FieldFlag` / `PlacementCollisionGroup` are likewise plain objects: no class
// identity, no `instanceof`, no symbols, so which core minted the value cannot matter
// (the dungeon's `AnalyzerVerifyOptions` says the same thing from its side —
// "Structural — an editor worker's mirror store satisfies it as readily as the game's
// own"). (2) The two instances share no module-level state: our copy runs only the
// pure column pass and the placement rasterizer, the bundle's copy owns the physics
// context and the collider derivation, and neither reads the other's registries.
// That is a claim about EXECUTION, not about bundle content: the physics module
// (Rapier's wasm-bindgen glue and all) DOES ship inside analyzer-worker.js, and no code
// path in this realm calls it. The lever is one VALUE import, not the module graph of
// `@furnace/core/field` generally — that entry alone reaches only `transform/` and
// `log/` and bundles to 15 KB. What drags the rest in is
// `packages/core/src/field/artifact.ts` importing `encodeMeshBlob` from
// `@furnace/core/scene`, and the scene graph pulls gpu/mesh/material/physics/post behind
// it: measured 2026-07-26, a throwaway entry importing only `@furnace/core/field`
// bundles to 208 modules with `rapier` in it, and to 31 modules without, once
// `@furnace/core/scene` is marked external — ~2.9 MB against ~15 KB, though the
// BYTE figures move with the probe entry's import form and the module counts do
// not (the backlog entry names the exact entry). Filed as
// `docs/backlog/engine-architecture/field-module-pulls-whole-engine.md`. The same is
// already true of field-worker.js (both ~2.65 MB on the daemon-served bundle). The cost
// is a second copy of core's JS in the worker's memory, which is accepted.
//
// Exempt files may (1) value-import @furnace/core AND (2) value-import a core-carrying
// protocol module — they ARE those bundles (field-worker.ts value-imports
// createFieldWorkerHandler; field-protocol.ts value-imports the mesher; the analyzer
// pair does the same with the advisor passes).
// The viewport-host rule is a no-op for them: the worker files don't import the barrel
// at all, so exempting them changes nothing while the rule catches any CHROME file that
// value-imports it. Every non-exempt chrome file may do NONE of the three: it may import
// @furnace/core, the protocols, AND viewport-host only TYPE-ONLY (erased). The
// main-thread clients (field-client.ts, analyzer-client.ts) import their protocol
// TYPE-ONLY, and the
// hosts (FieldHost/PreviewHost/ViewportHost) reach the chrome ONLY via the /engine.js
// runtime channel — never a static value import — which the viewport-host rule now
// machine-enforces; without it core could re-enter the chrome via the barrel with no
// test failing.
const ENGINE_DIRECT_WORKER = new Set([
  "field-worker.ts",
  join("lib", "field-protocol.ts"),
  "analyzer-worker.ts",
  join("lib", "analyzer-protocol.ts"),
]);

/** The three ways a value dependency (non-erased) enters a module's bundle, for
 *  a given quoted-specifier pattern. `import type` / `export type` are erased,
 *  so the value-import / re-export rules exclude them via the `type` lookahead. */
const valueImportRules = (specifier: string): RegExp[] => [
  new RegExp(String.raw`^import\s+(?!type\b)[^;]*?from\s+${specifier}`, "m"), // value import
  new RegExp(String.raw`^import\s+${specifier}`, "m"), // side-effect import
  new RegExp(String.raw`^export\s+(?!type\b)[^;]*?from\s+${specifier}`, "m"), // value re-export
];

const FORBIDDEN = [
  ...valueImportRules(ENGINE),
  ...valueImportRules(PROTOCOL),
  ...valueImportRules(VIEWPORT_HOST),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

test("frontend has no value imports of @furnace/core (project-first invariant)", () => {
  const offenders = walk(FRONTEND).filter((f) => {
    if (ENGINE_DIRECT_WORKER.has(relative(FRONTEND, f))) return false;
    const text = readFileSync(f, "utf8");
    return FORBIDDEN.some((re) => re.test(text));
  });
  expect(offenders).toEqual([]);
});
