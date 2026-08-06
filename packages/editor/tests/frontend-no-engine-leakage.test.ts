import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FRONTEND = join(import.meta.dir, "..", "src", "frontend");
// `src/shared/` is the neutral layer both arrows point at (`frontend/ → viewport-host/ →
// shared/`, editor-architecture §7). It is scanned by the SAME rules and with NO
// exemptions, and that is not decoration: its three modules (`catalog.ts`,
// `field-brush.ts`, `field-entity.ts`) are VALUE-imported by chrome components, so a core
// value-import added to one of them lands in the main bundle exactly like a direct one —
// and the chrome's own import (`../../shared/catalog.ts`) matches none of the three
// specifier rules below, so nothing else would catch it. This scan is what keeps the
// "engine-free" half of the `shared/` rule a fact rather than a comment. (Its React-free
// half is not machine-enforced here; that belongs with the host's own directional test.)
const SHARED = join(import.meta.dir, "..", "src", "shared");

// Value-level references to engine code in the chrome would create a SECOND core
// instance next to the engine bundle's — the exact bug the project-first
// invariant exists to prevent. `import type` / `export type` are fine (erased).
const ENGINE = String.raw`["']@furnace\/core`;
// The two worker protocols value-import @furnace/core/field, so they CARRY core.
// A relative value-import of one (specifier not matched by the @furnace/core
// rule) into a chrome-graph file would pull core into the main bundle just as
// surely — so they are forbidden from non-exempt files too. Any specifier ending
// in `field-protocol` or `analyzer-protocol` (`./field-protocol.ts`,
// `../viewport-host/analyzer-protocol.ts`).
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
// That is a claim about EXECUTION, not about bundle content: even when the physics
// module (Rapier's wasm-bindgen glue and all) ships inside a worker bundle, no code
// path in this realm calls it. The lever is one VALUE import, not the module graph of
// `@furnace/core/field` generally. Historically (measured 2026-07-26) that one import
// dragged the whole engine in: `packages/core/src/field/artifact.ts` imported
// `encodeMeshBlob` through core's since-deleted scene module, whose graph pulled
// gpu/mesh/material/physics/post behind it — a throwaway entry importing only
// `@furnace/core/field` bundled to 208 modules with `rapier` in it (~2.9 MB, against
// ~15 KB with scene marked external). Resolved 2026-08-04 (foundations T1a): the
// codec is its own engine-tier leaf module, `@furnace/core/mesh-blob`, and a
// field-only entry bundles no rapier at all. What still ships in these worker
// bundles is whatever the dungeon pass graph itself pulls; the exemption never
// depended on that being small. The cost is a second copy of core's JS in the
// worker's memory, which is accepted.
//
// Exempt files may (1) value-import @furnace/core AND (2) value-import a core-carrying
// protocol module — they ARE those bundles. The two worker ENTRIES are all that is left
// here: `field-worker.ts` value-imports `createFieldWorkerHandler` and `analyzer-worker.ts`
// value-imports `createAnalyzerWorkerHandler`, each now reaching across to
// `../viewport-host/`, and both of those protocol modules still value-import core
// themselves (the mesher; the advisor passes).
//
// THE PROTOCOL PAIR LEFT THIS SCAN, deliberately, and the coverage arithmetic is exactly
// zero (foundations T3b1): `field-protocol.ts` and `analyzer-protocol.ts` moved from
// `frontend/lib/` into `src/viewport-host/`, where they sit beside their main-thread
// clients. They were EXEMPT here — the walk skipped them whole — so a scan that never
// asserted anything about them loses nothing by no longer reaching them. What the move
// BUYS is a second rule over them: a chrome value-import of either now trips the
// viewport-host rule as well as the protocol rule.
//
// The viewport-host rule is a no-op for the two exempt entries in the other direction:
// they don't import the barrel (`viewport-host/index.ts`), only single modules inside that
// directory, and the specifier rule cannot tell those apart — hence they must be exempt
// from it too. Every non-exempt chrome file may do NONE of the three: it may import
// @furnace/core, the protocols, AND anything under viewport-host only TYPE-ONLY (erased).
// The main-thread clients (`viewport-host/field-client.ts`,
// `viewport-host/analyzer-client.ts`) import their protocol TYPE-ONLY, and the host
// (FieldHost) reaches the chrome ONLY via the /engine.js runtime channel — never a static
// value import — which the viewport-host rule machine-enforces; without it core could
// re-enter the chrome via the barrel with no test failing.
//
// Those two clients, and `field-size.ts` beside them, also left this scan in the same
// move, and that one IS a narrowing worth naming: they were non-exempt chrome files, so
// the walk really did assert they carried no core. It no longer needs to. They are HOST
// files now, where a core value-import is legitimate — and the invariant that mattered is
// enforced at the BOUNDARY instead: any chrome file value-importing one of them writes a
// specifier under `viewport-host`, which the third rule catches.
const ENGINE_DIRECT_WORKER = new Set(["field-worker.ts", "analyzer-worker.ts"]);

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

test("shared/ carries no engine — the neutral layer stays neutral", () => {
  const offenders = walk(SHARED).filter((f) =>
    FORBIDDEN.some((re) => re.test(readFileSync(f, "utf8"))),
  );
  expect(offenders).toEqual([]);
});
